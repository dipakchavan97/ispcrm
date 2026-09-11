import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import {
  PaymentStatus,
  InvoiceStatus,
  CustomerStatus,
  SubscriptionStatus,
  PaymentMethod,
  AuditAction,
  calculatePaymentSettlement,
  toMoneyDecimal,
  calculateSubscriptionEndDate,
  DEFAULT_TIMEZONE,
  translateNetworkPolicyToRadius,
  buildNetworkPolicyFromPlan,
  CoaAction,
  CoaRequestType,
  NotificationEmitter,
  NotificationEventType,
} from '@isp-crm/shared';
import { Decimal } from 'decimal.js';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { RadiusCoaQueueService } from '../radius/radius-coa-queue.service';

export interface PaymentListFilter {
  status?: string;
  paymentMethod?: string;
  customerId?: string;
  invoiceId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly paymentProvider: MockPaymentProvider,
    @Optional() private readonly coaQueueService?: RadiusCoaQueueService,
  ) {}

  /**
   * Helper to verify and sanitize adminUserId
   */
  private async sanitizeAdminUserId(adminUserId?: string): Promise<string | null> {
    if (!adminUserId) return null;
    const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
    return admin ? admin.id : null;
  }

  /**
   * List recorded payments scoped to organization
   */
  async list(organizationId: string, filter?: PaymentListFilter) {
    const page = Math.max(1, Number(filter?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter?.limit) || 50));
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (filter?.status && filter.status !== 'ALL') {
      where.status = filter.status.toUpperCase() as PaymentStatus;
    }

    if (filter?.paymentMethod && filter.paymentMethod !== 'ALL') {
      where.paymentMethod = filter.paymentMethod.toUpperCase() as PaymentMethod;
    }

    if (filter?.customerId) {
      where.customerId = filter.customerId;
    }

    if (filter?.invoiceId) {
      where.invoiceId = filter.invoiceId;
    }

    if (filter?.search) {
      const q = filter.search.trim();
      where.OR = [
        { receiptNumber: { contains: q, mode: 'insensitive' } },
        { transactionRef: { contains: q, mode: 'insensitive' } },
        { gatewayOrderId: { contains: q, mode: 'insensitive' } },
        { gatewayPaymentId: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { customerCode: { contains: q, mode: 'insensitive' } } },
        { customer: { mobile: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, rawPayments] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { paidAt: 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              customerCode: true,
              mobile: true,
              username: true,
            },
          },
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              totalAmount: true,
              paidAmount: true,
              status: true,
            },
          },
        },
      }),
    ]);

    const items = rawPayments.map((p) => ({
      ...p,
      amount: new Decimal(p.amount.toString()).toFixed(2),
      invoice: p.invoice
        ? {
            ...p.invoice,
            totalAmount: new Decimal(p.invoice.totalAmount.toString()).toFixed(2),
            paidAmount: new Decimal(p.invoice.paidAmount.toString()).toFixed(2),
          }
        : null,
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Create an online payment order intent for an invoice
   */
  async createPaymentIntent(
    organizationId: string,
    data: { invoiceId: string; amount?: string | number },
  ) {
    const { invoiceId, amount: requestedAmount } = data;

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        customer: true,
        organization: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found in your organization');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already paid in full');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot initiate payment for a cancelled invoice');
    }

    const totalDec = new Decimal(invoice.totalAmount.toString());
    const paidDec = new Decimal(invoice.paidAmount.toString());
    const balanceDec = totalDec.minus(paidDec);

    let amountDec = balanceDec;
    if (requestedAmount !== undefined && requestedAmount !== null && requestedAmount !== '') {
      amountDec = toMoneyDecimal(requestedAmount);
      if (amountDec.gt(balanceDec)) {
        throw new BadRequestException(
          `Requested amount (₹${amountDec.toFixed(2)}) exceeds balance due (₹${balanceDec.toFixed(2)})`,
        );
      }
      if (amountDec.lte(0)) {
        throw new BadRequestException('Payment amount must be greater than zero');
      }
    }

    const gatewayOrder = await this.paymentProvider.createPayment({
      orderId: invoice.id,
      amount: amountDec.toFixed(2),
      currency: invoice.organization.currency || 'INR',
      customerId: invoice.customerId,
      customerName: invoice.customer.name,
      customerEmail: invoice.customer.email || undefined,
      customerPhone: invoice.customer.mobile || undefined,
      description: `Broadband Invoice ${invoice.invoiceNumber} Settlement`,
    });

    return {
      ...gatewayOrder,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customer.name,
      balanceDue: balanceDec.toFixed(2),
    };
  }

  /**
   * Idempotent online payment verification and tri-state settlement:
   * invoice -> PAID
   * payment -> SUCCESS
   * subscription -> ACTIVE / RENEWED
   */
  async verifyAndSettleOnlinePayment(
    organizationId: string,
    adminUserId: string | undefined,
    data: {
      invoiceId: string;
      gatewayOrderId: string;
      gatewayPaymentId: string;
      signature?: string;
      idempotencyKey?: string;
    },
  ) {
    const { invoiceId, gatewayOrderId, gatewayPaymentId, signature, idempotencyKey } = data;
    const effectiveIdempotencyKey = idempotencyKey || gatewayPaymentId;
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    // Atomic transaction for database consistency and concurrency safety
    try {
      const result = await prisma.$transaction(async (tx) => {
      // 1. IDEMPOTENCY CHECK:
      // If a successful payment with this gatewayPaymentId or idempotencyKey already exists,
      // return it immediately without double charging or duplicate renewals!
      const existingPayment = await tx.payment.findFirst({
        where: {
          organizationId,
          OR: [
            { gatewayPaymentId },
            { idempotencyKey: effectiveIdempotencyKey },
            { transactionRef: gatewayPaymentId },
          ],
        },
        include: {
          invoice: true,
          customer: true,
        },
      });

      if (existingPayment && existingPayment.status === PaymentStatus.SUCCESS) {
        return {
          isSuccess: true,
          isDuplicate: true,
          message: 'Payment already processed and verified idempotently.',
          payment: {
            ...existingPayment,
            amount: new Decimal(existingPayment.amount.toString()).toFixed(2),
          },
          invoice: existingPayment.invoice
            ? {
                ...existingPayment.invoice,
                totalAmount: new Decimal(existingPayment.invoice.totalAmount.toString()).toFixed(2),
                paidAmount: new Decimal(existingPayment.invoice.paidAmount.toString()).toFixed(2),
              }
            : null,
        };
      }

      // 2. Fetch invoice and customer
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId },
        include: {
          customer: true,
          organization: true,
        },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found in your organization');
      }

      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException('Cannot settle payment against a cancelled invoice');
      }

      const totalDec = new Decimal(invoice.totalAmount.toString());
      const currentPaidDec = new Decimal(invoice.paidAmount.toString());
      const balanceDec = totalDec.minus(currentPaidDec);

      if (invoice.status === InvoiceStatus.PAID || balanceDec.lte(0)) {
        throw new BadRequestException('Invoice is already fully paid');
      }

      // 3. Verify Payment with PaymentProvider
      const verifyResult = await this.paymentProvider.verifyPayment({
        gatewayOrderId,
        gatewayPaymentId,
        signature,
        rawPayload: {
          amount: balanceDec.toFixed(2),
          currency: invoice.organization.currency || 'INR',
        },
      });

      if (!verifyResult.isSuccess) {
        throw new BadRequestException(
          verifyResult.failureReason || 'Online payment signature verification failed',
        );
      }

      const paymentAmountDec = balanceDec;
      const newPaidDec = currentPaidDec.plus(paymentAmountDec);

      // 4. Update Invoice -> PAID
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaidDec.toFixed(2),
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
        },
      });

      // 5. Create Payment -> SUCCESS with idempotencyKey
      const count = await tx.payment.count({ where: { organizationId } });
      const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
      const seq = String(count + 1).padStart(4, '0');
      let receiptNumber = `RCPT-${yearMonth}-${seq}`;

      const existingReceipt = await tx.payment.findFirst({
        where: { organizationId, receiptNumber },
      });
      if (existingReceipt) {
        receiptNumber = `RCPT-${yearMonth}-${seq}-${Date.now().toString().slice(-4)}`;
      }

      const payment = await tx.payment.create({
        data: {
          organizationId,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          receiptNumber,
          amount: paymentAmountDec.toFixed(2),
          paymentMethod: PaymentMethod.ONLINE_GATEWAY,
          status: PaymentStatus.SUCCESS,
          transactionRef: gatewayPaymentId,
          gatewayOrderId,
          gatewayPaymentId,
          idempotencyKey: effectiveIdempotencyKey,
          collectedById: finalAdminUserId,
          paidAt: new Date(),
          notes: `Online settlement via ${this.paymentProvider.name}`,
        },
        include: {
          customer: true,
          invoice: true,
        },
      });

      // 6. Subscriptions Auto-Renew / Activate -> ACTIVE / RENEWED
      let updatedSubscription: any = null;
      let targetSub: any = null;

      if (invoice.subscriptionId) {
        targetSub = await tx.subscription.findFirst({
          where: { id: invoice.subscriptionId, organizationId },
          include: { plan: true },
        });
      }

      if (!targetSub) {
        // Fallback to customer's current subscription
        targetSub = await tx.subscription.findFirst({
          where: {
            customerId: invoice.customerId,
            organizationId,
            status: { in: ['PENDING', 'ACTIVE', 'GRACE', 'SUSPENDED', 'EXPIRED'] },
          },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
        });
      }

      if (targetSub) {
        const orgTz = invoice.organization.timezone || DEFAULT_TIMEZONE;
        const now = new Date();
        const anchorDate = new Date(targetSub.endDate) > now ? new Date(targetSub.endDate) : now;
        const validityDays = targetSub.plan?.validityDays || 30;
        const newEndDate = calculateSubscriptionEndDate(
          anchorDate,
          targetSub.billingCycle,
          validityDays,
          orgTz,
        );

        const subAction = targetSub.status === SubscriptionStatus.PENDING ? 'ACTIVATE' : 'RENEW';

        updatedSubscription = await tx.subscription.update({
          where: { id: targetSub.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            endDate: newEndDate,
          },
        });

        // Record Subscription History
        await tx.subscriptionHistory.create({
          data: {
            organizationId,
            subscriptionId: targetSub.id,
            fromStatus: targetSub.status,
            toStatus: SubscriptionStatus.ACTIVE,
            action: subAction,
            reason: `Automated ${subAction} upon successful online payment ${receiptNumber}`,
            adminUserId: finalAdminUserId,
            oldEndDate: targetSub.endDate,
            newEndDate,
            metadata: {
              gatewayPaymentId,
              receiptNumber,
              invoiceNumber: invoice.invoiceNumber,
            },
          },
        });

        // Restore FreeRADIUS radcheck credentials & radreply attributes
        if (invoice.customer.username && invoice.customer.pppoePassword) {
          await tx.radCheck.deleteMany({
            where: { username: invoice.customer.username, attribute: 'Cleartext-Password' },
          });
          await tx.radCheck.create({
            data: {
              username: invoice.customer.username,
              attribute: 'Cleartext-Password',
              op: ':=',
              value: invoice.customer.pppoePassword,
            },
          });

          if (targetSub.plan) {
            const radiusPolicy = translateNetworkPolicyToRadius(buildNetworkPolicyFromPlan(targetSub.plan));
            const rateLimit = radiusPolicy['Mikrotik-Rate-Limit'];
            await tx.radReply.deleteMany({
              where: { username: invoice.customer.username },
            });
            await tx.radReply.createMany({
              data: [
                {
                  username: invoice.customer.username,
                  attribute: 'Mikrotik-Rate-Limit',
                  op: '=',
                  value: rateLimit,
                },
                {
                  username: invoice.customer.username,
                  attribute: 'Framed-Protocol',
                  op: '=',
                  value: 'PPP',
                },
                {
                  username: invoice.customer.username,
                  attribute: 'Service-Type',
                  op: '=',
                  value: 'Framed-User',
                },
                {
                  username: invoice.customer.username,
                  attribute: 'Acct-Interim-Interval',
                  op: '=',
                  value: '300',
                },
              ],
            });
          }
        }
      }

      // Auto-activate customer if pending or suspended
      if (invoice.customer.status === CustomerStatus.SUSPENDED || invoice.customer.status === CustomerStatus.PENDING) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { status: CustomerStatus.ACTIVE },
        });
      }

      // 7. Audit Logs
      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: finalAdminUserId,
          action: AuditAction.COLLECT_PAYMENT,
          entityType: 'PAYMENT',
          entityId: payment.id,
          details: {
            receiptNumber,
            invoiceNumber: invoice.invoiceNumber,
            amount: paymentAmountDec.toFixed(2),
            gatewayPaymentId,
            idempotencyKey: effectiveIdempotencyKey,
            subscriptionRenewed: Boolean(updatedSubscription),
          },
        },
      });

      return {
        isSuccess: true,
        isDuplicate: false,
        payment: {
          ...payment,
          amount: paymentAmountDec.toFixed(2),
        },
        invoice: {
          ...updatedInvoice,
          totalAmount: totalDec.toFixed(2),
          paidAmount: newPaidDec.toFixed(2),
          balanceDue: '0.00',
        },
        subscription: updatedSubscription,
      };
    });

    if (this.coaQueueService && !result.isDuplicate && invoiceId) {
      const inv = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { customer: true, subscription: true },
      });
      if (inv?.customer?.username) {
        this.coaQueueService
          .queueCoaJob({
            organizationId,
            customerId: inv.customerId,
            subscriptionId: inv.subscriptionId || undefined,
            username: inv.customer.username,
            action: CoaAction.REACTIVATE,
            requestType: CoaRequestType.COA,
            reason: `Automated reactivation on online payment ${gatewayPaymentId}`,
          })
          .catch((err) => console.warn(`[PaymentsService] CoA enqueue error: ${err.message}`));
      }
    }

    return result;
    } catch (err: any) {
      if (err?.code === 'P2002' || err?.message?.includes('Unique constraint')) {
        const existing = await prisma.payment.findFirst({
          where: {
            organizationId,
            OR: [
              { gatewayPaymentId },
              { idempotencyKey: effectiveIdempotencyKey },
            ],
          },
          include: { invoice: true, customer: true },
        });
        if (existing) {
          return {
            isSuccess: true,
            isDuplicate: true,
            message: 'Concurrent payment callback processed idempotently.',
            payment: {
              ...existing,
              amount: new Decimal(existing.amount.toString()).toFixed(2),
            },
            invoice: existing.invoice
              ? {
                  ...existing.invoice,
                  totalAmount: new Decimal(existing.invoice.totalAmount.toString()).toFixed(2),
                  paidAmount: new Decimal(existing.invoice.paidAmount.toString()).toFixed(2),
                  balanceDue: '0.00',
                }
              : null,
          };
        }
      }
      throw err;
    }
  }

  /**
   * Refund an online or manual payment
   */
  async refundPayment(
    organizationId: string,
    adminUserId: string | undefined,
    paymentId: string,
    data: { amount?: string | number; reason?: string },
  ) {
    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, organizationId },
      include: { invoice: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found in your organization');
    }

    if (payment.status === PaymentStatus.REFUNDED) {
      return {
        isSuccess: true,
        message: 'Payment was already refunded',
        payment,
      };
    }

    const refundAmountDec = data.amount ? toMoneyDecimal(data.amount) : new Decimal(payment.amount.toString());
    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    // Call provider refund if gateway payment ID exists
    if (payment.gatewayPaymentId) {
      await this.paymentProvider.refund({
        gatewayPaymentId: payment.gatewayPaymentId,
        amount: refundAmountDec.toFixed(2),
        reason: data.reason,
      });
    }

    return prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.REFUNDED,
        },
      });

      // If tied to an invoice, adjust paid amount and reopen invoice if needed
      let updatedInvoice = null;
      if (payment.invoiceId) {
        const inv = await tx.invoice.findFirst({ where: { id: payment.invoiceId } });
        if (inv) {
          const currentPaid = new Decimal(inv.paidAmount.toString());
          const newPaid = Decimal.max(0, currentPaid.minus(refundAmountDec));
          const total = new Decimal(inv.totalAmount.toString());
          const newStatus = newPaid.gte(total) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

          updatedInvoice = await tx.invoice.update({
            where: { id: inv.id },
            data: {
              paidAmount: newPaid.toFixed(2),
              status: newStatus,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: finalAdminUserId,
          action: AuditAction.UPDATE,
          entityType: 'PAYMENT',
          entityId: payment.id,
          details: {
            action: 'REFUND',
            refundAmount: refundAmountDec.toFixed(2),
            reason: data.reason || 'User requested refund',
          },
        },
      });

      return {
        isSuccess: true,
        payment: {
          ...updatedPayment,
          amount: new Decimal(updatedPayment.amount.toString()).toFixed(2),
        },
        invoice: updatedInvoice,
      };
    });
  }

  /**
   * Record payment (manual cash/UPI/transfer) atomically with Decimal financial math
   */
  async recordPayment(organizationId: string, adminUserId: string | undefined, data: any) {
    const { customerId, invoiceId, amount, paymentMethod, transactionRef, notes } = data;

    if (!customerId) {
      throw new BadRequestException('customerId is required');
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found in your organization');
    }

    let paymentDecimal: Decimal;
    try {
      paymentDecimal = toMoneyDecimal(amount);
      if (paymentDecimal.lte(0)) {
        throw new Error('Payment amount must be greater than zero');
      }
    } catch (e: any) {
      throw new BadRequestException(e.message || 'Invalid payment amount');
    }

    const finalAdminUserId = await this.sanitizeAdminUserId(adminUserId);

    const finalResult = await prisma.$transaction(async (tx) => {
      let settlementResult: any = null;

      if (invoiceId) {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, organizationId },
        });

        if (!invoice) {
          throw new NotFoundException('Invoice not found in your organization');
        }

        if (invoice.status === InvoiceStatus.CANCELLED) {
          throw new BadRequestException('Cannot record payment against a cancelled invoice');
        }

        if (invoice.status === InvoiceStatus.PAID) {
          throw new BadRequestException('Invoice is already fully paid');
        }

        try {
          settlementResult = calculatePaymentSettlement({
            totalAmount: invoice.totalAmount.toString(),
            currentPaidAmount: invoice.paidAmount.toString(),
            paymentAmount: paymentDecimal.toFixed(2),
          });
        } catch (err: any) {
          throw new BadRequestException(err.message);
        }

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: settlementResult.newPaidAmount,
            status: settlementResult.targetStatus,
            paidAt: settlementResult.isFullyPaid ? new Date() : invoice.paidAt,
          },
        });
      }

      const count = await tx.payment.count({ where: { organizationId } });
      const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
      const seq = String(count + 1).padStart(4, '0');
      let receiptNumber = `RCPT-${yearMonth}-${seq}`;

      const existing = await tx.payment.findFirst({
        where: { organizationId, receiptNumber },
      });
      if (existing) {
        receiptNumber = `RCPT-${yearMonth}-${seq}-${Date.now().toString().slice(-4)}`;
      }

      const payment = await tx.payment.create({
        data: {
          organizationId,
          customerId,
          invoiceId: invoiceId || null,
          receiptNumber,
          amount: paymentDecimal.toFixed(2),
          paymentMethod: paymentMethod || PaymentMethod.CASH,
          status: PaymentStatus.SUCCESS,
          transactionRef: transactionRef || null,
          collectedById: finalAdminUserId,
          paidAt: new Date(),
          notes: notes || null,
        },
        include: {
          customer: true,
          invoice: true,
        },
      });

      if (
        (customer.status === CustomerStatus.SUSPENDED || customer.status === CustomerStatus.PENDING) &&
        (!settlementResult || settlementResult.isFullyPaid)
      ) {
        await tx.customer.update({
          where: { id: customer.id },
          data: { status: CustomerStatus.ACTIVE },
        });

        if (customer.username && customer.pppoePassword) {
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
        }

        await tx.auditLog.create({
          data: {
            organizationId,
            adminUserId: finalAdminUserId,
            action: AuditAction.REACTIVATE_SUBSCRIBER,
            entityType: 'CUSTOMER',
            entityId: customer.id,
            details: {
              reason: `Reactivated upon receipt ${receiptNumber} settlement`,
            },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          adminUserId: finalAdminUserId,
          action: AuditAction.COLLECT_PAYMENT,
          entityType: 'PAYMENT',
          entityId: payment.id,
          details: {
            receiptNumber,
            invoiceId,
            amount: paymentDecimal.toFixed(2),
            paymentMethod: paymentMethod || PaymentMethod.CASH,
            settlement: settlementResult,
          },
        },
      });

      return {
        ...payment,
        amount: paymentDecimal.toFixed(2),
        settlement: settlementResult,
      };
    });

    if (this.coaQueueService && customer.username) {
      this.coaQueueService
        .queueCoaJob({
          organizationId,
          customerId: customer.id,
          username: customer.username,
          action: CoaAction.REACTIVATE,
          requestType: CoaRequestType.COA,
          reason: `Reactivated subscriber upon payment collection`,
        })
        .catch((err) => console.warn(`[PaymentsService] CoA reactivation enqueue notice: ${err.message}`));
    }

    return finalResult;
  }

  /**
   * Get single payment receipt by ID
   */
  async getById(organizationId: string, id: string) {
    const payment = await prisma.payment.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        invoice: {
          include: {
            items: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found in your organization');
    }

    return {
      ...payment,
      amount: new Decimal(payment.amount.toString()).toFixed(2),
      invoice: payment.invoice
        ? {
            ...payment.invoice,
            totalAmount: new Decimal(payment.invoice.totalAmount.toString()).toFixed(2),
            paidAmount: new Decimal(payment.invoice.paidAmount.toString()).toFixed(2),
          }
        : null,
    };
  }
}
