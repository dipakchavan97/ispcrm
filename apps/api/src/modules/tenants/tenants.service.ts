import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@isp-crm/database';

@Injectable()
export class TenantsService {
  async getById(organizationId: string) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        _count: {
          select: {
            customers: true,
            plans: true,
            routers: true,
            users: true,
          },
        },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return org;
  }

  async update(organizationId: string, data: any) {
    const { name, legalName, gstin, phone, email, address, city, state, pincode } = data;
    return prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(name && { name }),
        ...(legalName && { legalName }),
        ...(gstin && { gstin }),
        ...(phone && { phone }),
        ...(email && { email }),
        ...(address && { address }),
        ...(city && { city }),
        ...(state && { state }),
        ...(pincode && { pincode }),
      },
    });
  }
}
