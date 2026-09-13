import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { prisma } from '@isp-crm/database';
import { UserRole, CreateAdminUserInput } from '@isp-crm/shared';

@Injectable()
export class UsersService {
  async list(organizationId: string) {
    return prisma.adminUser.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(organizationId: string, dto: CreateAdminUserInput) {
    // Only one ISP_OWNER is allowed per organization via register-org
    if (dto.role === UserRole.ISP_OWNER) {
      throw new ForbiddenException('Cannot create additional ISP_OWNER users');
    }

    const existingUser = await prisma.adminUser.findFirst({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException(`User with email '${dto.email}' already exists`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await prisma.adminUser.create({
      data: {
        organizationId,
        name: dto.name,
        email: dto.email,
        passwordHash,
        phone: dto.phone,
        role: dto.role as any,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Security Audit Log: Staff creation
    await prisma.auditLog
      .create({
        data: {
          organizationId,
          action: 'CREATE' as any,
          entityType: 'ADMIN_USER',
          entityId: user.id,
          details: {
            name: user.name,
            email: user.email,
            role: user.role,
          },
        },
      })
      .catch(() => {});

    return user;
  }

  async getById(organizationId: string, id: string) {
    const user = await prisma.adminUser.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found in your organization');
    }

    return user;
  }

  async update(organizationId: string, id: string, data: { isActive?: boolean; role?: UserRole; name?: string }) {
    await this.getById(organizationId, id);

    if (data.role === UserRole.ISP_OWNER) {
      throw new ForbiddenException('Cannot assign ISP_OWNER role');
    }

    const updated = await prisma.adminUser.update({
      where: { id },
      data: {
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.role && { role: data.role as any }),
        ...(data.name && { name: data.name }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    // Security Audit Log: Staff update
    await prisma.auditLog
      .create({
        data: {
          organizationId,
          action: 'UPDATE' as any,
          entityType: 'ADMIN_USER',
          entityId: id,
          details: {
            role: data.role,
            isActive: data.isActive,
          },
        },
      })
      .catch(() => {});

    return updated;
  }
}
