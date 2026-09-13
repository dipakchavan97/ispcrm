import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import { TicketStatus, TicketPriority } from '@isp-crm/shared';

@Injectable()
export class TicketsService {
  async list(
    organizationId: string,
    filters: {
      customerId?: string;
      status?: string;
      priority?: string;
      search?: string;
    },
  ) {
    const where: any = { organizationId };

    if (filters.customerId) {
      where.customerId = filters.customerId;
    }
    if (filters.status) {
      where.status = filters.status as TicketStatus;
    }
    if (filters.priority) {
      where.priority = filters.priority as TicketPriority;
    }
    if (filters.search) {
      where.OR = [
        { ticketNumber: { contains: filters.search, mode: 'insensitive' } },
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return prisma.ticket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            customerCode: true,
            name: true,
            mobile: true,
            username: true,
          },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async getById(organizationId: string, id: string) {
    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId },
      include: {
        customer: {
          select: {
            id: true,
            customerCode: true,
            name: true,
            mobile: true,
            username: true,
            address: true,
            status: true,
          },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found in your organization');
    }

    return ticket;
  }

  async create(organizationId: string, userId: string | undefined, body: any) {
    if (!body.title || !body.description) {
      throw new BadRequestException('Ticket title and description are required');
    }

    const ticketNumber = `TICK-${Date.now().toString().slice(-6)}`;

    return prisma.ticket.create({
      data: {
        organizationId,
        customerId: body.customerId || null,
        ticketNumber,
        title: body.title,
        description: body.description,
        category: body.category || 'TECHNICAL',
        priority: (body.priority as TicketPriority) || TicketPriority.MEDIUM,
        status: TicketStatus.OPEN,
        assignedTo: body.assignedTo || null,
        createdById: userId || null,
      },
      include: {
        customer: {
          select: {
            id: true,
            customerCode: true,
            name: true,
            mobile: true,
          },
        },
        comments: true,
      },
    });
  }

  async update(organizationId: string, id: string, body: any) {
    const existing = await this.getById(organizationId, id);

    const data: any = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.category !== undefined) data.category = body.category;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.status !== undefined) data.status = body.status;
    if (body.assignedTo !== undefined) data.assignedTo = body.assignedTo;

    return prisma.ticket.update({
      where: { id: existing.id },
      data,
      include: {
        customer: {
          select: {
            id: true,
            customerCode: true,
            name: true,
            mobile: true,
          },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async addComment(organizationId: string, ticketId: string, authorName: string, body: any) {
    const ticket = await this.getById(organizationId, ticketId);
    if (!body.comment || !body.comment.trim()) {
      throw new BadRequestException('Comment content cannot be empty');
    }

    return prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        authorName: authorName || 'Staff',
        comment: body.comment.trim(),
        isInternal: Boolean(body.isInternal),
      },
    });
  }

  async getStats(organizationId: string) {
    const [total, open, inProgress, resolved, closed, urgent] = await Promise.all([
      prisma.ticket.count({ where: { organizationId } }),
      prisma.ticket.count({ where: { organizationId, status: TicketStatus.OPEN } }),
      prisma.ticket.count({ where: { organizationId, status: TicketStatus.IN_PROGRESS } }),
      prisma.ticket.count({ where: { organizationId, status: TicketStatus.RESOLVED } }),
      prisma.ticket.count({ where: { organizationId, status: TicketStatus.CLOSED } }),
      prisma.ticket.count({ where: { organizationId, priority: TicketPriority.URGENT, status: { not: TicketStatus.CLOSED } } }),
    ]);

    return {
      total,
      open,
      inProgress,
      resolved,
      closed,
      urgent,
    };
  }
}
