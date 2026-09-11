import { Job } from 'bullmq';
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
  RadiusCoaClient,
  CoaAction,
  CoaRequestType,
  NotificationEmitter,
  NotificationEventType,
  SubscriptionAutomationJobData,
  ExpiryProcessingResult,
  RenewalProcessingResult,
} from '@isp-crm/shared';

export { SubscriptionAutomationJobData as BillingJobData };

/**
 * 1. Automated Expiration Processing for a Single Subscription
 * Guaranteed Idempotent & Safe against retries.
 * 
 * 5-Step Expiry Sequence:
 * 1. Mark subscription EXPIRED
 * 2. Create audit event
 * 3. Enqueue suspension (RFC 3576 Disconnect-Request & invalidate FreeRADIUS)
 * 4. Send notification event
 * 5. Update customer status
 */
export async function executeSubscriptionExpiryAutomation(
  subscriptionId: string,
  options: { reason?: string; adminUserId?: string } = {},
): Promise<ExpiryProcessingResult> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      customer: true,
      plan: true,
    },
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

  // IDEMPOTENCY CHECK: If already EXPIRED or CANCELLED, do not re-process
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
      message: `Subscription '${subscriptionId}' is already in status '${sub.status}'`,
      timestamp: new Date().toISOString(),
    };
  }

  const previousStatus = sub.status;
  const reason = options.reason || 'Subscription validity and grace period expired';

  // Step 1, 2, 3(DB credentials), 5: Atomic Database Transaction
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
        metadata: {
          automated: true,
          previousEndDate: sub.endDate,
        },
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

    // 3a. Invalidate FreeRADIUS Credentials
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

      // Clear reply attributes
      await tx.radReply.deleteMany({
        where: { username: sub.customer.username },
      });
    }

    // 5. Update Customer Status (only if no other active/grace subscriptions exist)
    const remainingActiveSubs = await tx.subscription.count({
      where: {
        customerId: sub.customerId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.GRACE] },
        id: { not: sub.id },
      },
    });

    if (remainingActiveSubs === 0 && sub.customer) {
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
            reason: 'All subscriptions reached expiration',
          },
        },
      });
    }
  });

  // 3b. Enqueue/Dispatch Suspension to Live Router (RFC 3576 Disconnect-Request)
  let suspensionQueued = false;
  if (sub.customer?.username) {
    try {
      const activeSession = await prisma.radAcct.findFirst({
        where: { username: sub.customer.username, acctstoptime: null },
        orderBy: { acctstarttime: 'desc' },
      });

      let nasIp = activeSession?.nasipaddress || '127.0.0.1';
      let nasPort = 3799;
      let secret = 'testing123';

      const router = await prisma.router.findFirst({
        where: { organizationId: sub.organizationId },
      });
      if (router) {
        if (!activeSession?.nasipaddress) nasIp = router.host;
        if (router.port) nasPort = router.port;
        if (router.radiusSecret) secret = router.radiusSecret;
      }

      if (activeSession?.nasipaddress) {
        const nasRecord = await prisma.nas.findUnique({
          where: { nasname: activeSession.nasipaddress },
        });
        if (nasRecord?.secret) secret = nasRecord.secret;
      }

      await RadiusCoaClient.sendDisconnectRequest({
        nasIp,
        nasPort,
        secret,
        username: sub.customer.username,
        sessionId: activeSession?.acctsessionid,
        framedIp: activeSession?.framedipaddress,
        timeoutMs: 2500,
        maxRetries: 2,
      });
      suspensionQueued = true;
    } catch (err: any) {
      console.warn(`[BillingWorker] PoD dispatch on expiry for '${sub.customer.username}' notice: ${err.message}`);
      suspensionQueued = false;
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
        subject: 'Service Notice: Your Internet Subscription Has Expired',
        message: `Dear ${sub.customer.name}, your subscription for ${sub.plan?.name || 'Internet Plan'} has reached its expiry date. Your access has been suspended. Please renew your plan to restore immediate connectivity.`,
        metadata: {
          planName: sub.plan?.name,
          endDate: sub.endDate,
          reason,
        },
      });
      notificationSent = true;
    } catch (notifErr: any) {
      console.warn(`[BillingWorker] Notification dispatch error: ${notifErr.message}`);
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
 * 2. Automated Payment & Renewal Processing
 * Guaranteed Idempotent & Safe against retries.
 * 
 * 4-Step Payment/Renewal Sequence:
 * 1. Mark invoice PAID
 * 2. Activate/renew subscription (extend validity server-side)
 * 3. Enqueue reactivation (CoA speed restore or reconnect)
 * 4. Update customer status (ACTIVE)
 */
export async function executePaymentRenewalAutomation(
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

  // IDEMPOTENCY CHECK: If already PAID, do not double-renew or double-extend
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

  // Step 1, 2, 3(DB credentials), 4: Atomic Database Transaction
  let targetSub = invoice.subscription;
  let newEndDate: Date = new Date();
  let rateLimit = '50M/50M';

  await prisma.$transaction(async (tx) => {
    // 1. Mark Invoice PAID
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: InvoiceStatus.PAID,
        paidAmount: invoice.totalAmount,
        paidAt: new Date(),
      },
    });

    // Create Payment Record if not already recorded
    const existingPayment = await tx.payment.findFirst({
      where: { invoiceId: invoice.id, status: PaymentStatus.SUCCESS },
    });

    if (!existingPayment) {
      const receiptNumber = `REC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await tx.payment.create({
        data: {
          organizationId: invoice.organizationId,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          receiptNumber,
          amount: invoice.totalAmount,
          paymentMethod: options.paymentMethod || PaymentMethod.CASH,
          status: PaymentStatus.SUCCESS,
          transactionRef: options.transactionRef || `TRX-${Date.now()}`,
          idempotencyKey: options.idempotencyKey || `idemp-${invoice.id}-${Date.now()}`,
          notes: 'Automated settlement on invoice payment',
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
          reason: `Automated ${subAction} on invoice payment ${invoice.invoiceNumber}`,
          adminUserId: options.adminUserId || null,
          oldEndDate: targetSub.endDate,
          newEndDate,
          metadata: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
          },
        },
      });

      // 3a. Restore FreeRADIUS Credentials in radcheck & radreply
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
    const prevCustStatus = invoice.customer.status;
    await tx.customer.update({
      where: { id: invoice.customerId },
      data: { status: CustomerStatus.ACTIVE },
    });

    // Record Audit Log for Status Change & Payment Collection
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
          customerStatusUpdated: prevCustStatus !== CustomerStatus.ACTIVE,
        },
      },
    });
  });

  // 3b. Enqueue/Dispatch Reactivation CoA to Router
  let reactivationQueued = false;
  if (invoice.customer.username) {
    try {
      const activeSession = await prisma.radAcct.findFirst({
        where: { username: invoice.customer.username, acctstoptime: null },
        orderBy: { acctstarttime: 'desc' },
      });

      let nasIp = activeSession?.nasipaddress || '127.0.0.1';
      let nasPort = 3799;
      let secret = 'testing123';

      const router = await prisma.router.findFirst({
        where: { organizationId: invoice.organizationId },
      });
      if (router) {
        if (!activeSession?.nasipaddress) nasIp = router.host;
        if (router.port) nasPort = router.port;
        if (router.radiusSecret) secret = router.radiusSecret;
      }

      if (activeSession?.nasipaddress) {
        const nasRecord = await prisma.nas.findUnique({
          where: { nasname: activeSession.nasipaddress },
        });
        if (nasRecord?.secret) secret = nasRecord.secret;
      }

      await RadiusCoaClient.sendCoaRequest({
        nasIp,
        nasPort,
        secret,
        username: invoice.customer.username,
        rateLimit,
        sessionId: activeSession?.acctsessionid,
        framedIp: activeSession?.framedipaddress,
        timeoutMs: 2500,
        maxRetries: 2,
      });
      reactivationQueued = true;
    } catch (err: any) {
      console.warn(`[BillingWorker] Reactivation CoA notice for '${invoice.customer.username}': ${err.message}`);
      reactivationQueued = false;
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
      subject: 'Payment Received & Subscription Renewed',
      message: `Dear ${invoice.customer.name}, we have received your payment for invoice ${invoice.invoiceNumber}. Your subscription has been renewed until ${newEndDate.toLocaleDateString()}. Thank you!`,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        newEndDate,
      },
    });
  } catch (notifErr: any) {
    console.warn(`[BillingWorker] Notification dispatch error: ${notifErr.message}`);
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

/**
 * 3. Periodic Expiry Scanner
 * Finds all active or grace subscriptions that have exceeded their validity + grace period
 */
export async function scanAndProcessExpiredSubscriptions(
  organizationId?: string,
): Promise<{ scanned: number; expired: number; results: ExpiryProcessingResult[] }> {
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
    take: 200,
  });

  const results: ExpiryProcessingResult[] = [];
  let expiredCount = 0;

  for (const sub of subscriptions) {
    // Check if grace period has also elapsed
    const graceEndDate = calculateGracePeriodEndDate(sub.endDate, sub.gracePeriodDays);

    if (now > graceEndDate) {
      const res = await executeSubscriptionExpiryAutomation(sub.id, {
        reason: 'Periodic automated expiration check: validity and grace period elapsed',
      });
      results.push(res);
      if (res.processed && res.status === 'EXPIRED') {
        expiredCount++;
      }
    } else if (sub.status === SubscriptionStatus.ACTIVE) {
      // Sub has passed endDate but is still within grace period -> Transition to GRACE
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
            reason: 'Entered grace period',
          },
        });
      });
    }
  }

  return {
    scanned: subscriptions.length,
    expired: expiredCount,
    results,
  };
}

/**
 * Main BullMQ Billing Processor
 */
export async function processBillingJob(
  job: Job<SubscriptionAutomationJobData>,
): Promise<{ processed: boolean; type: string; timestamp: string; details?: any }> {
  console.log(`[Worker:Billing] Processing job '${job.id}' of type: ${job.data.type}`);

  switch (job.data.type) {
    case 'EXPIRY_CHECK': {
      const scanResult = await scanAndProcessExpiredSubscriptions(job.data.organizationId);
      console.log(
        `[Worker:Billing] Expiry check complete: ${scanResult.scanned} scanned, ${scanResult.expired} expired.`,
      );
      return {
        processed: true,
        type: job.data.type,
        timestamp: new Date().toISOString(),
        details: scanResult,
      };
    }

    case 'EXPIRE_SUBSCRIPTION': {
      if (!job.data.subscriptionId) {
        throw new Error('subscriptionId is required for EXPIRE_SUBSCRIPTION job');
      }
      const expiryResult = await executeSubscriptionExpiryAutomation(job.data.subscriptionId, {
        reason: job.data.reason,
      });
      return {
        processed: expiryResult.processed,
        type: job.data.type,
        timestamp: new Date().toISOString(),
        details: expiryResult,
      };
    }

    case 'PAYMENT_RENEWAL': {
      if (!job.data.invoiceId) {
        throw new Error('invoiceId is required for PAYMENT_RENEWAL job');
      }
      const renewalResult = await executePaymentRenewalAutomation(job.data.invoiceId, {
        idempotencyKey: job.data.idempotencyKey,
      });
      return {
        processed: renewalResult.processed,
        type: job.data.type,
        timestamp: new Date().toISOString(),
        details: renewalResult,
      };
    }

    default:
      console.warn(`[Worker:Billing] Unknown billing job type '${(job.data as any).type}'`);
      return {
        processed: false,
        type: (job.data as any).type,
        timestamp: new Date().toISOString(),
      };
  }
}
