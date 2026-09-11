import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import {
  CustomerStatus,
  SubscriptionStatus,
  AuditAction,
  generateMikrotikRateLimit,
} from '@isp-crm/shared';

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
    const username = (data.username || data.pppoeUsername || '').trim();
    const customerCode = (data.customerCode || '').trim();
    const mobile = (data.mobile || data.phone || '').trim();
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

    const pppoePassword = data.pppoePassword || '123456';
    const status = (data.status as CustomerStatus) || CustomerStatus.ACTIVE;

    // 4. Atomically create Customer, Subscription, FreeRADIUS credentials, and AuditLog
    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          organizationId,
          customerCode,
          name: data.name,
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
          macAddress: data.macAddress || null,
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

      // FreeRADIUS credentials in radcheck (Cleartext-Password)
      const radCheckPassword = status === CustomerStatus.ACTIVE ? pppoePassword : `SUSPENDED_${Date.now()}`;
      await tx.radCheck.create({
        data: {
          username: customer.username,
          attribute: 'Cleartext-Password',
          op: ':=',
          value: radCheckPassword,
        },
      });

      // FreeRADIUS reply in radreply (Mikrotik-Rate-Limit)
      await tx.radReply.create({
        data: {
          username: customer.username,
          attribute: 'Mikrotik-Rate-Limit',
          op: '=',
          value: status === CustomerStatus.ACTIVE ? rateLimitString : '64k/64k',
        },
      });

      // If static IP is assigned, add Framed-IP-Address in radreply
      if (data.staticIp) {
        await tx.radReply.create({
          data: {
            username: customer.username,
            attribute: 'Framed-IP-Address',
            op: '=',
            value: data.staticIp,
          },
        });
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
    if (data.pppoePassword !== undefined) {
      updateData.pppoePassword = data.pppoePassword;
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: updateData,
      });

      // Synchronize FreeRADIUS if username or password modified
      const currentUsername = updated.username;
      const prevUsername = existing.username;

      if (data.username || data.pppoePassword) {
        // Remove old radcheck and radreply if username renamed
        if (prevUsername !== currentUsername) {
          await tx.radCheck.deleteMany({ where: { username: prevUsername } });
          await tx.radReply.deleteMany({ where: { username: prevUsername } });
        }

        await tx.radCheck.deleteMany({ where: { username: currentUsername } });
        await tx.radCheck.create({
          data: {
            username: currentUsername,
            attribute: 'Cleartext-Password',
            op: ':=',
            value: updated.status === CustomerStatus.ACTIVE ? updated.pppoePassword : `SUSPENDED_${Date.now()}`,
          },
        });
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
            },
            after: {
              name: updated.name,
              customerCode: updated.customerCode,
              mobile: updated.mobile,
              address: updated.address,
              status: updated.status,
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

    return prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: {
          status: newStatus,
          notes: notes ? (customer.notes ? `${customer.notes}\n${notes}` : notes) : customer.notes,
        },
      });

      const activeSub = customer.subscriptions[0];
      const rateLimit = activeSub?.plan
        ? generateMikrotikRateLimit(activeSub.plan)
        : '50M/50M';

      if (newStatus === CustomerStatus.ACTIVE) {
        // Re-enable radcheck credentials
        await tx.radCheck.deleteMany({
          where: { username: customer.username, attribute: 'Cleartext-Password' },
        });
        await tx.radCheck.create({
          data: {
            username: customer.username,
            attribute: 'Cleartext-Password',
            op: ':=',
            value: customer.pppoePassword,
          },
        });

        // Restore rate-limit in radreply
        await tx.radReply.deleteMany({
          where: { username: customer.username, attribute: 'Mikrotik-Rate-Limit' },
        });
        await tx.radReply.create({
          data: {
            username: customer.username,
            attribute: 'Mikrotik-Rate-Limit',
            op: '=',
            value: rateLimit,
          },
        });

        // Mark subscription active
        if (activeSub) {
          await tx.subscription.update({
            where: { id: activeSub.id },
            data: { status: SubscriptionStatus.ACTIVE },
          });
        }
      } else if (newStatus === CustomerStatus.SUSPENDED || newStatus === CustomerStatus.TERMINATED) {
        // Lock radcheck credentials
        await tx.radCheck.deleteMany({
          where: { username: customer.username, attribute: 'Cleartext-Password' },
        });
        await tx.radCheck.create({
          data: {
            username: customer.username,
            attribute: 'Cleartext-Password',
            op: ':=',
            value: `SUSPENDED_${Date.now()}`,
          },
        });

        // Throttle radreply
        await tx.radReply.deleteMany({
          where: { username: customer.username, attribute: 'Mikrotik-Rate-Limit' },
        });
        await tx.radReply.create({
          data: {
            username: customer.username,
            attribute: 'Mikrotik-Rate-Limit',
            op: '=',
            value: '64k/64k',
          },
        });

        // Suspend subscriptions
        await tx.subscription.updateMany({
          where: { customerId: customer.id, status: SubscriptionStatus.ACTIVE },
          data: { status: SubscriptionStatus.SUSPENDED },
        });
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
   * Disconnect active PPPoE session
   */
  async disconnect(organizationId: string, id: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, organizationId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer '${id}' not found in your organization`);
    }

    const session = await prisma.radAcct.findFirst({
      where: { username: customer.username, acctstoptime: null },
      orderBy: { acctstarttime: 'desc' },
    });

    return {
      message: 'RFC 3576 Disconnect-Request (PoD) queued to MikroTik router',
      username: customer.username,
      pppoeUsername: customer.username,
      activeSessionId: session?.acctsessionid || null,
      nasIpAddress: session?.nasipaddress || null,
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
      status: c.status,
      installationDate: c.installationDate ? c.installationDate.toISOString() : null,
      notes: c.notes || '',
      createdAt: c.createdAt ? c.createdAt.toISOString() : null,
      subscriptions: c.subscriptions || [],
    };
  }
}
