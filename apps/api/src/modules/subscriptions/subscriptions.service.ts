import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import {
  SubscriptionStatus,
  CustomerStatus,
  BillingCycle,
  AuditAction,
  buildNetworkPolicyFromPlan,
  translateNetworkPolicyToRadius,
  calculateSubscriptionEndDate,
  calculateGracePeriodEndDate,
  validateSubscriptionTransition,
  DEFAULT_TIMEZONE,
} from '@isp-crm/shared';

export interface SubscriptionListFilter {
  status?: string;
  search?: string;
  customerId?: string;
}

@Injectable()
export class SubscriptionsService {
  /**
   * Helper to verify and sanitize adminUserId against foreign key constraint
   */
  private async sanitizeAdminUserId(adminUserId?: string): Promise<string | null> {
    if (!adminUserId) return null;
    const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
    return admin ? admin.id : null;
  }

  /**
   * List subscriptions scoped to tenant organization with optional status and customer filter
   */
  async list(organizationId: string, filter?: SubscriptionListFilter) {
    const where: any = { organizationId };

    if (filter?.status && filter.status !== 'ALL') {
      where.status = filter.status.toUpperCase() as SubscriptionStatus;
    }

    if (filter?.customerId) {
      where.customerId = filter.customerId;
    }

    if (filter?.search) {
      const q = filter.search.trim();
      where.OR = [
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { username: { contains: q, mode: 'insensitive' } } },
        { customer: { mobile: { contains: q, mode: 'insensitive' } } },
        { plan: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    return prisma.subscription.findMany({
      where,
      take: 100,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        plan: true,
        history: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  /**
   * Get subscription by ID with full relations and history timeline
   */
  async getById(organizationId: string, id: string) {
    const subscription = await prisma.subscription.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        plan: true,
        history: {
          orderBy: { createdAt: 'desc' },
          include: {
            adminUser: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        invoices: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found in your organization');
    }

    return subscription;
  }

  /**
   * Create new subscription with server-side date calculation, FSM validation, and initial history record
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

    const {
      customerId,
      planId,
      autoRenew = true,
      gracePeriodDays = 3,
      startDate: inputStartDate,
      status: inputStatus,
      billingCycle: inputBillingCycle,
      price: inputPrice,
    } = data;

    if (!customerId || !planId) {
      throw new BadRequestException('customerId and planId are required');
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found in your organization');
    }

    const plan = await prisma.internetPlan.findFirst({
      where: { id: planId, organizationId },
    });
    if (!plan) {
      throw new NotFoundException('Internet plan not found in your organization');
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const tz = org?.timezone || DEFAULT_TIMEZONE;

    const billingCycle = (inputBillingCycle as BillingCycle) || plan.billingCycle || BillingCycle.MONTHLY;
    const price = inputPrice !== undefined ? Number(inputPrice) : Number(plan.price);
    const targetStatus = (inputStatus as SubscriptionStatus) || SubscriptionStatus.ACTIVE;

    const startDate = inputStartDate ? new Date(inputStartDate) : new Date();
    const endDate = calculateSubscriptionEndDate(startDate, billingCycle, plan.validityDays, tz);

    const radiusPolicy = translateNetworkPolicyToRadius(buildNetworkPolicyFromPlan(plan));
    const rateLimit = radiusPolicy['Mikrotik-Rate-Limit'];
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    return prisma.$transaction(async (tx) => {
      if (targetStatus === SubscriptionStatus.ACTIVE) {
        await tx.subscription.updateMany({
          where: {
            customerId,
            organizationId,
            status: SubscriptionStatus.ACTIVE,
          },
          data: { status: SubscriptionStatus.EXPIRED },
        });
      }

      const subscription = await tx.subscription.create({
        data: {
          organizationId,
          customerId,
          planId,
          status: targetStatus,
          startDate,
          endDate,
          price,
          billingCycle,
          autoRenew,
          gracePeriodDays: Number(gracePeriodDays || 3),
        },
        include: {
          customer: true,
          plan: true,
        },
      });

      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: subscription.id,
          fromStatus: null,
          toStatus: targetStatus,
          action: 'CREATE',
          reason: 'Initial subscription creation',
          adminUserId: finalAdminUserId,
          toPlanId: planId,
          newEndDate: endDate,
          metadata: {
            price,
            billingCycle,
            autoRenew,
            gracePeriodDays,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: finalAdminUserId,
          action: AuditAction.CREATE,
          entityType: 'SUBSCRIPTION',
          entityId: subscription.id,
          details: {
            customerId,
            planId,
            price,
            status: targetStatus,
            startDate,
            endDate,
          },
        },
      });

      if (targetStatus === SubscriptionStatus.ACTIVE) {
        await this.syncRadiusOnActivation(tx, customer, rateLimit);
      }

      return subscription;
    });
  }

  /**
   * Activate a PENDING subscription
   */
  async activate(
    organizationId: string,
    adminUserIdOrId: string,
    maybeId?: string,
  ) {
    let adminUserId: string | undefined;
    let id: string;

    if (maybeId !== undefined) {
      adminUserId = adminUserIdOrId;
      id = maybeId;
    } else {
      adminUserId = undefined;
      id = adminUserIdOrId;
    }

    const sub = await this.getById(organizationId, id);
    validateSubscriptionTransition(sub.status as SubscriptionStatus, SubscriptionStatus.ACTIVE, 'activate');

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const tz = org?.timezone || DEFAULT_TIMEZONE;

    const startDate = new Date();
    const endDate = calculateSubscriptionEndDate(startDate, sub.billingCycle, sub.plan.validityDays, tz);
    const radiusPolicy = translateNetworkPolicyToRadius(buildNetworkPolicyFromPlan(sub.plan));
    const rateLimit = radiusPolicy['Mikrotik-Rate-Limit'];
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    return prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: {
          customerId: sub.customerId,
          organizationId,
          status: SubscriptionStatus.ACTIVE,
          id: { not: sub.id },
        },
        data: { status: SubscriptionStatus.EXPIRED },
      });

      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          startDate,
          endDate,
        },
        include: {
          customer: true,
          plan: true,
        },
      });

      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: updated.id,
          fromStatus: sub.status as SubscriptionStatus,
          toStatus: SubscriptionStatus.ACTIVE,
          action: 'ACTIVATE',
          reason: 'Subscription activated by administrator',
          adminUserId: finalAdminUserId,
          newEndDate: endDate,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: finalAdminUserId,
          action: AuditAction.STATUS_CHANGE,
          entityType: 'SUBSCRIPTION',
          entityId: updated.id,
          details: {
            fromStatus: sub.status,
            toStatus: SubscriptionStatus.ACTIVE,
            startDate,
            endDate,
          },
        },
      });

      await this.syncRadiusOnActivation(tx, sub.customer, rateLimit);

      return updated;
    });
  }

  /**
   * Renew subscription with server-side date calculation
   */
  async renew(
    organizationId: string,
    adminUserIdOrId: string,
    idOrOptions?: any,
    maybeOptions?: any,
  ) {
    let adminUserId: string | undefined;
    let id: string;
    let options: any;

    if (maybeOptions !== undefined) {
      adminUserId = adminUserIdOrId;
      id = idOrOptions;
      options = maybeOptions;
    } else if (typeof idOrOptions === 'string') {
      adminUserId = adminUserIdOrId;
      id = idOrOptions;
      options = undefined;
    } else {
      adminUserId = undefined;
      id = adminUserIdOrId;
      options = idOrOptions;
    }

    const sub = await this.getById(organizationId, id);
    validateSubscriptionTransition(sub.status as SubscriptionStatus, SubscriptionStatus.ACTIVE, 'renew');

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const tz = org?.timezone || DEFAULT_TIMEZONE;

    const billingCycle = options?.billingCycle || sub.billingCycle;
    const validityDays = options?.validityDays || sub.plan.validityDays;

    const now = new Date();
    const anchorDate = new Date(sub.endDate) > now ? new Date(sub.endDate) : now;
    const newEndDate = calculateSubscriptionEndDate(anchorDate, billingCycle, validityDays, tz);

    const radiusPolicy = translateNetworkPolicyToRadius(buildNetworkPolicyFromPlan(sub.plan));
    const rateLimit = radiusPolicy['Mikrotik-Rate-Limit'];
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          endDate: newEndDate,
          status: SubscriptionStatus.ACTIVE,
          billingCycle,
        },
        include: {
          customer: true,
          plan: true,
        },
      });

      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: updated.id,
          fromStatus: sub.status as SubscriptionStatus,
          toStatus: SubscriptionStatus.ACTIVE,
          action: 'RENEW',
          reason: 'Subscription renewal extended validity',
          adminUserId: finalAdminUserId,
          oldEndDate: sub.endDate,
          newEndDate,
          metadata: {
            billingCycle,
            validityDays,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: finalAdminUserId,
          action: AuditAction.STATUS_CHANGE,
          entityType: 'SUBSCRIPTION',
          entityId: updated.id,
          details: {
            action: 'RENEW',
            oldEndDate: sub.endDate,
            newEndDate,
          },
        },
      });

      await this.syncRadiusOnActivation(tx, sub.customer, rateLimit);

      return updated;
    });
  }

  /**
   * Upgrade to a higher tier plan
   */
  async upgrade(
    organizationId: string,
    adminUserIdOrId: string,
    idOrPlanId: string,
    planIdOrReason?: string,
    maybeReason?: string,
  ) {
    let adminUserId: string | undefined;
    let id: string;
    let newPlanId: string;
    let reason: string | undefined;

    if (maybeReason !== undefined) {
      adminUserId = adminUserIdOrId;
      id = idOrPlanId;
      newPlanId = planIdOrReason as string;
      reason = maybeReason;
    } else if (planIdOrReason !== undefined) {
      const admin = await prisma.adminUser.findUnique({ where: { id: adminUserIdOrId } });
      if (admin) {
        adminUserId = adminUserIdOrId;
        id = idOrPlanId;
        newPlanId = planIdOrReason;
        reason = undefined;
      } else {
        adminUserId = undefined;
        id = adminUserIdOrId;
        newPlanId = idOrPlanId;
        reason = planIdOrReason;
      }
    } else {
      adminUserId = undefined;
      id = adminUserIdOrId;
      newPlanId = idOrPlanId;
      reason = undefined;
    }

    const sub = await this.getById(organizationId, id);

    if (sub.status !== SubscriptionStatus.ACTIVE && sub.status !== SubscriptionStatus.GRACE) {
      throw new BadRequestException(`Cannot upgrade subscription in '${sub.status}' status`);
    }

    const newPlan = await prisma.internetPlan.findFirst({
      where: { id: newPlanId, organizationId },
    });
    if (!newPlan) {
      throw new NotFoundException('New internet plan not found in your organization');
    }

    const radiusPolicy = translateNetworkPolicyToRadius(buildNetworkPolicyFromPlan(newPlan));
    const rateLimit = radiusPolicy['Mikrotik-Rate-Limit'];
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          planId: newPlan.id,
          price: newPlan.price,
        },
        include: { customer: true, plan: true },
      });

      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: updated.id,
          fromStatus: sub.status as SubscriptionStatus,
          toStatus: sub.status as SubscriptionStatus,
          action: 'UPGRADE',
          reason: reason || `Upgraded to ${newPlan.name}`,
          adminUserId: finalAdminUserId,
          fromPlanId: sub.planId,
          toPlanId: newPlan.id,
          metadata: {
            oldPrice: sub.price,
            newPrice: newPlan.price,
          },
        },
      });

      await tx.radReply.deleteMany({
        where: { username: sub.customer.username, attribute: 'Mikrotik-Rate-Limit' },
      });
      await tx.radReply.create({
        data: {
          username: sub.customer.username,
          attribute: 'Mikrotik-Rate-Limit',
          op: '=',
          value: rateLimit,
        },
      });

      return updated;
    });
  }

  /**
   * Downgrade to a lower tier plan
   */
  async downgrade(
    organizationId: string,
    adminUserIdOrId: string,
    idOrPlanId: string,
    planIdOrReason?: string,
    maybeReason?: string,
  ) {
    let adminUserId: string | undefined;
    let id: string;
    let newPlanId: string;
    let reason: string | undefined;

    if (maybeReason !== undefined) {
      adminUserId = adminUserIdOrId;
      id = idOrPlanId;
      newPlanId = planIdOrReason as string;
      reason = maybeReason;
    } else if (planIdOrReason !== undefined) {
      const admin = await prisma.adminUser.findUnique({ where: { id: adminUserIdOrId } });
      if (admin) {
        adminUserId = adminUserIdOrId;
        id = idOrPlanId;
        newPlanId = planIdOrReason;
        reason = undefined;
      } else {
        adminUserId = undefined;
        id = adminUserIdOrId;
        newPlanId = idOrPlanId;
        reason = planIdOrReason;
      }
    } else {
      adminUserId = undefined;
      id = adminUserIdOrId;
      newPlanId = idOrPlanId;
      reason = undefined;
    }

    const sub = await this.getById(organizationId, id);

    if (sub.status !== SubscriptionStatus.ACTIVE && sub.status !== SubscriptionStatus.GRACE) {
      throw new BadRequestException(`Cannot downgrade subscription in '${sub.status}' status`);
    }

    const newPlan = await prisma.internetPlan.findFirst({
      where: { id: newPlanId, organizationId },
    });
    if (!newPlan) {
      throw new NotFoundException('New internet plan not found in your organization');
    }

    const radiusPolicy = translateNetworkPolicyToRadius(buildNetworkPolicyFromPlan(newPlan));
    const rateLimit = radiusPolicy['Mikrotik-Rate-Limit'];
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          planId: newPlan.id,
          price: newPlan.price,
        },
        include: { customer: true, plan: true },
      });

      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: updated.id,
          fromStatus: sub.status as SubscriptionStatus,
          toStatus: sub.status as SubscriptionStatus,
          action: 'DOWNGRADE',
          reason: reason || `Downgraded to ${newPlan.name}`,
          adminUserId: finalAdminUserId,
          fromPlanId: sub.planId,
          toPlanId: newPlan.id,
          metadata: {
            oldPrice: sub.price,
            newPrice: newPlan.price,
          },
        },
      });

      await tx.radReply.deleteMany({
        where: { username: sub.customer.username, attribute: 'Mikrotik-Rate-Limit' },
      });
      await tx.radReply.create({
        data: {
          username: sub.customer.username,
          attribute: 'Mikrotik-Rate-Limit',
          op: '=',
          value: rateLimit,
        },
      });

      return updated;
    });
  }

  /**
   * Alias for changePlan (supports upgrade/downgrade)
   */
  async changePlan(
    organizationId: string,
    adminUserIdOrId: string,
    idOrPlanId: string,
    maybePlanId?: string,
  ) {
    if (maybePlanId !== undefined) {
      return this.upgrade(organizationId, adminUserIdOrId, idOrPlanId, maybePlanId);
    }
    return this.upgrade(organizationId, adminUserIdOrId, idOrPlanId);
  }

  /**
   * Suspend an active or grace subscription
   */
  async suspend(
    organizationId: string,
    adminUserIdOrId: string,
    idOrReason?: string,
    maybeReason?: string,
  ) {
    let adminUserId: string | undefined;
    let id: string;
    let reason: string | undefined;

    if (maybeReason !== undefined) {
      adminUserId = adminUserIdOrId;
      id = idOrReason as string;
      reason = maybeReason;
    } else if (idOrReason !== undefined) {
      const admin = await prisma.adminUser.findUnique({ where: { id: adminUserIdOrId } });
      if (admin) {
        adminUserId = adminUserIdOrId;
        id = idOrReason;
        reason = undefined;
      } else {
        adminUserId = undefined;
        id = adminUserIdOrId;
        reason = idOrReason;
      }
    } else {
      adminUserId = undefined;
      id = adminUserIdOrId;
      reason = undefined;
    }

    const sub = await this.getById(organizationId, id);
    validateSubscriptionTransition(sub.status as SubscriptionStatus, SubscriptionStatus.SUSPENDED, 'suspend');
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.SUSPENDED },
        include: { customer: true, plan: true },
      });

      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: updated.id,
          fromStatus: sub.status as SubscriptionStatus,
          toStatus: SubscriptionStatus.SUSPENDED,
          action: 'SUSPEND',
          reason: reason || 'Suspension applied',
          adminUserId: finalAdminUserId,
        },
      });

      await tx.customer.update({
        where: { id: sub.customerId },
        data: { status: CustomerStatus.SUSPENDED },
      });

      await this.syncRadiusOnDeactivation(tx, sub.customer);

      return updated;
    });
  }

  /**
   * Reactivate a SUSPENDED subscription
   */
  async reactivate(
    organizationId: string,
    adminUserIdOrId: string,
    maybeId?: string,
  ) {
    let adminUserId: string | undefined;
    let id: string;

    if (maybeId !== undefined) {
      adminUserId = adminUserIdOrId;
      id = maybeId;
    } else {
      adminUserId = undefined;
      id = adminUserIdOrId;
    }

    const sub = await this.getById(organizationId, id);
    validateSubscriptionTransition(sub.status as SubscriptionStatus, SubscriptionStatus.ACTIVE, 'reactivate');

    const now = new Date();
    const graceEndDate = calculateGracePeriodEndDate(sub.endDate, sub.gracePeriodDays);

    if (now > graceEndDate) {
      throw new BadRequestException(
        'Cannot reactivate subscription whose validity and grace period have expired. Please renew the subscription instead.',
      );
    }

    const targetStatus = now <= sub.endDate ? SubscriptionStatus.ACTIVE : SubscriptionStatus.GRACE;
    const radiusPolicy = translateNetworkPolicyToRadius(buildNetworkPolicyFromPlan(sub.plan));
    const rateLimit = radiusPolicy['Mikrotik-Rate-Limit'];
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: { status: targetStatus },
        include: { customer: true, plan: true },
      });

      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: updated.id,
          fromStatus: SubscriptionStatus.SUSPENDED,
          toStatus: targetStatus,
          action: 'REACTIVATE',
          reason: 'Subscription reactivated',
          adminUserId: finalAdminUserId,
        },
      });

      await this.syncRadiusOnActivation(tx, sub.customer, rateLimit);

      return updated;
    });
  }

  /**
   * Expire subscription (when validity & grace period elapsed)
   */
  async expire(
    organizationId: string,
    adminUserIdOrId: string,
    idOrReason?: string,
    maybeReason?: string,
  ) {
    let adminUserId: string | undefined;
    let id: string;
    let reason: string | undefined;

    if (maybeReason !== undefined) {
      adminUserId = adminUserIdOrId;
      id = idOrReason as string;
      reason = maybeReason;
    } else if (idOrReason !== undefined) {
      const admin = await prisma.adminUser.findUnique({ where: { id: adminUserIdOrId } });
      if (admin) {
        adminUserId = adminUserIdOrId;
        id = idOrReason;
        reason = undefined;
      } else {
        adminUserId = undefined;
        id = adminUserIdOrId;
        reason = idOrReason;
      }
    } else {
      adminUserId = undefined;
      id = adminUserIdOrId;
      reason = undefined;
    }

    const sub = await this.getById(organizationId, id);
    validateSubscriptionTransition(sub.status as SubscriptionStatus, SubscriptionStatus.EXPIRED, 'expire');
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.EXPIRED },
        include: { customer: true, plan: true },
      });

      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: updated.id,
          fromStatus: sub.status as SubscriptionStatus,
          toStatus: SubscriptionStatus.EXPIRED,
          action: 'EXPIRE',
          reason: reason || 'Validity and grace period expired',
          adminUserId: finalAdminUserId,
        },
      });

      await tx.customer.update({
        where: { id: sub.customerId },
        data: { status: CustomerStatus.EXPIRED },
      });

      await this.syncRadiusOnDeactivation(tx, sub.customer);

      return updated;
    });
  }

  /**
   * Cancel subscription (terminal state)
   */
  async cancel(
    organizationId: string,
    adminUserIdOrId: string,
    idOrReason?: string,
    maybeReason?: string,
  ) {
    let adminUserId: string | undefined;
    let id: string;
    let reason: string | undefined;

    if (maybeReason !== undefined) {
      adminUserId = adminUserIdOrId;
      id = idOrReason as string;
      reason = maybeReason;
    } else if (idOrReason !== undefined) {
      const admin = await prisma.adminUser.findUnique({ where: { id: adminUserIdOrId } });
      if (admin) {
        adminUserId = adminUserIdOrId;
        id = idOrReason;
        reason = undefined;
      } else {
        adminUserId = undefined;
        id = adminUserIdOrId;
        reason = idOrReason;
      }
    } else {
      adminUserId = undefined;
      id = adminUserIdOrId;
      reason = undefined;
    }

    const sub = await this.getById(organizationId, id);
    validateSubscriptionTransition(sub.status as SubscriptionStatus, SubscriptionStatus.CANCELLED, 'cancel');
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.CANCELLED },
        include: { customer: true, plan: true },
      });

      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: updated.id,
          fromStatus: sub.status as SubscriptionStatus,
          toStatus: SubscriptionStatus.CANCELLED,
          action: 'CANCEL',
          reason: reason || 'Subscription cancelled',
          adminUserId: finalAdminUserId,
        },
      });

      await this.syncRadiusOnDeactivation(tx, sub.customer);

      return updated;
    });
  }

  /**
   * Get immutable audit history timeline for a subscription
   */
  async getHistory(organizationId: string, subscriptionId: string) {
    await this.getById(organizationId, subscriptionId);

    return prisma.subscriptionHistory.findMany({
      where: { subscriptionId, organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        adminUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  /**
   * Helper to sync FreeRADIUS credentials & authorization reply attributes upon activation
   */
  private async syncRadiusOnActivation(tx: any, customer: any, rateLimit: string) {
    await tx.customer.update({
      where: { id: customer.id },
      data: { status: CustomerStatus.ACTIVE },
    });

    if (!customer.username) return;

    // 1. Valid subscriber authentication in radcheck
    await tx.radCheck.deleteMany({
      where: { username: customer.username, attribute: 'Cleartext-Password' },
    });
    await tx.radCheck.create({
      data: {
        username: customer.username,
        attribute: 'Cleartext-Password',
        op: ':=',
        value: customer.pppoePassword || '123456',
      },
    });

    // 2. Clear previous reply attributes
    await tx.radReply.deleteMany({
      where: { username: customer.username },
    });

    // 3. Set standard PPPoE & MikroTik authorization attributes
    const replyAttributes = [
      {
        username: customer.username,
        attribute: 'Mikrotik-Rate-Limit',
        op: '=',
        value: rateLimit,
      },
      {
        username: customer.username,
        attribute: 'Framed-Protocol',
        op: '=',
        value: 'PPP',
      },
      {
        username: customer.username,
        attribute: 'Service-Type',
        op: '=',
        value: 'Framed-User',
      },
      {
        username: customer.username,
        attribute: 'Acct-Interim-Interval',
        op: '=',
        value: '300',
      },
    ];

    if (customer.staticIp) {
      replyAttributes.push({
        username: customer.username,
        attribute: 'Framed-IP-Address',
        op: '=',
        value: customer.staticIp,
      });
    }

    await tx.radReply.createMany({
      data: replyAttributes,
    });
  }

  /**
   * Helper to invalidate credentials & remove reply attributes upon suspension/expiry/cancellation
   */
  private async syncRadiusOnDeactivation(tx: any, customer: any) {
    if (!customer.username) return;

    // Invalidate password in radcheck to trigger Access-Reject
    await tx.radCheck.deleteMany({
      where: { username: customer.username, attribute: 'Cleartext-Password' },
    });
    await tx.radCheck.create({
      data: {
        username: customer.username,
        attribute: 'Cleartext-Password',
        op: ':=',
        value: `DISABLED_${Date.now()}`,
      },
    });

    // Remove all authorization replies
    await tx.radReply.deleteMany({
      where: { username: customer.username },
    });
  }
}
