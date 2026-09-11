import { Injectable, Logger, Optional } from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import {
  SubscriptionStatus,
  CustomerStatus,
  InvoiceStatus,
  PaymentStatus,
  PaymentMethod,
  AuditAction,
  DEFAULT_TIMEZONE,
  calculateSubscriptionEndDate,
  calculateGracePeriodEndDate,
  buildNetworkPolicyFromPlan,
  translateNetworkPolicyToRadius,
  CoaAction,
  CoaRequestType,
  NotificationEmitter,
  NotificationEventType,
  ExpiryProcessingResult,
  RenewalProcessingResult,
} from '@isp-crm/shared';
import { RadiusCoaQueueService } from '../radius/radius-coa-queue.service';

@Injectable()
export class SubscriptionAutomationService {
  private readonly logger = new Logger(SubscriptionAutomationService.name);

  constructor(
    @Optional() private readonly coaQueueService?: RadiusCoaQueueService,
  ) {}

  /**
   * Evaluates all active or grace subscriptions across the organization (or globally)
   * and marks expired ones according to the 5-step automated workflow.
   */
  async evaluateExpiry(organizationId?: string): Promise<{
    scanned: number;
    expired: number;
    results: ExpiryProcessingResult[];
  }> {
    const now = new Date();
    const where: any = {
      status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE] },
      endDate: { lte: now },
    };

    if (organizationId) {
      where.organizationId = organizationId;
    }

    const subscriptions = await prisma.subscription.findMany({
      where,
      include: { customer: true, plan: true },
      take: 250,
      orderBy: { endDate: 'asc' },
    });

    const results: ExpiryProcessingResult[] = [];
    let expiredCount = 0;

    for (const sub of subscriptions) {
      const graceEndDate = calculateGracePeriodEndDate(sub.endDate, sub.gracePeriodDays);

      if (now > graceEndDate) {
        const res = await this.expireSubscription(sub.id, {
          reason: 'Periodic automated expiration check: validity and grace period elapsed',
        });
        results.push(res);
        if (res.processed && res.status === 'EXPIRED') {
          expiredCount++;
        }
      } else if (sub.status === SubscriptionStatus.ACTIVE) {
        // Transition to GRACE
        await prisma.$transaction(async (tx) => {
          await tx.subscription.update({
            where: { id: sub.id },
            data: { status: SubscriptionStatus.GRACE },
          });
          await tx.subscriptionHistory.create({
            data: {
              organizationId: sub.organizationId,
              subscriptionId: sub.id,
              fromStatus: SubscriptionStatus.ACTIVE,
              toStatus: SubscriptionStatus.GRACE,
              action: 'GRACE_PERIOD',
              reason: 'Validity elapsed, subscription entered grace period',
            },
          });
        });
      }
    }

    this.logger.log(`Expiry evaluation finished: ${subscriptions.length} scanned, ${expiredCount} expired.`);
    return {
      scanned: subscriptions.length,
      expired: expiredCount,
      results,
    };
  }

  /**
   * 5-Step Subscription Expiration Automation (Guaranteed Idempotent)
   * 1. Mark subscription EXPIRED
   * 2. Create audit event
   * 3. Enqueue suspension
   * 4. Send notification event
   * 5. Update customer status
   */
  async expireSubscription(
    subscriptionId: string,
    options: { reason?: string; adminUserId?: string } = {},
  ): Promise<ExpiryProcessingResult> {
    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { customer: true, plan: true },
    });

    if (!sub) {
      return {
        processed: false,
        subscriptionId,
        customerId: '',
        status: 'SKIPPED',
        auditLogged: false,
        suspensionQueued: false,
        notificationSent: false,
        customerStatusUpdated: false,
        message: `Subscription '${subscriptionId}' not found`,
        timestamp: new Date().toISOString(),
      };
    }

    // IDEMPOTENCY CHECK: If already EXPIRED, return without duplicate mutations
    if (sub.status === SubscriptionStatus.EXPIRED || sub.status === SubscriptionStatus.CANCELLED) {
      return {
        processed: false,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        status: 'ALREADY_EXPIRED',
        auditLogged: false,
        suspensionQueued: false,
        notificationSent: false,
        customerStatusUpdated: false,
        message: `Subscription '${subscriptionId}' is already '${sub.status}'`,
        timestamp: new Date().toISOString(),
      };
    }

    const previousStatus = sub.status;
    const reason = options.reason || 'Subscription reached expiry';

    // 1, 2, 3(DB), 5: Atomic Database Transaction
    await prisma.$transaction(async (tx) => {
      // 1. Mark subscription EXPIRED
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.EXPIRED },
      });

      await tx.subscriptionHistory.create({
        data: {
          organizationId: sub.organizationId,
          subscriptionId: sub.id,
          fromStatus: previousStatus,
          toStatus: SubscriptionStatus.EXPIRED,
          action: 'EXPIRE',
          reason,
          adminUserId: options.adminUserId || null,
          metadata: { automated: true, previousEndDate: sub.endDate },
        },
      });

      // 2. Create Audit Event in audit_logs
      await tx.auditLog.create({
        data: {
          organizationId: sub.organizationId,
          adminUserId: options.adminUserId || null,
          action: AuditAction.STATUS_CHANGE,
          entityType: 'SUBSCRIPTION',
          entityId: sub.id,
          details: {
            action: 'AUTOMATED_EXPIRATION',
            fromStatus: previousStatus,
            toStatus: SubscriptionStatus.EXPIRED,
            reason,
            customerId: sub.customerId,
            username: sub.customer?.username,
          },
        },
      });

      // 3a. Invalidate FreeRADIUS credentials in radcheck & radreply
      if (sub.customer?.username) {
        await tx.radCheck.deleteMany({
          where: { username: sub.customer.username, attribute: 'Cleartext-Password' },
        });
        await tx.radCheck.create({
          data: {
            username: sub.customer.username,
            attribute: 'Cleartext-Password',
            op: ':=',
            value: `SUSPENDED_${Date.now()}`,
          },
        });
        await tx.radReply.deleteMany({
          where: { username: sub.customer.username },
        });
      }

      // 5. Update Customer Status (only if no other active/grace subscriptions exist)
      const remainingActive = await tx.subscription.count({
        where: {
          customerId: sub.customerId,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE] },
          id: { not: sub.id },
        },
      });

      if (remainingActive === 0 && sub.customer) {
        const prevCustStatus = sub.customer.status;
        await tx.customer.update({
          where: { id: sub.customerId },
          data: { status: CustomerStatus.EXPIRED },
        });

        await tx.auditLog.create({
          data: {
            organizationId: sub.organizationId,
            adminUserId: options.adminUserId || null,
            action: AuditAction.STATUS_CHANGE,
            entityType: 'CUSTOMER',
            entityId: sub.customerId,
            details: {
              fromStatus: prevCustStatus,
              toStatus: CustomerStatus.EXPIRED,
              reason: 'All subscriptions expired',
            },
          },
        });
      }
    });

    // 3b. Enqueue Suspension (RFC 3576 PoD Disconnect-Request)
    let suspensionQueued = false;
    if (this.coaQueueService && sub.customer?.username) {
      try {
        await this.coaQueueService.queueCoaJob({
          organizationId: sub.organizationId,
          customerId: sub.customerId,
          subscriptionId: sub.id,
          username: sub.customer.username,
          action: CoaAction.SUSPEND,
          requestType: CoaRequestType.DISCONNECT,
          reason,
          adminUserId: options.adminUserId,
        });
        suspensionQueued = true;
      } catch (err: any) {
        this.logger.warn(`Failed to enqueue suspension PoD: ${err.message}`);
      }
    }

    // 4. Send Notification Event
    let notificationSent = false;
    if (sub.customer) {
      try {
        await NotificationEmitter.emit({
          type: NotificationEventType.SUBSCRIPTION_EXPIRED,
          organizationId: sub.organizationId,
          customerId: sub.customerId,
          subscriptionId: sub.id,
          recipient: {
            name: sub.customer.name,
            username: sub.customer.username,
            email: sub.customer.email,
            mobile: sub.customer.mobile,
          },
          subject: 'Service Notice: Internet Subscription Expired',
          message: `Dear ${sub.customer.name}, your subscription for ${sub.plan?.name || 'Internet'} has expired and service has been suspended. Please renew to restore high-speed internet.`,
          metadata: { planName: sub.plan?.name, endDate: sub.endDate, reason },
        });
        notificationSent = true;
      } catch (notifErr: any) {
        this.logger.warn(`Failed to dispatch expiry notification: ${notifErr.message}`);
      }
    }

    return {
      processed: true,
      subscriptionId: sub.id,
      customerId: sub.customerId,
      status: 'EXPIRED',
      auditLogged: true,
      suspensionQueued,
      notificationSent,
      customerStatusUpdated: true,
      message: `Subscription '${sub.id}' successfully expired`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 4-Step Payment/Renewal Automation (Guaranteed Idempotent)
   * 1. Mark invoice PAID
   * 2. Activate/renew subscription (extend validity server-side)
   * 3. Enqueue reactivation (CoA speed restore or reconnect)
   * 4. Update customer status (ACTIVE)
   */
  async processPaymentRenewal(
    invoiceId: string,
    options: {
      paymentMethod?: PaymentMethod;
      transactionRef?: string;
      adminUserId?: string;
      idempotencyKey?: string;
    } = {},
  ): Promise<RenewalProcessingResult> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        subscription: { include: { plan: true } },
        organization: true,
      },
    });

    if (!invoice) {
      return {
        processed: false,
        invoiceId,
        customerId: '',
        status: 'SKIPPED',
        invoiceMarkedPaid: false,
        subscriptionRenewed: false,
        reactivationQueued: false,
        customerStatusUpdated: false,
        message: `Invoice '${invoiceId}' not found`,
        timestamp: new Date().toISOString(),
      };
    }

    // IDEMPOTENCY CHECK: If already PAID, return without double-renewing
    if (invoice.status === InvoiceStatus.PAID) {
      return {
        processed: false,
        invoiceId: invoice.id,
        subscriptionId: invoice.subscriptionId || undefined,
        customerId: invoice.customerId,
        status: 'ALREADY_PAID',
        invoiceMarkedPaid: true,
        subscriptionRenewed: false,
        reactivationQueued: false,
        customerStatusUpdated: false,
        message: `Invoice '${invoiceId}' is already marked PAID`,
        timestamp: new Date().toISOString(),
      };
    }

    let targetSub = invoice.subscription;
    let newEndDate: Date = new Date();
    let rateLimit = '50M/50M';

    // 1, 2, 3(DB), 4: Atomic Database Transaction
    await prisma.$transaction(async (tx) => {
      // 1. Mark invoice PAID
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.PAID,
          paidAmount: invoice.totalAmount,
          paidAt: new Date(),
        },
      });

      // Ensure payment record exists
      const existingPayment = await tx.payment.findFirst({
        where: { invoiceId: invoice.id, status: PaymentStatus.SUCCESS },
      });

      if (!existingPayment) {
        await tx.payment.create({
          data: {
            organizationId: invoice.organizationId,
            customerId: invoice.customerId,
            invoiceId: invoice.id,
            receiptNumber: `RCP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            amount: invoice.totalAmount,
            paymentMethod: options.paymentMethod || PaymentMethod.CASH,
            status: PaymentStatus.SUCCESS,
            transactionRef: options.transactionRef || `TRX-${Date.now()}`,
            idempotencyKey: options.idempotencyKey || `idemp-${invoice.id}-${Date.now()}`,
          },
        });
      }

      // 2. Activate/Renew Subscription
      if (!targetSub) {
        targetSub = await tx.subscription.findFirst({
          where: {
            customerId: invoice.customerId,
            organizationId: invoice.organizationId,
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
        newEndDate = calculateSubscriptionEndDate(anchorDate, targetSub.billingCycle, validityDays, orgTz);

        const subAction = targetSub.status === SubscriptionStatus.PENDING ? 'ACTIVATE' : 'RENEW';

        await tx.subscription.update({
          where: { id: targetSub.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            endDate: newEndDate,
          },
        });

        await tx.subscriptionHistory.create({
          data: {
            organizationId: invoice.organizationId,
            subscriptionId: targetSub.id,
            fromStatus: targetSub.status,
            toStatus: SubscriptionStatus.ACTIVE,
            action: subAction,
            reason: `Automated ${subAction} upon invoice payment ${invoice.invoiceNumber}`,
            adminUserId: options.adminUserId || null,
            oldEndDate: targetSub.endDate,
            newEndDate,
          },
        });

        // 3a. Restore FreeRADIUS radcheck credentials and radreply limits
        if (invoice.customer.username) {
          await tx.radCheck.deleteMany({
            where: { username: invoice.customer.username, attribute: 'Cleartext-Password' },
          });
          await tx.radCheck.create({
            data: {
              username: invoice.customer.username,
              attribute: 'Cleartext-Password',
              op: ':=',
              value: invoice.customer.pppoePassword || '123456',
            },
          });

          if (targetSub.plan) {
            const radiusPolicy = translateNetworkPolicyToRadius(buildNetworkPolicyFromPlan(targetSub.plan));
            rateLimit = radiusPolicy['Mikrotik-Rate-Limit'];

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

      // 4. Update Customer Status to ACTIVE
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { status: CustomerStatus.ACTIVE },
      });

      await tx.auditLog.create({
        data: {
          organizationId: invoice.organizationId,
          adminUserId: options.adminUserId || null,
          action: AuditAction.COLLECT_PAYMENT,
          entityType: 'INVOICE',
          entityId: invoice.id,
          details: {
            action: 'AUTOMATED_PAYMENT_RENEWAL',
            invoiceNumber: invoice.invoiceNumber,
            amount: invoice.totalAmount.toString(),
            subscriptionId: targetSub?.id,
            newEndDate,
          },
        },
      });
    });

    // 3b. Enqueue Reactivation CoA to Router
    let reactivationQueued = false;
    if (this.coaQueueService && invoice.customer?.username) {
      try {
        await this.coaQueueService.queueCoaJob({
          organizationId: invoice.organizationId,
          customerId: invoice.customerId,
          subscriptionId: targetSub?.id,
          username: invoice.customer.username,
          action: CoaAction.REACTIVATE,
          requestType: CoaRequestType.COA,
          rateLimit,
          reason: `Automated reactivation on invoice payment ${invoice.invoiceNumber}`,
          adminUserId: options.adminUserId,
        });
        reactivationQueued = true;
      } catch (err: any) {
        this.logger.warn(`Failed to enqueue reactivation CoA: ${err.message}`);
      }
    }

    // Send Notification Event
    try {
      await NotificationEmitter.emit({
        type: NotificationEventType.SUBSCRIPTION_RENEWED,
        organizationId: invoice.organizationId,
        customerId: invoice.customerId,
        subscriptionId: targetSub?.id,
        recipient: {
          name: invoice.customer.name,
          username: invoice.customer.username,
          email: invoice.customer.email,
          mobile: invoice.customer.mobile,
        },
        subject: 'Invoice Paid & Subscription Renewed',
        message: `Dear ${invoice.customer.name}, we received your payment for invoice ${invoice.invoiceNumber}. Your subscription is active until ${newEndDate.toLocaleDateString()}. Thank you!`,
        metadata: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          newEndDate,
        },
      });
    } catch (notifErr: any) {
      this.logger.warn(`Failed to emit renewal notification: ${notifErr.message}`);
    }

    return {
      processed: true,
      invoiceId: invoice.id,
      subscriptionId: targetSub?.id,
      customerId: invoice.customerId,
      status: 'RENEWED',
      invoiceMarkedPaid: true,
      subscriptionRenewed: Boolean(targetSub),
      reactivationQueued,
      customerStatusUpdated: true,
      message: `Invoice '${invoice.id}' paid and subscription renewed successfully`,
      timestamp: new Date().toISOString(),
    };
  }
}
