import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import {
  InvoiceStatus,
  InvoiceSource,
  AuditAction,
  calculateInvoiceTotals,
  BillingLineItemInput,
  toMoneyDecimal,
} from '@isp-crm/shared';
import { Decimal } from 'decimal.js';
import { InvoicePdfService } from './invoice-pdf.service';

export interface InvoiceListFilter {
  status?: string;
  search?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class InvoicesService {
  private pdfService: InvoicePdfService;

  constructor(
    @Optional() private readonly injectedPdfService?: InvoicePdfService,
  ) {
    this.pdfService = this.injectedPdfService || new InvoicePdfService();
  }

  /**
   * Helper to verify and sanitize adminUserId
   */
  private async sanitizeAdminUserId(adminUserId?: string): Promise<string | null> {
    if (!adminUserId) return null;
    const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
    return admin ? admin.id : null;
  }

  /**
   * List invoices scoped to tenant organization with filters, search, and pagination
   */
  async list(organizationId: string, filter?: InvoiceListFilter) {
    const page = Math.max(1, Number(filter?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter?.limit) || 50));
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (filter?.status && filter.status !== 'ALL') {
      where.status = filter.status.toUpperCase() as InvoiceStatus;
    }

    if (filter?.customerId) {
      where.customerId = filter.customerId;
    }

    if (filter?.startDate || filter?.endDate) {
      where.invoiceDate = {};
      if (filter.startDate) {
        where.invoiceDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.invoiceDate.lte = new Date(filter.endDate);
      }
    }

    if (filter?.search) {
      const q = filter.search.trim();
      where.OR = [
        { invoiceNumber: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { customerCode: { contains: q, mode: 'insensitive' } } },
        { customer: { mobile: { contains: q, mode: 'insensitive' } } },
        { customer: { username: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, rawInvoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              customerCode: true,
              mobile: true,
              username: true,
              area: true,
              city: true,
              state: true,
            },
          },
          items: true,
          payments: {
            select: {
              id: true,
              receiptNumber: true,
              amount: true,
              paymentMethod: true,
              paidAt: true,
            },
          },
        },
      }),
    ]);

    // Attach computed balanceDue using Decimal arithmetic
    const items = rawInvoices.map((inv) => {
      const totalDec = new Decimal(inv.totalAmount.toString());
      const paidDec = new Decimal(inv.paidAmount.toString());
      const balanceDec = totalDec.minus(paidDec);

      return {
        ...inv,
        totalAmount: totalDec.toFixed(2),
        paidAmount: paidDec.toFixed(2),
        subtotal: new Decimal(inv.subtotal.toString()).toFixed(2),
        discountAmount: new Decimal(inv.discountAmount.toString()).toFixed(2),
        cgstAmount: new Decimal(inv.cgstAmount.toString()).toFixed(2),
        sgstAmount: new Decimal(inv.sgstAmount.toString()).toFixed(2),
        igstAmount: new Decimal(inv.igstAmount.toString()).toFixed(2),
        balanceDue: balanceDec.toFixed(2),
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * KPI metrics for Billing overview
   */
  async getMetrics(organizationId: string) {
    const invoices = await prisma.invoice.findMany({
      where: { organizationId, status: { not: InvoiceStatus.CANCELLED } },
      select: {
        totalAmount: true,
        paidAmount: true,
        status: true,
        dueDate: true,
      },
    });

    let totalInvoiced = new Decimal(0);
    let totalCollected = new Decimal(0);
    let totalOutstanding = new Decimal(0);
    let overdueCount = 0;
    const now = new Date();

    for (const inv of invoices) {
      const total = new Decimal(inv.totalAmount.toString());
      const paid = new Decimal(inv.paidAmount.toString());
      const balance = total.minus(paid);

      totalInvoiced = totalInvoiced.plus(total);
      totalCollected = totalCollected.plus(paid);

      if (inv.status === InvoiceStatus.ISSUED || inv.status === InvoiceStatus.PARTIALLY_PAID || inv.status === InvoiceStatus.OVERDUE) {
        totalOutstanding = totalOutstanding.plus(balance);
      }

      if (inv.status === InvoiceStatus.OVERDUE || (inv.dueDate < now && inv.status !== InvoiceStatus.PAID)) {
        overdueCount++;
      }
    }

    return {
      totalInvoiced: totalInvoiced.toFixed(2),
      totalCollected: totalCollected.toFixed(2),
      totalOutstanding: totalOutstanding.toFixed(2),
      overdueCount,
    };
  }

  /**
   * Preview invoice calculations live without saving to DB
   */
  async preview(organizationId: string, data: any) {
    const { customerId, items, discountAmount, taxRatePercent } = data;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('At least one invoice item is required');
    }

    let isIntraState = true;
    if (customerId) {
      const [customer, org] = await Promise.all([
        prisma.customer.findFirst({ where: { id: customerId, organizationId } }),
        prisma.organization.findUnique({ where: { id: organizationId } }),
      ]);

      if (customer && org && customer.state && org.state) {
        isIntraState = customer.state.trim().toLowerCase() === org.state.trim().toLowerCase();
      }
    }

    const calcResult = calculateInvoiceTotals({
      items: items.map((i: any) => ({
        description: i.description,
        sacCode: i.sacCode || '998422',
        quantity: Number(i.quantity) || 1,
        unitPrice: i.unitPrice,
        discountAmount: i.discountAmount || 0,
        taxRatePercent: i.taxRatePercent !== undefined ? i.taxRatePercent : taxRatePercent,
      })),
      invoiceDiscountAmount: discountAmount || 0,
      isIntraState,
      defaultTaxRatePercent: taxRatePercent || 18.0,
    });

    return calcResult;
  }

  /**
   * Create invoice atomically in a database transaction with Decimal financial precision
   */
  async create(organizationId: string, adminUserId: string | undefined, data: any) {
    const {
      customerId,
      subscriptionId,
      items,
      dueDate: inputDueDate,
      discountAmount,
      notes,
      status: inputStatus,
      servicePeriodStart,
      servicePeriodEnd,
      source: inputSource,
    } = data;

    if (!customerId) {
      throw new BadRequestException('customerId is required');
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('At least one invoice item is required');
    }

    const [customer, org] = await Promise.all([
      prisma.customer.findFirst({
        where: { id: customerId, organizationId },
      }),
      prisma.organization.findUnique({
        where: { id: organizationId },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException('Customer not found in your organization');
    }
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    // Determine GST tax architecture (Intra-state CGST+SGST vs Inter-state IGST)
    let isIntraState = true;
    if (customer.state && org.state) {
      isIntraState = customer.state.trim().toLowerCase() === org.state.trim().toLowerCase();
    }

    // Calculate all line items, subtotal, discounts, and GST taxes strictly via Decimal math
    const calcResult = calculateInvoiceTotals({
      items: items.map((item: any) => ({
        description: item.description,
        sacCode: item.sacCode || '998422',
        quantity: Math.max(1, Number(item.quantity) || 1),
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount || 0,
        taxRatePercent: item.taxRatePercent !== undefined ? item.taxRatePercent : 18.0,
      })),
      invoiceDiscountAmount: discountAmount || 0,
      isIntraState,
    });

    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    // Compute Due Date (default +7 days if omitted)
    const dueDate = inputDueDate ? new Date(inputDueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const targetStatus = inputStatus === InvoiceStatus.DRAFT ? InvoiceStatus.DRAFT : InvoiceStatus.ISSUED;

    // Database transaction for atomic financial creation
    return prisma.$transaction(async (tx) => {
      // Sequential unique invoice number: INV-YYYYMM-XXXX
      const count = await tx.invoice.count({ where: { organizationId } });
      const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
      const seq = String(count + 1).padStart(4, '0');
      let invoiceNumber = `INV-${yearMonth}-${seq}`;

      // Guarantee collision safety
      const existing = await tx.invoice.findFirst({
        where: { organizationId, invoiceNumber },
      });
      if (existing) {
        invoiceNumber = `INV-${yearMonth}-${seq}-${Date.now().toString().slice(-4)}`;
      }

      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          customerId,
          subscriptionId: subscriptionId || null,
          invoiceNumber,
          invoiceDate: new Date(),
          dueDate,
          subtotal: calcResult.subtotal,
          discountAmount: calcResult.discountAmount,
          cgstAmount: calcResult.cgstAmount,
          sgstAmount: calcResult.sgstAmount,
          igstAmount: calcResult.igstAmount,
          totalAmount: calcResult.totalAmount,
          paidAmount: '0.00',
          status: targetStatus,
          source: (inputSource as InvoiceSource) || InvoiceSource.MANUAL,
          servicePeriodStart: servicePeriodStart ? new Date(servicePeriodStart) : null,
          servicePeriodEnd: servicePeriodEnd ? new Date(servicePeriodEnd) : null,
          notes: notes || null,
          items: {
            create: calcResult.items.map((item) => ({
              description: item.description,
              sacCode: item.sacCode,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountAmount: item.discountAmount,
              taxRatePercent: item.taxRatePercent,
              taxAmount: item.taxAmount,
              totalAmount: item.totalAmount,
            })),
          },
        },
        include: {
          customer: true,
          items: true,
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: finalAdminUserId,
          action: AuditAction.GENERATE_INVOICE,
          entityType: 'INVOICE',
          entityId: invoice.id,
          details: {
            invoiceNumber,
            customerId,
            totalAmount: calcResult.totalAmount,
            status: targetStatus,
            itemsCount: calcResult.items.length,
          },
        },
      });

      return {
        ...invoice,
        subtotal: calcResult.subtotal,
        discountAmount: calcResult.discountAmount,
        cgstAmount: calcResult.cgstAmount,
        sgstAmount: calcResult.sgstAmount,
        igstAmount: calcResult.igstAmount,
        totalAmount: calcResult.totalAmount,
        paidAmount: '0.00',
        balanceDue: calcResult.totalAmount,
      };
    });
  }

  /**
   * Get invoice details with items, payments, customer profile, and organization header
   */
  async getById(organizationId: string, id: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            legalName: true,
            gstin: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            stateCode: true,
            pincode: true,
            currency: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            customerCode: true,
            mobile: true,
            email: true,
            address: true,
            area: true,
            city: true,
            state: true,
            pincode: true,
            gstin: true,
            username: true,
            status: true,
          },
        },
        items: true,
        payments: {
          orderBy: { paidAt: 'desc' },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found in your organization');
    }

    const totalDec = new Decimal(invoice.totalAmount.toString());
    const paidDec = new Decimal(invoice.paidAmount.toString());
    const balanceDec = totalDec.minus(paidDec);

    return {
      ...invoice,
      subtotal: new Decimal(invoice.subtotal.toString()).toFixed(2),
      discountAmount: new Decimal(invoice.discountAmount.toString()).toFixed(2),
      cgstAmount: new Decimal(invoice.cgstAmount.toString()).toFixed(2),
      sgstAmount: new Decimal(invoice.sgstAmount.toString()).toFixed(2),
      igstAmount: new Decimal(invoice.igstAmount.toString()).toFixed(2),
      totalAmount: totalDec.toFixed(2),
      paidAmount: paidDec.toFixed(2),
      balanceDue: balanceDec.toFixed(2),
      items: invoice.items.map((item) => ({
        ...item,
        unitPrice: new Decimal(item.unitPrice.toString()).toFixed(2),
        discountAmount: new Decimal(item.discountAmount.toString()).toFixed(2),
        taxRatePercent: new Decimal(item.taxRatePercent.toString()).toFixed(2),
        taxAmount: new Decimal(item.taxAmount.toString()).toFixed(2),
        totalAmount: new Decimal(item.totalAmount.toString()).toFixed(2),
      })),
      payments: invoice.payments.map((p) => ({
        ...p,
        amount: new Decimal(p.amount.toString()).toFixed(2),
      })),
    };
  }

  /**
   * Cancel an unpaid or draft invoice
   */
  async cancel(organizationId: string, adminUserId: string | undefined, id: string, reason?: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found in your organization');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Cannot cancel a fully paid invoice. Issue a credit note or refund.');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      return invoice;
    }

    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.CANCELLED,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: finalAdminUserId,
          action: AuditAction.STATUS_CHANGE,
          entityType: 'INVOICE',
          entityId: invoice.id,
          details: {
            fromStatus: invoice.status,
            toStatus: InvoiceStatus.CANCELLED,
            reason: reason || 'Invoice cancelled by user',
          },
        },
      });

      return updated;
    });
  }

  /**
   * Generate cycle batch stub
   */
  async generateCycle(organizationId: string) {
    return {
      message: 'Batch billing cycle job queued for organization',
      organizationId,
      queuedAt: new Date().toISOString(),
    };
  }

  /**
   * Helper to format source for human display in notes/logs
   */
  private formatSourceLabel(source: InvoiceSource): string {
    switch (source) {
      case InvoiceSource.SUBSCRIPTION_RENEWAL:
        return 'Subscription Renewal';
      case InvoiceSource.SUBSCRIPTION_ASSIGNMENT:
        return 'Package Assignment';
      case InvoiceSource.PLAN_CHANGE:
        return 'Package Change';
      case InvoiceSource.MANUAL:
        return 'Manual Invoicing';
      default:
        return source;
    }
  }

  /**
   * Automatically and idempotently generate a GST Tax Invoice for a subscription
   * lifecycle event (assignment, renewal, plan change).
   * Transactionally safe: runs on the provided Prisma transaction client.
   */
  async createSubscriptionInvoice(
    tx: any,
    params: {
      organizationId: string;
      customerId: string;
      subscriptionId: string;
      planId: string;
      servicePeriodStart: Date;
      servicePeriodEnd: Date;
      source: InvoiceSource;
      adminUserId?: string | null;
      unitPrice?: Decimal.Value | number | string;
      discountAmount?: Decimal.Value | number | string;
      notes?: string;
      dueDate?: Date;
    },
  ) {
    const {
      organizationId,
      customerId,
      subscriptionId,
      planId,
      servicePeriodStart,
      servicePeriodEnd,
      source,
      adminUserId,
      unitPrice: customPrice,
      discountAmount = 0,
      notes,
      dueDate: customDueDate,
    } = params;

    // 0. Concurrency lock: Acquire transactional advisory lock scoped to this subscription, period, source (+ planId for PLAN_CHANGE)
    const lockKey =
      source === InvoiceSource.PLAN_CHANGE
        ? `sub_inv:${subscriptionId}:${servicePeriodStart.getTime()}:${servicePeriodEnd.getTime()}:${source}:${planId}`
        : `sub_inv:${subscriptionId}:${servicePeriodStart.getTime()}:${servicePeriodEnd.getTime()}:${source}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    // 1. Fetch Customer, Plan, and Organization details early to validate and enable plan-aware idempotency
    const [customer, plan, org] = await Promise.all([
      tx.customer.findFirst({ where: { id: customerId, organizationId } }),
      tx.internetPlan.findFirst({ where: { id: planId, organizationId } }),
      tx.organization.findUnique({ where: { id: organizationId } }),
    ]);

    if (!customer) {
      throw new NotFoundException('Customer not found for automatic invoicing');
    }
    if (!plan) {
      throw new NotFoundException('Plan not found for automatic invoicing');
    }
    if (!org) {
      throw new NotFoundException('Organization not found for automatic invoicing');
    }

    // 2. Idempotency check: Look for an existing non-cancelled invoice for this subscription & period
    // For PLAN_CHANGE, verify if an invoice was already generated specifically for this target plan
    const whereClause: any = {
      organizationId,
      subscriptionId,
      servicePeriodStart,
      servicePeriodEnd,
      source,
      status: { not: InvoiceStatus.CANCELLED },
    };

    if (source === InvoiceSource.PLAN_CHANGE) {
      whereClause.items = {
        some: {
          description: { startsWith: `Internet Broadband Service — ${plan.name} |` },
        },
      };
    }

    const existing = await tx.invoice.findFirst({
      where: whereClause,
      include: {
        customer: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return {
        ...existing,
        subtotal: new Decimal(existing.subtotal.toString()).toFixed(2),
        discountAmount: new Decimal(existing.discountAmount.toString()).toFixed(2),
        cgstAmount: new Decimal(existing.cgstAmount.toString()).toFixed(2),
        sgstAmount: new Decimal(existing.sgstAmount.toString()).toFixed(2),
        igstAmount: new Decimal(existing.igstAmount.toString()).toFixed(2),
        totalAmount: new Decimal(existing.totalAmount.toString()).toFixed(2),
        paidAmount: new Decimal(existing.paidAmount.toString()).toFixed(2),
        balanceDue: new Decimal(existing.totalAmount.toString()).minus(new Decimal(existing.paidAmount.toString())).toFixed(2),
      };
    }

    // Determine GST tax architecture (Intra-state CGST+SGST vs Inter-state IGST)
    let isIntraState = true;
    if (customer.state && org.state) {
      isIntraState = customer.state.trim().toLowerCase() === org.state.trim().toLowerCase();
    }

    const effectivePrice = customPrice !== undefined ? customPrice : plan.price;
    const sacCode = plan.hsnSacCode || '998422';
    const taxRatePercent = plan.gstRatePercent !== undefined ? Number(plan.gstRatePercent) : 18.0;

    // 3. Line item & GST calculations strictly via Decimal math
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formatPeriodDate = (d: Date): string => {
      const day = String(d.getDate()).padStart(2, '0');
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      return `${day} ${month} ${year}`;
    };
    const startStr = formatPeriodDate(servicePeriodStart);
    const endStr = formatPeriodDate(servicePeriodEnd);
    const description = `Internet Broadband Service — ${plan.name} | Service Period: ${startStr} - ${endStr}`;

    const calcResult = calculateInvoiceTotals({
      items: [
        {
          description,
          sacCode,
          quantity: 1,
          unitPrice: effectivePrice,
          discountAmount,
          taxRatePercent,
        },
      ],
      invoiceDiscountAmount: 0,
      isIntraState,
    });

    // 4. Sequential Unique Invoice Number
    const count = await tx.invoice.count({ where: { organizationId } });
    const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
    const seq = String(count + 1).padStart(4, '0');
    let invoiceNumber = `INV-${yearMonth}-${seq}`;

    const duplicateCheck = await tx.invoice.findFirst({
      where: { organizationId, invoiceNumber },
    });
    if (duplicateCheck) {
      invoiceNumber = `INV-${yearMonth}-${seq}-${Date.now().toString().slice(-4)}`;
    }

    const dueDate = customDueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId || undefined);

    // 5. Create Invoice in Database
    const invoice = await tx.invoice.create({
      data: {
        organizationId,
        customerId,
        subscriptionId,
        invoiceNumber,
        invoiceDate: new Date(),
        dueDate,
        subtotal: calcResult.subtotal,
        discountAmount: calcResult.discountAmount,
        cgstAmount: calcResult.cgstAmount,
        sgstAmount: calcResult.sgstAmount,
        igstAmount: calcResult.igstAmount,
        totalAmount: calcResult.totalAmount,
        paidAmount: '0.00',
        status: InvoiceStatus.ISSUED,
        source,
        servicePeriodStart,
        servicePeriodEnd,
        notes: notes || `Auto-generated on ${this.formatSourceLabel(source)}`,
        items: {
          create: calcResult.items.map((item) => ({
            description: item.description,
            sacCode: item.sacCode,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountAmount: item.discountAmount,
            taxRatePercent: item.taxRatePercent,
            taxAmount: item.taxAmount,
            totalAmount: item.totalAmount,
          })),
        },
      },
      include: {
        customer: true,
        items: true,
      },
    });

    // 6. Audit Log
    await tx.auditLog.create({
      data: {
        organizationId,
        adminUserId: finalAdminUserId,
        action: AuditAction.GENERATE_INVOICE,
        entityType: 'INVOICE',
        entityId: invoice.id,
        details: {
          invoiceNumber,
          customerId,
          subscriptionId,
          source,
          servicePeriodStart: servicePeriodStart.toISOString(),
          servicePeriodEnd: servicePeriodEnd.toISOString(),
          totalAmount: calcResult.totalAmount,
          status: InvoiceStatus.ISSUED,
        },
      },
    });

    return {
      ...invoice,
      subtotal: calcResult.subtotal,
      discountAmount: calcResult.discountAmount,
      cgstAmount: calcResult.cgstAmount,
      sgstAmount: calcResult.sgstAmount,
      igstAmount: calcResult.igstAmount,
      totalAmount: calcResult.totalAmount,
      paidAmount: '0.00',
      balanceDue: calcResult.totalAmount,
    };
  }

  /**
   * Generates server-side PDF for an invoice
   */
  async generatePdf(organizationId: string, invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.getById(organizationId, invoiceId);
    if (!invoice) {
      throw new NotFoundException('Invoice not found in your organization');
    }

    const buffer = await this.pdfService.generatePdf({
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      servicePeriodStart: invoice.servicePeriodStart,
      servicePeriodEnd: invoice.servicePeriodEnd,
      status: invoice.status,
      source: invoice.source,
      subtotal: invoice.subtotal,
      discountAmount: invoice.discountAmount,
      cgstAmount: invoice.cgstAmount,
      sgstAmount: invoice.sgstAmount,
      igstAmount: invoice.igstAmount,
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount,
      balanceDue: invoice.balanceDue,
      notes: invoice.notes,
      organization: invoice.organization || { name: 'Internet Service Provider' },
      customer: invoice.customer,
      items: invoice.items,
      payments: invoice.payments,
    });

    const sanitizedInvoiceNumber = invoice.invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_');
    return {
      buffer,
      filename: `INVOICE-${sanitizedInvoiceNumber}.pdf`,
    };
  }
}
