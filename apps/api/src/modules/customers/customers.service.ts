import * as crypto from 'node:crypto';
import { Injectable, NotFoundException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import {
  CustomerStatus,
  SubscriptionStatus,
  AuditAction,
  generateMikrotikRateLimit,
  CoaAction,
  CoaRequestType,
  RouterConnectionMethod,
  getRadiusUsernameCandidates,
  toPhysicalRadiusUsername,
  normalizeMacAddress,
  validateSubscriptionTransition,
  calculateGracePeriodEndDate,
} from '@isp-crm/shared';
import { RadiusCoaQueueService } from '../radius/radius-coa-queue.service';

export interface CustomerListFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  area?: string;
  city?: string;
  zoneId?: string;
  nodeId?: string;
}

@Injectable()
export class CustomersService {
  constructor(
    @Optional() private readonly coaQueueService?: RadiusCoaQueueService,
  ) {}

  /**
   * Helper to ensure valid foreign key for AdminUser in audit/history records
   */
  private async sanitizeAdminUserId(adminUserId?: string): Promise<string | null> {
    if (!adminUserId) return null;
    const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
    return admin ? adminUserId : null;
  }

  /**
   * Helper to validate that zoneId and nodeId belong to organization and are consistent.
   * If nodeId is provided without zoneId, resolves and derives zoneId from the node.
   */
  private async validateCustomerZoneAndNode(
    organizationId: string,
    zoneIdInput?: string | null,
    nodeIdInput?: string | null,
  ): Promise<{ zoneId: string | null; nodeId: string | null }> {
    let resolvedZoneId = zoneIdInput ? zoneIdInput.trim() : null;
    let resolvedNodeId = nodeIdInput ? nodeIdInput.trim() : null;

    if (resolvedNodeId) {
      const node = await prisma.node.findFirst({
        where: { id: resolvedNodeId, organizationId },
      });
      if (!node) {
        throw new NotFoundException('Selected node not found in your organization');
      }

      if (resolvedZoneId) {
        if (node.zoneId !== resolvedZoneId) {
          throw new BadRequestException('Selected node does not belong to the selected zone');
        }
      } else {
        resolvedZoneId = node.zoneId;
      }
    }

    if (resolvedZoneId) {
      const zone = await prisma.zone.findFirst({
        where: { id: resolvedZoneId, organizationId },
      });
      if (!zone) {
        throw new NotFoundException('Selected zone not found in your organization');
      }
    }

    return { zoneId: resolvedZoneId, nodeId: resolvedNodeId };
  }

