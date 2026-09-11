import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import {
  PlanStatus,
  BillingCycle,
  SpeedUnit,
  AuditAction,
  buildNetworkPolicyFromPlan,
  translateNetworkPolicyToRadius,
  NetworkPolicyGenerator,
} from '@isp-crm/shared';

export interface PlanListFilter {
  status?: string;
  search?: string;
}

@Injectable()
export class PlansService {
  /**
   * List internet plans scoped to current organization with optional search and status filter
   */
  async list(organizationId: string, filter?: PlanListFilter) {
    const where: any = { organizationId };

    if (filter?.status && filter.status !== 'ALL') {
      where.status = filter.status.toUpperCase() as PlanStatus;
    }

    if (filter?.search) {
      const q = filter.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const plans = await prisma.internetPlan.findMany({
      where,
      orderBy: [{ status: 'asc' }, { downloadSpeedMbps: 'asc' }],
      include: {
        _count: {
          select: { subscriptions: true },
        },
      },
    });

    return plans.map((p) => this.formatPlan(p));
  }

  /**
   * Create new internet plan ensuring organization scoping, network policy generation, and audit logging
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
    if (!name) {
      throw new ConflictException('Plan name is required');
    }

    // Auto-generate plan code if omitted
    const code = (
      data.code ||
      `PLAN-${name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().slice(0, 16)}-${Date.now().toString().slice(-4)}`
    ).trim();

    const existing = await prisma.internetPlan.findUnique({
      where: {
        organizationId_code: {
          organizationId,
          code,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Plan code '${code}' already exists in your organization`);
    }

    const speedUnit = (data.speedUnit as SpeedUnit) || SpeedUnit.MBPS;
    const downloadSpeed = Number(data.downloadSpeed ?? data.downloadSpeedMbps ?? 0);
    const uploadSpeed = Number(data.uploadSpeed ?? data.uploadSpeedMbps ?? 0);
    const downloadSpeedMbps = Math.round(downloadSpeed);
    const uploadSpeedMbps = Math.round(uploadSpeed);

    const validityDays = Number(data.validityDays ?? 30);
    const billingCycle = (data.billingCycle as BillingCycle) || BillingCycle.MONTHLY;
    const price = Number(data.price ?? 0);
    const status = (data.status as PlanStatus) || PlanStatus.ACTIVE;
    const isActive = status === PlanStatus.ACTIVE;
    const gstRatePercent = Number(data.gstRatePercent ?? 18.0);

    return prisma.$transaction(async (tx) => {
      const plan = await tx.internetPlan.create({
        data: {
          organizationId,
          name,
          code,
          description: data.description || null,
          downloadSpeed,
          uploadSpeed,
          downloadSpeedMbps,
          uploadSpeedMbps,
          speedUnit,
          validityDays,
          billingCycle,
          price,
          status,
          isActive,
          gstRatePercent,
          dataLimitGb: data.dataLimitGb ? Number(data.dataLimitGb) : null,
          burstDownloadMbps: data.burstDownloadMbps ? Number(data.burstDownloadMbps) : null,
          burstUploadMbps: data.burstUploadMbps ? Number(data.burstUploadMbps) : null,
          burstThresholdMbps: data.burstThresholdMbps ? Number(data.burstThresholdMbps) : null,
          burstTimeSecs: data.burstTimeSecs ? Number(data.burstTimeSecs) : null,
        },
      });

      // Record CREATE Audit Log
      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: adminUserId || null,
          action: AuditAction.CREATE,
          entityType: 'INTERNET_PLAN',
          entityId: plan.id,
          details: {
            name: plan.name,
            code: plan.code,
            downloadSpeed: plan.downloadSpeed,
            uploadSpeed: plan.uploadSpeed,
            speedUnit: plan.speedUnit,
            price: plan.price,
            validityDays: plan.validityDays,
            billingCycle: plan.billingCycle,
            status: plan.status,
          },
        },
      });

      return this.formatPlan(plan);
    });
  }

  /**
   * Edit internet plan with audit logging
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

    const existing = await prisma.internetPlan.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException(`Internet plan '${id}' not found in your organization`);
    }

    // Check code collision if code updated
    if (data.code && data.code !== existing.code) {
      const codeExists = await prisma.internetPlan.findUnique({
        where: {
          organizationId_code: {
            organizationId,
            code: data.code,
          },
        },
      });
      if (codeExists) {
        throw new ConflictException(`Plan code '${data.code}' already exists in your organization`);
      }
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.code !== undefined) updateData.code = data.code;
    if (data.description !== undefined) updateData.description = data.description || null;

    if (data.downloadSpeed !== undefined || data.downloadSpeedMbps !== undefined) {
      const dl = Number(data.downloadSpeed ?? data.downloadSpeedMbps);
      updateData.downloadSpeed = dl;
      updateData.downloadSpeedMbps = Math.round(dl);
    }

    if (data.uploadSpeed !== undefined || data.uploadSpeedMbps !== undefined) {
      const ul = Number(data.uploadSpeed ?? data.uploadSpeedMbps);
      updateData.uploadSpeed = ul;
      updateData.uploadSpeedMbps = Math.round(ul);
    }

    if (data.speedUnit !== undefined) updateData.speedUnit = data.speedUnit;
    if (data.validityDays !== undefined) updateData.validityDays = Number(data.validityDays);
    if (data.billingCycle !== undefined) updateData.billingCycle = data.billingCycle;
    if (data.price !== undefined) updateData.price = Number(data.price);
    if (data.status !== undefined) {
      updateData.status = data.status;
      updateData.isActive = data.status === PlanStatus.ACTIVE;
    }
    if (data.gstRatePercent !== undefined) updateData.gstRatePercent = Number(data.gstRatePercent);
    if (data.dataLimitGb !== undefined) updateData.dataLimitGb = data.dataLimitGb ? Number(data.dataLimitGb) : null;
    if (data.burstDownloadMbps !== undefined) updateData.burstDownloadMbps = data.burstDownloadMbps ? Number(data.burstDownloadMbps) : null;
    if (data.burstUploadMbps !== undefined) updateData.burstUploadMbps = data.burstUploadMbps ? Number(data.burstUploadMbps) : null;
    if (data.burstThresholdMbps !== undefined) updateData.burstThresholdMbps = data.burstThresholdMbps ? Number(data.burstThresholdMbps) : null;
    if (data.burstTimeSecs !== undefined) updateData.burstTimeSecs = data.burstTimeSecs ? Number(data.burstTimeSecs) : null;

    return prisma.$transaction(async (tx) => {
      const updated = await tx.internetPlan.update({
        where: { id },
        data: updateData,
      });

      // Record UPDATE Audit Log
      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: adminUserId || null,
          action: AuditAction.UPDATE,
          entityType: 'INTERNET_PLAN',
          entityId: updated.id,
          details: {
            before: {
              name: existing.name,
              price: existing.price,
              status: existing.status,
            },
            after: {
              name: updated.name,
              price: updated.price,
              status: updated.status,
            },
          },
        },
      });

      return this.formatPlan(updated);
    });
  }

  /**
   * Activate or deactivate internet plan with audit logging
   */
  async toggleStatus(
    organizationId: string,
    adminUserIdOrId: any,
    idOrStatus?: any,
    maybeStatus?: PlanStatus,
  ) {
    let adminUserId: string | undefined;
    let id: string;
    let newStatus: PlanStatus | undefined;

    if (maybeStatus !== undefined) {
      adminUserId = adminUserIdOrId;
      id = idOrStatus;
      newStatus = maybeStatus;
    } else if (idOrStatus && Object.values(PlanStatus).includes(idOrStatus)) {
      adminUserId = undefined;
      id = adminUserIdOrId;
      newStatus = idOrStatus as PlanStatus;
    } else {
      adminUserId = idOrStatus ? adminUserIdOrId : undefined;
      id = idOrStatus || adminUserIdOrId;
      newStatus = undefined;
    }

    const plan = await prisma.internetPlan.findFirst({
      where: { id, organizationId },
    });

    if (!plan) {
      throw new NotFoundException(`Internet plan '${id}' not found in your organization`);
    }

    const targetStatus = newStatus || (plan.status === PlanStatus.ACTIVE ? PlanStatus.INACTIVE : PlanStatus.ACTIVE);
    const oldStatus = plan.status;

    return prisma.$transaction(async (tx) => {
      const updated = await tx.internetPlan.update({
        where: { id },
        data: {
          status: targetStatus,
          isActive: targetStatus === PlanStatus.ACTIVE,
        },
      });

      // Record STATUS_CHANGE Audit Log
      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: adminUserId || null,
          action: AuditAction.STATUS_CHANGE,
          entityType: 'INTERNET_PLAN',
          entityId: updated.id,
          details: {
            oldStatus,
            newStatus: targetStatus,
            planName: updated.name,
            code: updated.code,
          },
        },
      });

      return {
        message: `Plan '${updated.name}' successfully ${targetStatus === PlanStatus.ACTIVE ? 'activated' : 'deactivated'}`,
        plan: this.formatPlan(updated),
      };
    });
  }

  /**
   * Get plan details by ID with network policy object and subscriber stats
   */
  async getById(organizationId: string, id: string) {
    const plan = await prisma.internetPlan.findFirst({
      where: { id, organizationId },
      include: {
        _count: {
          select: { subscriptions: true },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found in your organization');
    }

    return this.formatPlan(plan);
  }

  /**
   * List MikroTik rate-limit policies
   */
  async listPolicies(organizationId: string) {
    return prisma.bandwidthPolicy.findMany({
      where: { organizationId },
    });
  }

  /**
   * Generates a 3-tier Network Policy abstraction from a Plan specification:
   * Plan -> NetworkPolicy -> RadiusAttributes
   */
  simulatePolicy(planInput: any) {
    return NetworkPolicyGenerator.generate(planInput);
  }

  /**
   * Format and attach vendor-neutral network policy object and RADIUS translation
   */
  private formatPlan(plan: any) {
    const { networkPolicy, radiusAttributes } = NetworkPolicyGenerator.generate(plan);

    return {
      id: plan.id,
      organizationId: plan.organizationId,
      name: plan.name,
      code: plan.code,
      description: plan.description || '',
      downloadSpeed: Number(plan.downloadSpeed || plan.downloadSpeedMbps || 0),
      uploadSpeed: Number(plan.uploadSpeed || plan.uploadSpeedMbps || 0),
      downloadSpeedMbps: plan.downloadSpeedMbps,
      uploadSpeedMbps: plan.uploadSpeedMbps,
      speedUnit: plan.speedUnit || SpeedUnit.MBPS,
      validityDays: plan.validityDays,
      billingCycle: plan.billingCycle || BillingCycle.MONTHLY,
      price: Number(plan.price),
      status: plan.status || (plan.isActive ? PlanStatus.ACTIVE : PlanStatus.INACTIVE),
      isActive: plan.isActive ?? (plan.status === PlanStatus.ACTIVE),
      gstRatePercent: Number(plan.gstRatePercent || 18.0),
      hsnSacCode: plan.hsnSacCode || '998422',
      dataLimitGb: plan.dataLimitGb,
      burstDownloadMbps: plan.burstDownloadMbps,
      burstUploadMbps: plan.burstUploadMbps,
      burstThresholdMbps: plan.burstThresholdMbps,
      burstTimeSecs: plan.burstTimeSecs,
      subscriberCount: plan._count?.subscriptions || 0,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      // Vendor-neutral Network Policy Object
      networkPolicy,
      // RADIUS / MikroTik Compiled Translation
      radiusAttributes,
      rateLimitString: radiusAttributes['Mikrotik-Rate-Limit'],
    };
  }
}
