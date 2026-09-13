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
  getRadiusUsernameCandidates,
  toPhysicalRadiusUsername,
  normalizeMacAddress,
} from '@isp-crm/shared';
import { RadiusCoaQueueService } from '../radius/radius-coa-queue.service';

export interface CustomerListFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  area?: string;
  city?: string;
}

@Injectable()
export class CustomersService {
  constructor(
    @Optional() private readonly coaQueueService?: RadiusCoaQueueService,
  ) {}
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

    // 4. Atomically create Customer, Subscription, FreeRADIUS credentials, and AuditLog
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
          username,
          pppoeUsername: username,
          pppoePassword,
          staticIp: data.staticIp || null,
          macAddress: canonicalMac,
          status,
          installationDate: data.installationDate ? new Date(data.installationDate) : null,
          notes: data.notes || null,
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

    // Check customerCode uniqueness if changing
    if (data.customerCode && data.customerCode !== existing.customerCode) {
      const codeExists = await prisma.customer.findUnique({
        where: {
          organizationId_customerCode: {
            organizationId,
            customerCode: data.customerCode,
          },
        },
      });
      if (codeExists) {
        throw new ConflictException(`Customer code '${data.customerCode}' is already taken`);
      }
    }

    // Check username uniqueness if changing
    if (data.username && data.username !== existing.username) {
      const usernameExists = await prisma.customer.findUnique({
        where: { username: data.username },
      });
      if (usernameExists) {
        throw new ConflictException(`Username '${data.username}' is already taken`);
      }
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.customerCode !== undefined) updateData.customerCode = data.customerCode;
    if (data.mobile !== undefined) {
      updateData.mobile = data.mobile;
      updateData.phone = data.mobile;
    }
    if (data.email !== undefined) updateData.email = data.email || null;
    if (data.address !== undefined) {
      updateData.address = data.address;
      updateData.installationAddress = data.address;
    }
    if (data.area !== undefined) updateData.area = data.area || null;
    if (data.city !== undefined) updateData.city = data.city || null;
    if (data.state !== undefined) updateData.state = data.state || null;
    if (data.pincode !== undefined) updateData.pincode = data.pincode || null;
    if (data.notes !== undefined) updateData.notes = data.notes || null;
    if (data.installationDate !== undefined) {
      updateData.installationDate = data.installationDate ? new Date(data.installationDate) : null;
    }
    if (data.staticIp !== undefined) updateData.staticIp = data.staticIp || null;

    if (data.username !== undefined) {
      updateData.username = data.username;
      updateData.pppoeUsername = data.username;
    }
    if (
      data.pppoePassword !== undefined &&
      data.pppoePassword !== null &&
      typeof data.pppoePassword === 'string' &&
      data.pppoePassword.trim() !== ''
    ) {
      updateData.pppoePassword = data.pppoePassword.trim();
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
      }
      updateData.macAddress = canonicalMac;
    } else {
      canonicalMac = existing.macAddress || null;
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: updateData,
      });

      // Synchronize FreeRADIUS if username, password, or macAddress modified
      const currentUsername = updated.username;
      const prevUsername = existing.username;
      const isRenamed = prevUsername !== currentUsername;

      const hasPasswordChange =
        data.pppoePassword !== undefined &&
        data.pppoePassword !== null &&
        typeof data.pppoePassword === 'string' &&
        data.pppoePassword.trim() !== '';

      if (isRenamed) {
        const prevCandidates = getRadiusUsernameCandidates(prevUsername);
        await tx.radCheck.deleteMany({ where: { username: { in: prevCandidates } } });
        await tx.radReply.deleteMany({ where: { username: { in: prevCandidates } } });
      }

      const targetUsernames = getRadiusUsernameCandidates(currentUsername);

      // 1. Password synchronization
      if (isRenamed || hasPasswordChange) {
        await tx.radCheck.deleteMany({ where: { username: { in: targetUsernames }, attribute: 'Cleartext-Password' } });
        for (const u of targetUsernames) {
          await tx.radCheck.create({
            data: {
              username: u,
              attribute: 'Cleartext-Password',
              op: ':=',
              value: updated.status === CustomerStatus.ACTIVE ? updated.pppoePassword : `SUSPENDED_${Date.now()}`,
            },
          });
        }
      }

      // 2. MAC address synchronization if macAddress was modified or if username renamed
      if (hasMacChange || isRenamed) {
        await tx.radCheck.deleteMany({
          where: { username: { in: targetUsernames }, attribute: 'Calling-Station-Id' },
        });

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

      // Record Audit Log for UPDATE
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
              mobile: existing.mobile,
              address: existing.address,
              status: existing.status,
              macAddress: existing.macAddress,
            },
            after: {
              name: updated.name,
              customerCode: updated.customerCode,
              mobile: updated.mobile,
              address: updated.address,
              status: updated.status,
              macAddress: updated.macAddress,
            },
          },
        },
      });

      return this.formatCustomer(updated);
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
    const activeSub = customer.subscriptions[0];
    const rateLimit = activeSub?.plan
      ? generateMikrotikRateLimit(activeSub.plan)
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

        // Mark subscription active
        if (activeSub) {
          await tx.subscription.update({
            where: { id: activeSub.id },
            data: { status: SubscriptionStatus.ACTIVE },
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
        await tx.subscription.updateMany({
          where: { customerId: customer.id, status: SubscriptionStatus.ACTIVE },
          data: { status: SubscriptionStatus.SUSPENDED },
        });
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
          for (const s of subsToCancel) {
            await tx.subscriptionHistory.create({
              data: {
                organizationId,
                subscriptionId: s.id,
                fromStatus: s.status,
                toStatus: SubscriptionStatus.CANCELLED,
                action: 'CANCEL',
                reason: notes || 'Customer terminated/decommissioned',
                adminUserId: adminUserId || null,
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
            subscriptionId: activeSub?.id,
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
            subscriptionId: activeSub?.id,
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
      });
      nasIp = router?.host || undefined;
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
   * Helper to normalize customer fields
   */
  private formatCustomer(c: any) {
    return {
      id: c.id,
      organizationId: c.organizationId,
      customerCode: c.customerCode,
      name: c.name,
      mobile: c.mobile || c.phone || '',
      phone: c.mobile || c.phone || '',
      email: c.email || '',
      address: c.address || c.installationAddress || '',
      installationAddress: c.address || c.installationAddress || '',
      area: c.area || '',
      city: c.city || '',
      state: c.state || '',
      pincode: c.pincode || '',
      username: c.username || c.pppoeUsername || '',
      pppoeUsername: c.username || c.pppoeUsername || '',
      staticIp: c.staticIp || null,
      macAddress: c.macAddress || null,
      status: c.status,
      installationDate: c.installationDate ? c.installationDate.toISOString() : null,
      notes: c.notes || '',
      createdAt: c.createdAt ? c.createdAt.toISOString() : null,
      subscriptions: c.subscriptions || [],
    };
  }
}
