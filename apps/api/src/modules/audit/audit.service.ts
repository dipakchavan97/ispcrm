import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@isp-crm/database';

@Injectable()
export class AuditService {
  async list(organizationId: string, filters: { action?: string; entityType?: string }) {
    const where: any = { organizationId };
    if (filters.action) {
      where.action = filters.action;
    }
    if (filters.entityType) {
      where.entityType = filters.entityType;
    }

    return prisma.auditLog.findMany({
      where,
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        adminUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async getById(organizationId: string, id: string) {
    const log = await prisma.auditLog.findFirst({
      where: { id, organizationId },
      include: {
        adminUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!log) {
      throw new NotFoundException('Audit log not found in your organization');
    }

    return log;
  }
}