  /**
   * List subscribers strictly scoped to tenant organization with server-side pagination & filtering
   */
  async list(organizationId: string, filters: CustomerListFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 10));
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (filters.status && filters.status !== 'ALL') {
      where.status = filters.status as any;
    }
    if (filters.area) {
      where.area = { contains: filters.area, mode: 'insensitive' };
    }
    if (filters.city) {
      where.city = { contains: filters.city, mode: 'insensitive' };
    }
    if (filters.zoneId) {
      where.zoneId = filters.zoneId;
    }
    if (filters.nodeId) {
      where.nodeId = filters.nodeId;
    }

    if (filters.search) {
      const q = filters.search.trim();
      where.AND = [
        {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { customerCode: { contains: q, mode: 'insensitive' } },
            { username: { contains: q, mode: 'insensitive' } },
            { mobile: { contains: q } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
            { area: { contains: q, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [total, rawItems] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          zone: { select: { id: true, name: true } },
          node: { select: { id: true, name: true } },
          subscriptions: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: { plan: true },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    // Normalize customer fields for response
    const items = rawItems.map((c) => this.formatCustomer(c));

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Create subscriber ensuring organizationId is derived strictly from auth context.
   * Generates CREATE audit log.
   */
  async create(organizationId: string, adminUserIdOrData: any, maybeData?: any) {
    let adminUserId: string | undefined;
    let data: any;

    if (maybeData !== undefined) {
      adminUserId = adminUserIdOrData;
      data = maybeData;
    } else {
      adminUserId = undefined;
      data = adminUserIdOrData;
    }
    const name = (data.name || '').trim();
    if (!name || name.length < 2) {
      throw new BadRequestException('Customer name must be at least 2 characters');
    }
    const username = (data.username || data.pppoeUsername || '').trim();
    if (!username || username.length < 2) {
      throw new BadRequestException('Username must be at least 2 characters');
    }
    const customerCode = (data.customerCode || '').trim();
    if (!customerCode) {
      throw new BadRequestException('Customer code is required');
    }
    const mobile = (data.mobile || data.phone || '').trim();
    if (!mobile || mobile.length < 10) {
      throw new BadRequestException('Valid mobile number of at least 10 digits is required');
    }
    const address = (data.address || data.installationAddress || '').trim();

    // 1. Verify username uniqueness globally
    const existingUsername = await prisma.customer.findUnique({
      where: { username },
    });
    if (existingUsername) {
      throw new ConflictException(`Username '${username}' is already taken`);
    }

    // 2. Verify customerCode uniqueness in this organization
    const existingCode = await prisma.customer.findUnique({
      where: {
        organizationId_customerCode: {
          organizationId,
          customerCode,
        },
      },
    });
    if (existingCode) {
      throw new ConflictException(`Customer code '${customerCode}' already exists in your organization`);
    }

    // 3. If planId provided, verify it belongs to this organization
    let plan: any = null;
    let rateLimitString = '50M/50M';
    if (data.planId) {
      plan = await prisma.internetPlan.findFirst({
        where: { id: data.planId, organizationId },
      });
      if (!plan) {
        throw new NotFoundException('Selected internet plan not found in your organization');
      }
      rateLimitString = generateMikrotikRateLimit(plan);
    }

    const pppoePassword =
      data.pppoePassword && typeof data.pppoePassword === 'string' && data.pppoePassword.trim() !== ''
        ? data.pppoePassword.trim()
        : crypto.randomBytes(8).toString('hex');
    const status = (data.status as CustomerStatus) || CustomerStatus.ACTIVE;

    let canonicalMac: string | null = null;
    if (data.macAddress !== undefined && data.macAddress !== null) {
      if (typeof data.macAddress === 'string' && data.macAddress.trim() === '') {
        canonicalMac = null;
      } else {
        try {
          canonicalMac = normalizeMacAddress(data.macAddress);
        } catch (err: any) {
          throw new BadRequestException(err.message || 'Invalid MAC address format');
        }
      }
    }

    // 4. Validate optional Zone & Node hierarchy
    const { zoneId, nodeId } = await this.validateCustomerZoneAndNode(
      organizationId,
      data.zoneId,
      data.nodeId,
    );

    // 5. Atomically create Customer, Subscription, FreeRADIUS credentials, and AuditLog
    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          organizationId,
          customerCode,
          name,
          mobile,
          phone: mobile,
          email: data.email || null,
          alternatePhone: data.alternatePhone || null,
          address,
          installationAddress: address,
          area: data.area || null,
          city: data.city || null,
          state: data.state || null,
          pincode: data.pincode || null,
          zoneId,
          nodeId,
          username,
          pppoeUsername: username,
          pppoePassword,
          staticIp: data.staticIp || null,
          macAddress: canonicalMac,
          status,
          installationDate: data.installationDate ? new Date(data.installationDate) : null,
          notes: data.notes || null,
        },
        include: {
          zone: { select: { id: true, name: true } },
          node: { select: { id: true, name: true } },
        },
      });

      // If plan assigned, create initial subscription
      if (plan) {
        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + plan.validityDays * 24 * 60 * 60 * 1000);

        await tx.subscription.create({
          data: {
            organizationId,
            customerId: customer.id,
            planId: plan.id,
            status: status === CustomerStatus.ACTIVE ? SubscriptionStatus.ACTIVE : SubscriptionStatus.PENDING,
            startDate,
            endDate,
            autoRenew: true,
          },
        });
      }

      // FreeRADIUS credentials in radcheck for all candidate usernames (base + realm)
      const targetUsernames = getRadiusUsernameCandidates(customer.username);
      const radCheckPassword = status === CustomerStatus.ACTIVE ? pppoePassword : `SUSPENDED_${Date.now()}`;
      for (const u of targetUsernames) {
        await tx.radCheck.create({
          data: {
            username: u,
            attribute: 'Cleartext-Password',
            op: ':=',
            value: radCheckPassword,
          },
        });
      }

      // If authorized MAC address is provided, add Calling-Station-Id check in radcheck
      if (canonicalMac) {
        for (const u of targetUsernames) {
          await tx.radCheck.create({
            data: {
              username: u,
              attribute: 'Calling-Station-Id',
              op: '==',
              value: canonicalMac,
            },
          });
        }
      }

      // FreeRADIUS reply in radreply for all candidate usernames
      for (const u of targetUsernames) {
        await tx.radReply.create({
          data: {
            username: u,
            attribute: 'Mikrotik-Rate-Limit',
            op: '=',
            value: status === CustomerStatus.ACTIVE ? rateLimitString : '64k/64k',
          },
        });

        if (data.staticIp) {
          await tx.radReply.create({
            data: {
              username: u,
              attribute: 'Framed-IP-Address',
              op: '=',
              value: data.staticIp,
            },
          });
        } else {
          await tx.radReply.create({
            data: {
              username: u,
              attribute: 'Framed-Pool',
              op: '=',
              value: 'pppoe',
            },
          });
        }
      }

      // Record Audit Log for customer creation
      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: adminUserId || null,
          action: AuditAction.CREATE,
          entityType: 'CUSTOMER',
          entityId: customer.id,
          details: {
            customerCode: customer.customerCode,
            name: customer.name,
            username: customer.username,
            mobile: customer.mobile,
            status: customer.status,
            macAddress: customer.macAddress,
            zoneId: customer.zoneId,
            nodeId: customer.nodeId,
          },
        },
      });

      return this.formatCustomer(customer);
    });
  }

  /**
   * Retrieve subscriber details scoped to organization with subscriptions, invoices, and audit trail
   */
  async getById(organizationId: string, id: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, organizationId },
      include: {
        zone: { select: { id: true, name: true } },
        node: { select: { id: true, name: true } },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          include: { plan: true },
        },
        invoices: { take: 10, orderBy: { createdAt: 'desc' } },
        payments: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer '${id}' not found in your organization`);
    }

    // Fetch related audit logs
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        organizationId,
        entityType: 'CUSTOMER',
        entityId: customer.id,
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: {
        adminUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return {
      ...this.formatCustomer(customer),
      subscriptions: customer.subscriptions,
      invoices: customer.invoices,
      payments: customer.payments,
      auditLogs,
    };
  }

  /**
   * Edit customer profile with audit logging and FreeRADIUS credential synchronization
   */
  async update(organizationId: string, adminUserIdOrId: any, idOrData: any, maybeData?: any) {
    let adminUserId: string | undefined;
    let id: string;
    let data: any;

    if (maybeData !== undefined) {
      adminUserId = adminUserIdOrId;
      id = idOrData;
      data = maybeData;
    } else {
      adminUserId = undefined;
      id = adminUserIdOrId;
      data = idOrData;
    }

    const existing = await prisma.customer.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundException(`Customer '${id}' not found in your organization`);
    }

    const updateData: any = {};

    // 1. Personal Information Validation
    if (data.name !== undefined) {
      const n = (data.name || '').trim();
      if (!n || n.length < 2) {
        throw new BadRequestException('Customer name must be at least 2 characters');
      }
      updateData.name = n;
    }

    if (data.customerCode !== undefined) {
      const code = (data.customerCode || '').trim();
      if (!code) {
        throw new BadRequestException('Customer code cannot be empty');
      }
      if (code !== existing.customerCode) {
        const codeExists = await prisma.customer.findUnique({
          where: {
            organizationId_customerCode: {
              organizationId,
              customerCode: code,
            },
          },
        });
        if (codeExists) {
          throw new ConflictException(`Customer code '${code}' is already assigned to another customer`);
        }
        updateData.customerCode = code;
      }
    }

    if (data.installationDate !== undefined) {
      updateData.installationDate = data.installationDate ? new Date(data.installationDate) : null;
    }

    // 2. Contact Information Validation
    if (data.mobile !== undefined) {
      const m = (data.mobile || '').trim();
      if (m && m.length < 10) {
        throw new BadRequestException('Valid primary mobile number of at least 10 digits is required');
      }
      updateData.mobile = m;
      if (data.phone === undefined) {
        updateData.phone = m;
      }
    }
    if (data.phone !== undefined) {
      updateData.phone = data.phone ? data.phone.trim() : (updateData.mobile || existing.mobile);
    }
    if (data.alternatePhone !== undefined) {
      updateData.alternatePhone = data.alternatePhone && data.alternatePhone.trim() !== '' ? data.alternatePhone.trim() : null;
    }
    if (data.email !== undefined) {
      const em = data.email ? data.email.trim() : '';
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        throw new BadRequestException('Invalid email address format');
      }
      updateData.email = em || null;
    }

    // 3. Address Information
    if (data.installationAddress !== undefined) {
      updateData.installationAddress = data.installationAddress ? data.installationAddress.trim() : null;
    }
    if (data.address !== undefined) {
      updateData.address = data.address ? data.address.trim() : '';
      if (data.installationAddress === undefined && !existing.installationAddress) {
        updateData.installationAddress = updateData.address;
      }
    }
    if (data.area !== undefined) updateData.area = data.area ? data.area.trim() : null;
    if (data.city !== undefined) updateData.city = data.city ? data.city.trim() : null;
    if (data.state !== undefined) updateData.state = data.state ? data.state.trim() : null;
    if (data.pincode !== undefined) updateData.pincode = data.pincode ? data.pincode.trim() : null;

    // 4. Billing & KYC
    if (data.aadhaarNumber !== undefined) {
      const a = data.aadhaarNumber ? data.aadhaarNumber.toString().replace(/\D/g, '') : '';
      if (a && a.length !== 12) {
        throw new BadRequestException('Aadhaar number must be exactly 12 digits');
      }
      updateData.aadhaarNumber = a || null;
    }

    if (data.gstin !== undefined) {
      const g = data.gstin ? data.gstin.trim().toUpperCase() : '';
      if (g && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g)) {
        throw new BadRequestException('Invalid GSTIN format (must be 15 characters, e.g. 27AAAAA0000A1Z5)');
      }
      updateData.gstin = g || null;
    }

    // 5. Zone & Node Assignment
    if (data.zoneId !== undefined || data.nodeId !== undefined) {
      let targetZoneId = data.zoneId !== undefined ? (data.zoneId || null) : existing.zoneId;
      let targetNodeId = data.nodeId !== undefined ? (data.nodeId || null) : existing.nodeId;

      if ((data.zoneId === null || data.zoneId === '') && data.nodeId === undefined) {
        targetNodeId = null;
      }

      const validated = await this.validateCustomerZoneAndNode(
        organizationId,
        targetZoneId,
        targetNodeId,
      );

      if (data.zoneId !== undefined || targetNodeId === null) {
        updateData.zoneId = validated.zoneId;
      } else if (targetNodeId && validated.zoneId !== existing.zoneId) {
        updateData.zoneId = validated.zoneId;
      }

      if (data.nodeId !== undefined || targetNodeId === null) {
        updateData.nodeId = validated.nodeId;
      }
    }

    // 6. Account Settings & Notes
    if (data.notes !== undefined) {
      updateData.notes = data.notes ? data.notes.trim() : null;
    }

    let hasStatusChange = false;
    if (data.status !== undefined && data.status !== existing.status) {
      const validStatuses = Object.values(CustomerStatus);
      if (!validStatuses.includes(data.status)) {
        throw new BadRequestException(`Invalid customer status '${data.status}'`);
      }
      updateData.status = data.status;
      hasStatusChange = true;
    }

    // 6. PPPoE Identity & Network Credentials
    const requestedUsername = data.username !== undefined ? data.username : data.pppoeUsername;
    let isRenamed = false;
    if (requestedUsername !== undefined) {
      const un = requestedUsername.trim();
      if (!un || un.length < 2) {
        throw new BadRequestException('PPPoE username must be at least 2 characters');
      }
      if (!/^[a-zA-Z0-9._-]+(@[a-zA-Z0-9._-]+)?$/.test(un)) {
        throw new BadRequestException('PPPoE username contains invalid characters');
      }
      if (un !== existing.username) {
        const usernameExists = await prisma.customer.findUnique({
          where: { username: un },
        });
        if (usernameExists) {
          throw new ConflictException(`PPPoE username '${un}' is already assigned to another customer`);
        }
        updateData.username = un;
        updateData.pppoeUsername = un;
        isRenamed = true;
      }
    }

    let hasPasswordChange = false;
    if (
      data.pppoePassword !== undefined &&
      data.pppoePassword !== null &&
      typeof data.pppoePassword === 'string' &&
      data.pppoePassword.trim() !== ''
    ) {
      const pass = data.pppoePassword.trim();
      if (pass.length < 4) {
        throw new BadRequestException('PPPoE password must be at least 4 characters');
      }
      updateData.pppoePassword = pass;
      hasPasswordChange = true;
    }

    let hasStaticIpChange = false;
    if (data.staticIp !== undefined) {
      const ip = data.staticIp ? data.staticIp.trim() : '';
      updateData.staticIp = ip || null;
      if (updateData.staticIp !== existing.staticIp) {
        hasStaticIpChange = true;
      }
    }

    let hasMacChange = false;
    let canonicalMac: string | null = null;
    if (data.macAddress !== undefined) {
      hasMacChange = true;
      if (data.macAddress === null || (typeof data.macAddress === 'string' && data.macAddress.trim() === '')) {
        canonicalMac = null;
      } else {
        try {
          canonicalMac = normalizeMacAddress(data.macAddress);
        } catch (err: any) {
          throw new BadRequestException(err.message || 'Invalid MAC address format');
        }
        if (canonicalMac && canonicalMac !== existing.macAddress) {
          const macOwner = await prisma.customer.findFirst({
            where: {
              organizationId,
              macAddress: canonicalMac,
              id: { not: id },
            },
          });
          if (macOwner) {
            throw new ConflictException(
              `MAC address '${canonicalMac}' is already bound to customer '${macOwner.name}' (${macOwner.customerCode})`,
            );
          }
        }
      }
      updateData.macAddress = canonicalMac;
      updateData.macResetPending = false;
    } else {
      canonicalMac = existing.macAddress || null;
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: updateData,
        include: {
          zone: { select: { id: true, name: true } },
          node: { select: { id: true, name: true } },
        },
      });

      const currentUsername = updated.username;
      const prevUsername = existing.username;
      const prevCandidates = getRadiusUsernameCandidates(prevUsername);
      const targetUsernames = getRadiusUsernameCandidates(currentUsername);

      // Step A: FreeRADIUS Username Migration & radreply preservation
      if (isRenamed) {
        // 1. Fetch existing radreply rows for previous candidates to preserve rate limit, pool, service-type, etc.
        const existingReplies = await tx.radReply.findMany({
          where: { username: { in: prevCandidates } },
        });

        // Delete old candidates from radcheck and radreply so old identity immediately rejects
        await tx.radCheck.deleteMany({ where: { username: { in: prevCandidates } } });
        await tx.radReply.deleteMany({ where: { username: { in: prevCandidates } } });

        // Re-create all reply attributes on target usernames
        if (existingReplies.length > 0) {
          const distinctAttrs = new Map<string, { attribute: string; op: string; value: string }>();
          for (const rep of existingReplies) {
            if (!distinctAttrs.has(rep.attribute)) {
              distinctAttrs.set(rep.attribute, { attribute: rep.attribute, op: rep.op, value: rep.value });
            }
          }

          for (const u of targetUsernames) {
            for (const [, item] of distinctAttrs.entries()) {
              let valueToSet = item.value;
              let attrToSet = item.attribute;

              if (attrToSet === 'Framed-IP-Address' && updated.staticIp) {
                valueToSet = updated.staticIp;
              } else if (attrToSet === 'Framed-Pool' && updated.staticIp) {
                attrToSet = 'Framed-IP-Address';
                valueToSet = updated.staticIp;
              } else if (attrToSet === 'Framed-IP-Address' && !updated.staticIp) {
                attrToSet = 'Framed-Pool';
                valueToSet = 'pppoe';
              }

              await tx.radReply.create({
                data: {
                  username: u,
                  attribute: attrToSet,
                  op: item.op,
                  value: valueToSet,
                },
              });
            }
          }
        } else {
          // Fallback if no prior reply records existed
          for (const u of targetUsernames) {
            await tx.radReply.create({
              data: {
                username: u,
                attribute: 'Mikrotik-Rate-Limit',
                op: '=',
                value: '50M/50M',
              },
            });
            await tx.radReply.create({
              data: {
                username: u,
                attribute: 'Service-Type',
                op: '=',
                value: 'Framed-User',
              },
            });
            await tx.radReply.create({
              data: {
                username: u,
                attribute: updated.staticIp ? 'Framed-IP-Address' : 'Framed-Pool',
                op: '=',
                value: updated.staticIp || 'pppoe',
              },
            });
          }
        }
      } else if (hasStaticIpChange) {
        // If username didn't change but static IP did, update Framed-IP-Address / Framed-Pool
        await tx.radReply.deleteMany({
          where: {
            username: { in: targetUsernames },
            attribute: { in: ['Framed-IP-Address', 'Framed-Pool'] },
          },
        });
        for (const u of targetUsernames) {
          await tx.radReply.create({
            data: {
              username: u,
              attribute: updated.staticIp ? 'Framed-IP-Address' : 'Framed-Pool',
              op: '=',
              value: updated.staticIp || 'pppoe',
            },
          });
        }
      }

      // Step B: Synchronize radcheck Cleartext-Password
      if (isRenamed || hasPasswordChange || hasStatusChange) {
        await tx.radCheck.deleteMany({
          where: { username: { in: targetUsernames }, attribute: 'Cleartext-Password' },
        });

        const effectivePassword =
          updated.status === CustomerStatus.ACTIVE ? updated.pppoePassword : `SUSPENDED_${Date.now()}`;

        for (const u of targetUsernames) {
          await tx.radCheck.create({
            data: {
              username: u,
              attribute: 'Cleartext-Password',
              op: ':=',
              value: effectivePassword,
            },
          });
        }
      }

      // Step C: Synchronize radcheck Calling-Station-Id (MAC address restriction)
      if (isRenamed || hasMacChange || hasStatusChange) {
        await tx.radCheck.deleteMany({
          where: { username: { in: targetUsernames }, attribute: 'Calling-Station-Id' },
        });

        if (canonicalMac && updated.status === CustomerStatus.ACTIVE) {
          for (const u of targetUsernames) {
            await tx.radCheck.create({
              data: {
                username: u,
                attribute: 'Calling-Station-Id',
                op: '==',
                value: canonicalMac,
              },
            });
          }
        }
      }

      // Step D: FreeRADIUS Reply adjustments on status change (throttle to 64k/64k on suspend, restore on active)
      if (hasStatusChange && !isRenamed) {
        if (updated.status === CustomerStatus.SUSPENDED) {
          await tx.radReply.deleteMany({
            where: { username: { in: targetUsernames }, attribute: 'Mikrotik-Rate-Limit' },
          });
          for (const u of targetUsernames) {
            await tx.radReply.create({
              data: {
                username: u,
                attribute: 'Mikrotik-Rate-Limit',
                op: '=',
                value: '64k/64k',
              },
            });
          }
        } else if (updated.status === CustomerStatus.ACTIVE) {
          const activeSub = await tx.subscription.findFirst({
            where: { customerId: id, organizationId, status: SubscriptionStatus.ACTIVE },
            include: { plan: true },
          });
          const restoredRate = activeSub?.plan ? generateMikrotikRateLimit(activeSub.plan) : '50M/50M';

          await tx.radReply.deleteMany({
            where: { username: { in: targetUsernames }, attribute: 'Mikrotik-Rate-Limit' },
          });
          for (const u of targetUsernames) {
            await tx.radReply.create({
              data: {
                username: u,
                attribute: 'Mikrotik-Rate-Limit',
                op: '=',
                value: restoredRate,
              },
            });
          }
        }
      }

      // Step E: Record Audit Log for UPDATE
      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: adminUserId || null,
          action: AuditAction.UPDATE,
          entityType: 'CUSTOMER',
          entityId: updated.id,
          details: {
            before: {
              name: existing.name,
              customerCode: existing.customerCode,
              username: existing.username,
              mobile: existing.mobile,
              phone: existing.phone,
              email: existing.email,
              address: existing.address,
              installationAddress: existing.installationAddress,
              status: existing.status,
              macAddress: existing.macAddress,
              staticIp: existing.staticIp,
              aadhaarNumber: existing.aadhaarNumber,
              gstin: existing.gstin,
              zoneId: existing.zoneId,
              nodeId: existing.nodeId,
            },
            after: {
              name: updated.name,
              customerCode: updated.customerCode,
              username: updated.username,
              mobile: updated.mobile,
              phone: updated.phone,
              email: updated.email,
              address: updated.address,
              installationAddress: updated.installationAddress,
              status: updated.status,
              macAddress: updated.macAddress,
              staticIp: updated.staticIp,
              aadhaarNumber: updated.aadhaarNumber,
              gstin: updated.gstin,
              zoneId: updated.zoneId,
              nodeId: updated.nodeId,
            },
            flags: {
              usernameChanged: isRenamed,
              passwordChanged: hasPasswordChange,
              macChanged: hasMacChange,
              statusChanged: hasStatusChange,
              staticIpChanged: hasStaticIpChange,
            },
          },
        },
      });

      return this.formatCustomer(updated);
    });
  }

  /**
   * Reset authorized MAC address and transition subscriber into auto-learning pending state.
   * Removes old Calling-Station-Id restriction in FreeRADIUS radcheck and sets macResetPending = true.
   * Next successful PPPoE login will automatically capture and bind the device's Calling-Station-Id.
   */
  async resetMac(organizationId: string, adminUserId: string | undefined, id: string) {
    const existing = await prisma.customer.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundException(`Customer with ID '${id}' not found in your organization`);
    }

    const targetUsernames = getRadiusUsernameCandidates(existing.username);

    return prisma.$transaction(async (tx) => {
      // 1. Clear customer MAC and enter pending reset state
      const updated = await tx.customer.update({
        where: { id },
        data: {
          macAddress: null,
          macResetPending: true,
        },
      });

      // 2. Remove old Calling-Station-Id check from radcheck
      await tx.radCheck.deleteMany({
        where: {
          username: { in: targetUsernames },
          attribute: 'Calling-Station-Id',
        },
      });

      // 3. Record Audit Log: MAC_RESET_REQUESTED
      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId,
          action: AuditAction.MAC_RESET_REQUESTED,
          entityType: 'Customer',
          entityId: id,
          details: {
            customerId: id,
            username: existing.username,
            previousMac: existing.macAddress || null,
            status: 'WAITING_FOR_NEW_DEVICE',
            timestamp: new Date().toISOString(),
          },
        },
      });

      return {
        id: updated.id,
        username: updated.username,
        macAddress: null,
        macResetPending: true,
        message: 'MAC reset initiated. The next successful PPPoE login will automatically register its device MAC.',
      };
    });
  }

  /**
   * Transition customer status (LEAD, PENDING, ACTIVE, SUSPENDED, EXPIRED, TERMINATED)
   * Synchronizes FreeRADIUS state and creates STATUS_CHANGE audit log.
   */
  async updateStatus(
    organizationId: string,
    adminUserIdOrId: any,
    idOrStatus: any,
    maybeStatus?: CustomerStatus,
    maybeNotes?: string,
  ) {
    let adminUserId: string | undefined;
    let id: string;
    let newStatus: CustomerStatus;
    let notes: string | undefined;

    if (maybeStatus !== undefined) {
      adminUserId = adminUserIdOrId;
      id = idOrStatus;
      newStatus = maybeStatus;
      notes = maybeNotes;
    } else {
      adminUserId = undefined;
      id = adminUserIdOrId;
      newStatus = idOrStatus;
      notes = maybeStatus;
    }

    const customer = await prisma.customer.findFirst({
      where: { id, organizationId },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          include: { plan: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer '${id}' not found in your organization`);
    }

    const oldStatus = customer.status;

    let targetSub: (typeof customer.subscriptions)[0] | undefined;
    let targetSubNewStatus: SubscriptionStatus | undefined;

    if (newStatus === CustomerStatus.ACTIVE) {
      if (customer.subscriptions.length > 0) {
        // Customer has subscription history; evaluate the latest/current subscription
        targetSub = customer.subscriptions[0];

        // 1. CANCELLED subscription is terminal and must NEVER be reactivated
        if (targetSub.status === SubscriptionStatus.CANCELLED) {
          throw new BadRequestException(
            `Cannot reactivate customer: subscription '${targetSub.id}' is CANCELLED (terminal state). A new subscription must be provisioned.`,
          );
        }

        // 2. Validate FSM transition using validateSubscriptionTransition()
        try {
          validateSubscriptionTransition(
            targetSub.status as SubscriptionStatus,
            SubscriptionStatus.ACTIVE,
            'reactivate',
          );
        } catch (err: any) {
          throw new BadRequestException(
            err?.message || `Invalid subscription transition from ${targetSub.status} to ACTIVE`,
          );
        }

        // 3. EXPIRED subscription cannot be reactivated directly; it must be renewed
        if (targetSub.status === SubscriptionStatus.EXPIRED) {
          throw new BadRequestException(
            `Cannot reactivate customer: subscription '${targetSub.id}' is EXPIRED. Please renew the subscription or provision a new one instead.`,
          );
        }

        // 4. SUSPENDED subscription check for validity & grace period
        if (targetSub.status === SubscriptionStatus.SUSPENDED) {
          const now = new Date();
          const graceEndDate = calculateGracePeriodEndDate(targetSub.endDate, targetSub.gracePeriodDays);
          if (now > graceEndDate) {
            throw new BadRequestException(
              'Cannot reactivate customer whose subscription validity and grace period have expired. Please renew the subscription instead.',
            );
          }
          targetSubNewStatus = now <= targetSub.endDate ? SubscriptionStatus.ACTIVE : SubscriptionStatus.GRACE;
        } else if (targetSub.status === SubscriptionStatus.PENDING) {
          targetSubNewStatus = SubscriptionStatus.ACTIVE;
        }
      }
    }

    const rateSub = targetSub || customer.subscriptions.find((s) => s.status === SubscriptionStatus.ACTIVE);
    const rateLimit = rateSub?.plan
      ? generateMikrotikRateLimit(rateSub.plan)
      : '50M/50M';

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: {
          status: newStatus,
          notes: notes ? (customer.notes ? `${customer.notes}\n${notes}` : notes) : customer.notes,
        },
      });

      const targetUsernames = getRadiusUsernameCandidates(customer.username);

      if (newStatus === CustomerStatus.ACTIVE) {
        // Re-enable radcheck credentials for all candidate usernames (base + realm)
        await tx.radCheck.deleteMany({
          where: { username: { in: targetUsernames }, attribute: 'Cleartext-Password' },
        });
        for (const u of targetUsernames) {
          await tx.radCheck.create({
            data: {
              username: u,
              attribute: 'Cleartext-Password',
              op: ':=',
              value: customer.pppoePassword,
            },
          });
        }

        // Restore Calling-Station-Id check if customer has a bound MAC address
        await tx.radCheck.deleteMany({
          where: { username: { in: targetUsernames }, attribute: 'Calling-Station-Id' },
        });
        if (customer.macAddress) {
          const canonicalMac = normalizeMacAddress(customer.macAddress);
          if (canonicalMac) {
            for (const u of targetUsernames) {
              await tx.radCheck.create({
                data: {
                  username: u,
                  attribute: 'Calling-Station-Id',
                  op: '==',
                  value: canonicalMac,
                },
              });
            }
          }
        }

        // Restore radreply attributes for all candidate usernames (rate-limit, pool, service-type, interim)
        await tx.radReply.deleteMany({
          where: { username: { in: targetUsernames } },
        });

        const replyAttributes: Array<{ username: string; attribute: string; op: string; value: string }> = [];
        for (const u of targetUsernames) {
          replyAttributes.push(
            {
              username: u,
              attribute: 'Mikrotik-Rate-Limit',
              op: '=',
              value: rateLimit,
            },
            {
              username: u,
              attribute: 'Service-Type',
              op: '=',
              value: 'Framed-User',
            },
            {
              username: u,
              attribute: 'Acct-Interim-Interval',
              op: '=',
              value: '60',
            },
          );

          if (customer.staticIp) {
            replyAttributes.push({
              username: u,
              attribute: 'Framed-IP-Address',
              op: '=',
              value: customer.staticIp,
            });
          } else {
            replyAttributes.push({
              username: u,
              attribute: 'Framed-Pool',
              op: '=',
              value: 'pppoe',
            });
          }
        }

        await tx.radReply.createMany({
          data: replyAttributes,
        });

        // Mark subscription active if status change is required
        if (targetSub && targetSubNewStatus && targetSub.status !== targetSubNewStatus) {
          await tx.subscription.update({
            where: { id: targetSub.id },
            data: { status: targetSubNewStatus },
          });

          const validAdminUserId = await this.sanitizeAdminUserId(adminUserId);
          await tx.subscriptionHistory.create({
            data: {
              organizationId,
              subscriptionId: targetSub.id,
              fromStatus: targetSub.status,
              toStatus: targetSubNewStatus,
              action: targetSub.status === SubscriptionStatus.PENDING ? 'ACTIVATE' : 'REACTIVATE',
              reason: notes || 'Customer reactivated',
              adminUserId: validAdminUserId,
            },
          });
        }
      } else if (newStatus === CustomerStatus.SUSPENDED) {
        // Lock radcheck credentials for all candidate usernames (base + realm)
        await tx.radCheck.deleteMany({
          where: { username: { in: targetUsernames }, attribute: 'Cleartext-Password' },
        });
        for (const u of targetUsernames) {
          await tx.radCheck.create({
            data: {
              username: u,
              attribute: 'Cleartext-Password',
              op: ':=',
              value: `SUSPENDED_${Date.now()}`,
            },
          });
        }

        // Throttle radreply for all candidate usernames
        await tx.radReply.deleteMany({
          where: { username: { in: targetUsernames }, attribute: 'Mikrotik-Rate-Limit' },
        });
        for (const u of targetUsernames) {
          await tx.radReply.create({
            data: {
              username: u,
              attribute: 'Mikrotik-Rate-Limit',
              op: '=',
              value: '64k/64k',
            },
          });
        }

        // Suspend subscriptions
        const subsToSuspend = await tx.subscription.findMany({
          where: { customerId: customer.id, status: SubscriptionStatus.ACTIVE },
        });
        if (subsToSuspend.length > 0) {
          await tx.subscription.updateMany({
            where: { customerId: customer.id, status: SubscriptionStatus.ACTIVE },
            data: { status: SubscriptionStatus.SUSPENDED },
          });
          const validAdminUserId = await this.sanitizeAdminUserId(adminUserId);
          for (const s of subsToSuspend) {
            await tx.subscriptionHistory.create({
              data: {
                organizationId,
                subscriptionId: s.id,
                fromStatus: SubscriptionStatus.ACTIVE,
                toStatus: SubscriptionStatus.SUSPENDED,
                action: 'SUSPEND',
                reason: notes || 'Customer suspended',
                adminUserId: validAdminUserId,
              },
            });
          }
        }
      } else if (newStatus === CustomerStatus.TERMINATED) {
        // Invalidate radcheck credentials for all candidate usernames
        await tx.radCheck.deleteMany({
          where: { username: { in: targetUsernames }, attribute: 'Cleartext-Password' },
        });
        for (const u of targetUsernames) {
          await tx.radCheck.create({
            data: {
              username: u,
              attribute: 'Cleartext-Password',
              op: ':=',
              value: `TERMINATED_${Date.now()}`,
            },
          });
        }

        // Remove Calling-Station-Id checks upon customer termination so no stale check remains
        await tx.radCheck.deleteMany({
          where: { username: { in: targetUsernames }, attribute: 'Calling-Station-Id' },
        });

        // Remove all radreply attributes (terminated/decommissioned customer gets no reply attributes)
        await tx.radReply.deleteMany({
          where: { username: { in: targetUsernames } },
        });

        // Cancel all non-cancelled subscriptions per subscription FSM
        const subsToCancel = await tx.subscription.findMany({
          where: {
            customerId: customer.id,
            status: { not: SubscriptionStatus.CANCELLED },
          },
        });
        if (subsToCancel.length > 0) {
          await tx.subscription.updateMany({
            where: {
              customerId: customer.id,
              status: { not: SubscriptionStatus.CANCELLED },
            },
            data: { status: SubscriptionStatus.CANCELLED },
          });
          const validAdminUserId = await this.sanitizeAdminUserId(adminUserId);
          for (const s of subsToCancel) {
            await tx.subscriptionHistory.create({
              data: {
                organizationId,
                subscriptionId: s.id,
                fromStatus: s.status,
                toStatus: SubscriptionStatus.CANCELLED,
                action: 'CANCEL',
                reason: notes || 'Customer terminated/decommissioned',
                adminUserId: validAdminUserId,
              },
            });
          }
        }
      }

      // Record Audit Log for STATUS_CHANGE
      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: adminUserId || null,
          action: AuditAction.STATUS_CHANGE,
          entityType: 'CUSTOMER',
          entityId: customer.id,
          details: {
            oldStatus,
            newStatus,
            notes: notes || null,
          },
        },
      });

      return {
        message: `Customer status successfully changed from ${oldStatus} to ${newStatus}`,
        customer: this.formatCustomer(updated),
      };
    });

    // Asynchronously dispatch CoA or Disconnect depending on target status
    if (this.coaQueueService && customer.username) {
      if (newStatus === CustomerStatus.SUSPENDED || newStatus === CustomerStatus.TERMINATED) {
        let targetUsername = toPhysicalRadiusUsername(customer.username);
        let activeSessionId: string | undefined;
        let activeFramedIp: string | undefined;
        let activeNasIp: string | undefined;

        try {
          const candidates = getRadiusUsernameCandidates(customer.username);
          const activeSession = await prisma.radAcct.findFirst({
            where: {
              username: { in: candidates },
              acctstoptime: null,
            },
            orderBy: { acctstarttime: 'desc' },
          });
          if (activeSession) {
            targetUsername = activeSession.username;
            activeSessionId = activeSession.acctsessionid;
            activeFramedIp = activeSession.framedipaddress || undefined;
            activeNasIp = activeSession.nasipaddress || undefined;
          }
        } catch (err: any) {
          console.warn(`[CustomersService] Session resolution warning on status change: ${err.message}`);
        }

        this.coaQueueService
          .queueCoaJob({
            organizationId,
            customerId: customer.id,
            subscriptionId: (targetSub || customer.subscriptions[0])?.id,
            username: targetUsername,
            action: newStatus === CustomerStatus.TERMINATED ? 'TERMINATE' : CoaAction.SUSPEND,
            requestType: CoaRequestType.DISCONNECT,
            sessionId: activeSessionId,
            framedIp: activeFramedIp,
            nasIp: activeNasIp,
            reason: notes || `Customer transitioned to ${newStatus}`,
            adminUserId,
          })
          .catch((err) => console.warn(`[CustomersService] Failed to enqueue Disconnect on ${newStatus}: ${err.message}`));
      } else if (newStatus === CustomerStatus.ACTIVE && oldStatus !== CustomerStatus.ACTIVE) {
        this.coaQueueService
          .queueCoaJob({
            organizationId,
            customerId: customer.id,
            subscriptionId: (targetSub || customer.subscriptions[0])?.id,
            username: toPhysicalRadiusUsername(customer.username),
            action: CoaAction.REACTIVATE,
            requestType: CoaRequestType.COA,
            rateLimit,
            reason: notes || 'Customer reactivated',
            adminUserId,
          })
          .catch((err) => console.warn(`[CustomersService] Failed to enqueue CoA on reactivate: ${err.message}`));
      }
    }

    return result;
  }

  /**
   * Suspend helper
   */
  async suspend(organizationId: string, adminUserIdOrId: string | undefined, maybeId?: string) {
    const adminUserId = maybeId ? adminUserIdOrId : undefined;
    const id = maybeId || (adminUserIdOrId as string);
    return this.updateStatus(organizationId, adminUserId, id, CustomerStatus.SUSPENDED, 'Suspension triggered');
  }

  /**
   * Reactivate helper
   */
  async reactivate(organizationId: string, adminUserIdOrId: string | undefined, maybeId?: string) {
    const adminUserId = maybeId ? adminUserIdOrId : undefined;
    const id = maybeId || (adminUserIdOrId as string);
    return this.updateStatus(organizationId, adminUserId, id, CustomerStatus.ACTIVE, 'Reactivation triggered');
  }

  /**
   * Terminate helper
   */
  async terminate(organizationId: string, adminUserIdOrId: string | undefined, maybeId?: string) {
    const adminUserId = maybeId ? adminUserIdOrId : undefined;
    const id = maybeId || (adminUserIdOrId as string);
    return this.updateStatus(organizationId, adminUserId, id, CustomerStatus.TERMINATED, 'Termination triggered');
  }

  /**
   * Disconnect active PPPoE session
   */
  async disconnect(organizationId: string, id: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, organizationId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer '${id}' not found in your organization`);
    }

    const candidates = getRadiusUsernameCandidates(customer.username);
    const session = await prisma.radAcct.findFirst({
      where: { username: { in: candidates }, acctstoptime: null },
      orderBy: { acctstarttime: 'desc' },
    });

    const targetUsername = session?.username || toPhysicalRadiusUsername(customer.username);

    let nasIp = session?.nasipaddress || undefined;
    if (!nasIp) {
      const router = await prisma.router.findFirst({
        where: { organizationId },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      });
      if (router) {
        if (
          router.connectionMethod === RouterConnectionMethod.SSTP_TUNNEL ||
          router.connectionMethod === 'SSTP_TUNNEL'
        ) {
          if (!router.vpnIp) {
            throw new BadRequestException(
              'SSTP router has no vpnIp assigned; cannot reach via public host',
            );
          }
          nasIp = router.vpnIp;
        } else {
          nasIp = router.host;
        }
      }
    }

    let jobId: string | undefined;
    if (this.coaQueueService && customer.username) {
      const qRes = await this.coaQueueService.queueCoaJob({
        organizationId,
        customerId: customer.id,
        username: targetUsername,
        action: 'DISCONNECT',
        requestType: CoaRequestType.DISCONNECT,
        sessionId: session?.acctsessionid,
        framedIp: session?.framedipaddress || undefined,
        nasIp: nasIp || undefined,
        reason: 'Manual disconnect requested via customer API',
      });
      jobId = qRes.jobId;
    }

    return {
      message: 'RFC 3576 Disconnect-Request (PoD) queued to MikroTik router',
      username: customer.username,
      pppoeUsername: targetUsername,
      activeSessionId: session?.acctsessionid || null,
      nasIpAddress: nasIp,
      jobId,
      status: 'DISPATCHED',
    };
  }

  /**
   * Real-time connection & session telemetry from radacct (Tenant Enforced)
   */
  async getConnection(organizationId: string, id: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, organizationId },
      include: {
        subscriptions: {
          where: { status: SubscriptionStatus.ACTIVE },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plan: true },
        },
      },
    });
    if (!customer) {
      throw new NotFoundException(`Customer '${id}' not found in your organization`);
    }

    const candidates = getRadiusUsernameCandidates(customer.username);
    const activeSub = customer.subscriptions[0];
    const rateLimit = activeSub?.plan
      ? generateMikrotikRateLimit(activeSub.plan)
      : '50M/50M';

    // 1. Try finding an active session (acctstoptime IS NULL)
    const activeSession = await prisma.radAcct.findFirst({
      where: {
        username: { in: candidates },
        acctstoptime: null,
      },
      orderBy: { acctstarttime: 'desc' },
    });

    let isOnline = false;
    let session = activeSession;

    if (activeSession) {
      isOnline = true;
    } else {
      // 2. Fall back to latest terminated session
      session = await prisma.radAcct.findFirst({
        where: {
          username: { in: candidates },
        },
        orderBy: { acctstarttime: 'desc' },
      });
    }

    if (!session) {
      return {
        isOnline: false,
        acctSessionId: null,
        loginTime: null,
        logoutTime: null,
        sessionDuration: 0,
        framedIp: customer.staticIp || null,
        callingStationId: null,
        authorizedMac: customer.macAddress || null,
        macResetPending: Boolean(customer.macResetPending),
        isMacMatch: false,
        nasIp: null,
        routerName: null,
        nasPort: null,
        serviceType: 'Framed-User',
        currentTransfer: { downloadBytes: 0, uploadBytes: 0, totalBytes: 0 },
        rateLimit,
        lastUpdate: null,
        terminateCause: null,
      };
    }

    // Resolve Router Name from nasipaddress
    let routerName: string | null = null;
    if (session.nasipaddress) {
      const router = await prisma.router.findFirst({
        where: {
          organizationId,
          OR: [
            { vpnIp: session.nasipaddress },
            { host: session.nasipaddress, connectionMethod: 'DIRECT_API' },
          ],
        },
        orderBy: [
          { status: 'asc' },
          { updatedAt: 'desc' },
        ],
        select: { name: true },
      });
      routerName = router?.name || null;
    }

    let isMacMatch = false;
    if (customer.macAddress && session.callingstationid) {
      try {
        isMacMatch = normalizeMacAddress(customer.macAddress) === normalizeMacAddress(session.callingstationid);
      } catch {
        isMacMatch = customer.macAddress.toUpperCase() === session.callingstationid.toUpperCase();
      }
    }

    const now = Date.now();
    let sessionDuration = Number(session.acctsessiontime || 0);
    if (isOnline && session.acctstarttime) {
      sessionDuration = Math.max(0, Math.floor((now - new Date(session.acctstarttime).getTime()) / 1000));
    }

    const downloadBytes = Number(session.acctoutputoctets || 0);
    const uploadBytes = Number(session.acctinputoctets || 0);

    return {
      isOnline,
      acctSessionId: session.acctsessionid || null,
      loginTime: session.acctstarttime ? session.acctstarttime.toISOString() : null,
      logoutTime: session.acctstoptime ? session.acctstoptime.toISOString() : null,
      sessionDuration,
      framedIp: session.framedipaddress || customer.staticIp || null,
      callingStationId: session.callingstationid || null,
      authorizedMac: customer.macAddress || null,
      macResetPending: Boolean(customer.macResetPending),
      isMacMatch,
      nasIp: session.nasipaddress || null,
      routerName,
      nasPort: session.nasportid || null,
      serviceType: session.servicetype || 'Framed-User',
      currentTransfer: {
        downloadBytes,
        uploadBytes,
        totalBytes: downloadBytes + uploadBytes,
      },
      rateLimit,
      lastUpdate: (session.acctupdatetime || session.acctstarttime || new Date()).toISOString(),
      terminateCause: session.acctterminatecause || null,
    };
  }

  /**
   * Aggregate real RADIUS accounting data usage: Today, This Month, and Lifetime (Tenant Enforced)
   */
  async getUsage(organizationId: string, id: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, organizationId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer '${id}' not found in your organization`);
    }

    const candidates = getRadiusUsernameCandidates(customer.username);

    // Compute boundaries based on current server date
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const sessions = await prisma.radAcct.findMany({
      where: { username: { in: candidates } },
      select: {
        acctstarttime: true,
        acctstoptime: true,
        acctsessiontime: true,
        acctinputoctets: true,
        acctoutputoctets: true,
      },
      orderBy: { acctstarttime: 'desc' },
    });

    let todayUpload = 0;
    let todayDownload = 0;
    let todayDuration = 0;

    let monthUpload = 0;
    let monthDownload = 0;
    let monthDuration = 0;

    let lifeUpload = 0;
    let lifeDownload = 0;
    let lifeDuration = 0;

    for (const s of sessions) {
      const up = Number(s.acctinputoctets || 0);
      const down = Number(s.acctoutputoctets || 0);
      let dur = Number(s.acctsessiontime || 0);

      // If active session, calculate elapsed time
      if (!s.acctstoptime && s.acctstarttime) {
        dur = Math.max(dur, Math.floor((now.getTime() - new Date(s.acctstarttime).getTime()) / 1000));
      }

      lifeUpload += up;
      lifeDownload += down;
      lifeDuration += dur;

      if (s.acctstarttime && s.acctstarttime >= startOfMonth) {
        monthUpload += up;
        monthDownload += down;
        monthDuration += dur;
      }

      if (s.acctstarttime && s.acctstarttime >= startOfToday) {
        todayUpload += up;
        todayDownload += down;
        todayDuration += dur;
      }
    }

    return {
      today: {
        uploadBytes: todayUpload,
        downloadBytes: todayDownload,
        totalBytes: todayUpload + todayDownload,
        durationSecs: todayDuration,
      },
      month: {
        uploadBytes: monthUpload,
        downloadBytes: monthDownload,
        totalBytes: monthUpload + monthDownload,
        durationSecs: monthDuration,
      },
      lifetime: {
        uploadBytes: lifeUpload,
        downloadBytes: lifeDownload,
        totalBytes: lifeUpload + lifeDownload,
        durationSecs: lifeDuration,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Latest 10 RADIUS authentication attempts from radpostauth (Tenant Enforced)
   */
  async getAccessRequests(organizationId: string, id: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, organizationId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer '${id}' not found in your organization`);
    }

    const candidates = getRadiusUsernameCandidates(customer.username);

    const attempts = await prisma.radPostAuth.findMany({
      where: { username: { in: candidates } },
      take: 10,
      orderBy: { id: 'desc' },
      select: {
        id: true,
        username: true,
        reply: true,
        authdate: true,
      },
    });

    return attempts.map((a) => ({
      id: a.id.toString(),
      username: a.username,
      reply: a.reply,
      authdate: a.authdate ? a.authdate.toISOString() : null,
    }));
  }

  /**
   * Temporarily override subscriber bandwidth / rate-limit (Tenant Enforced, Audit Logged)
   */
  async overrideSpeed(
    organizationId: string,
    adminUserId: string | undefined,
    id: string,
    downloadMbps: number,
    uploadMbps: number,
  ) {
    if (!downloadMbps || !uploadMbps || downloadMbps <= 0 || uploadMbps <= 0) {
      throw new BadRequestException('Download and upload speeds must be positive numbers');
    }

    const customer = await prisma.customer.findFirst({
      where: { id, organizationId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer '${id}' not found in your organization`);
    }

    const targetUsernames = getRadiusUsernameCandidates(customer.username);
    const rateLimitString = `${uploadMbps}M/${downloadMbps}M`;

    // Update radreply with new Mikrotik-Rate-Limit
    await prisma.$transaction(async (tx) => {
      await tx.radReply.deleteMany({
        where: { username: { in: targetUsernames }, attribute: 'Mikrotik-Rate-Limit' },
      });
      for (const u of targetUsernames) {
        await tx.radReply.create({
          data: {
            username: u,
            attribute: 'Mikrotik-Rate-Limit',
            op: '=',
            value: rateLimitString,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: adminUserId || null,
          action: AuditAction.UPDATE,
          entityType: 'CUSTOMER',
          entityId: customer.id,
          details: {
            action: 'SPEED_OVERRIDE',
            downloadSpeedMbps: downloadMbps,
            uploadSpeedMbps: uploadMbps,
            rateLimitString,
          },
        },
      });
    });

    // If active session, dispatch CoA to update speed live
    if (this.coaQueueService && customer.username) {
      const activeSession = await prisma.radAcct.findFirst({
        where: { username: { in: targetUsernames }, acctstoptime: null },
        orderBy: { acctstarttime: 'desc' },
      });
      if (activeSession) {
        this.coaQueueService
          .queueCoaJob({
            organizationId,
            customerId: customer.id,
            username: activeSession.username,
            action: 'SPEED_OVERRIDE',
            requestType: CoaRequestType.COA,
            rateLimit: rateLimitString,
            sessionId: activeSession.acctsessionid,
            framedIp: activeSession.framedipaddress || undefined,
            nasIp: activeSession.nasipaddress || undefined,
            reason: `Speed override to ${rateLimitString}`,
            adminUserId,
          })
          .catch((err) => console.warn(`[CustomersService] Failed to enqueue CoA for speed override: ${err.message}`));
      }
    }

    return {
      message: `Bandwidth rate limit updated to ${rateLimitString}`,
      rateLimitString,
      downloadMbps,
      uploadMbps,
    };
  }

  /**
   * Helper to normalize customer fields
   */
  private formatCustomer(c: any) {
    return {
      id: c.id,
      organizationId: c.organizationId,
      customerCode: c.customerCode,
      name: c.name,
      mobile: c.mobile || c.phone || '',
      phone: c.phone || c.mobile || '',
      alternatePhone: c.alternatePhone || null,
      email: c.email || '',
      address: c.address || c.installationAddress || '',
      installationAddress: c.installationAddress || c.address || '',
      area: c.area || '',
      city: c.city || '',
      state: c.state || '',
      pincode: c.pincode || '',
      zoneId: c.zoneId || null,
      nodeId: c.nodeId || null,
      zone: c.zone ? { id: c.zone.id, name: c.zone.name } : null,
      node: c.node ? { id: c.node.id, name: c.node.name } : null,
      aadhaarNumber: c.aadhaarNumber || null,
      gstin: c.gstin || null,
      username: c.username || c.pppoeUsername || '',
      pppoeUsername: c.username || c.pppoeUsername || '',
      staticIp: c.staticIp || null,
      macAddress: c.macAddress || null,
      macResetPending: Boolean(c.macResetPending),
      status: c.status,
      installationDate: c.installationDate ? c.installationDate.toISOString() : null,
      notes: c.notes || '',
      createdAt: c.createdAt ? c.createdAt.toISOString() : null,
      subscriptions: c.subscriptions || [],
    };
  }
}
