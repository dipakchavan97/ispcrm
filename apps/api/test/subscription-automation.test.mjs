import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@isp-crm/database';
import {
  SubscriptionStatus,
  CustomerStatus,
  InvoiceStatus,
  PaymentStatus,
  PaymentMethod,
  AuditAction,
  MockNAS,
  NotificationEmitter,
  NotificationEventType,
} from '@isp-crm/shared';
import {
  executeSubscriptionExpiryAutomation,
  executePaymentRenewalAutomation,
  scanAndProcessExpiredSubscriptions,
  processBillingJob,
} from '../../worker/dist/processors/billing.processor.js';

test('Subscription Automation: 5-Step Expiry Flow, 4-Step Renewal Flow, Idempotency & Safe Retries', async (t) => {
  const ts = Date.now();
  NotificationEmitter.clearHistory();

  // 1. Setup MockNAS test double to receive RFC 3576 Disconnect & CoA packets
  const mockNas = new MockNAS({ secret: 'testing123', behavior: 'ACK' });
  const nasPort = await mockNas.start(0);

  // 2. Setup Organization, Plan, Customer, and Router in Database
  const org = await prisma.organization.create({
    data: {
      name: `Automation Org ${ts}`,
      slug: `auto-org-${ts}`,
      email: `auto.${ts}@isp.net`,
      phone: '9876543210',
    },
  });

  const plan = await prisma.internetPlan.create({
    data: {
      organizationId: org.id,
      name: `Fiber 50M ${ts}`,
      code: `FIBER-50M-${ts}`,
      downloadSpeed: 50,
      uploadSpeed: 25,
      downloadSpeedMbps: 50,
      uploadSpeedMbps: 25,
      validityDays: 30,
      price: 599.00,
    },
  });

  const router = await prisma.router.create({
    data: {
      organizationId: org.id,
      name: `Core Router ${ts}`,
      host: '127.0.0.1',
      port: nasPort,
      username: 'admin',
      encryptedCredential: 'encrypted_dummy',
      radiusSecret: 'testing123',
    },
  });

  const customer = await prisma.customer.create({
    data: {
      organizationId: org.id,
      customerCode: `CUST-AUTO-${ts}`,
      name: `Subscriber Auto ${ts}`,
      mobile: '9811223344',
      username: `user_auto_${ts}`,
      pppoePassword: 'SecretPassword99',
      status: CustomerStatus.ACTIVE,
    },
  });

  // Mock active session in radacct
  await prisma.radAcct.create({
    data: {
      acctuniqueid: `uniq_auto_${ts}`,
      acctsessionid: `sess_auto_${ts}`,
      username: customer.username,
      nasipaddress: '127.0.0.1',
      framedipaddress: '100.64.5.10',
      acctstarttime: new Date(Date.now() - 3600000),
    },
  });

  // Setup initial radcheck password
  await prisma.radCheck.create({
    data: {
      username: customer.username,
      attribute: 'Cleartext-Password',
      op: ':=',
      value: customer.pppoePassword,
    },
  });

  await t.test('1. Expiry Automation: 5-step sequence when subscription reaches expiry', async () => {
    // Create an expired subscription (ended 5 days ago, grace period = 2 days -> fully expired)
    const expiredEndDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const sub = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
        endDate: expiredEndDate,
        gracePeriodDays: 2,
        price: plan.price,
      },
    });

    mockNas.clearHistory();
    NotificationEmitter.clearHistory();

    // Execute Expiry Automation
    const result = await executeSubscriptionExpiryAutomation(sub.id, {
      reason: 'Automated test expiry execution',
    });

    assert.equal(result.processed, true);
    assert.equal(result.status, 'EXPIRED');
    assert.equal(result.auditLogged, true);
    assert.equal(result.notificationSent, true);
    assert.equal(result.customerStatusUpdated, true);

    // Step 1 Verification: Mark subscription EXPIRED
    const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.equal(updatedSub.status, SubscriptionStatus.EXPIRED);

    const history = await prisma.subscriptionHistory.findFirst({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(history.toStatus, SubscriptionStatus.EXPIRED);
    assert.equal(history.action, 'EXPIRE');

    // Step 2 Verification: Create audit event in audit_logs
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        organizationId: org.id,
        entityType: 'SUBSCRIPTION',
        entityId: sub.id,
        action: AuditAction.STATUS_CHANGE,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(auditLog, 'Audit log entry must be created');
    assert.equal(auditLog.details.toStatus, 'EXPIRED');

    // Step 3 Verification: FreeRADIUS credentials invalidated & suspension PoD enqueued/dispatched
    const radCheck = await prisma.radCheck.findFirst({
      where: { username: customer.username, attribute: 'Cleartext-Password' },
    });
    assert.ok(radCheck.value.startsWith('SUSPENDED_'), 'FreeRADIUS password must be locked');

    assert.ok(mockNas.receivedPackets.length >= 1, 'MockNAS must receive Disconnect-Request (PoD)');
    assert.equal(mockNas.receivedPackets[0].username, customer.username);
    assert.equal(mockNas.receivedPackets[0].code, 40, 'Code must be Disconnect-Request (40)');

    // Step 4 Verification: Send notification event
    assert.equal(NotificationEmitter.eventHistory.length, 1);
    const notif = NotificationEmitter.eventHistory[0];
    assert.equal(notif.type, NotificationEventType.SUBSCRIPTION_EXPIRED);
    assert.equal(notif.customerId, customer.id);
    assert.equal(notif.recipient.username, customer.username);

    // Step 5 Verification: Update customer status
    const updatedCustomer = await prisma.customer.findUnique({ where: { id: customer.id } });
    assert.equal(updatedCustomer.status, CustomerStatus.EXPIRED);
  });

  await t.test('2. Idempotency of Expiry Automation: Repeated execution safely no-ops', async () => {
    const sub = await prisma.subscription.findFirst({
      where: { customerId: customer.id, status: SubscriptionStatus.EXPIRED },
    });
    assert.ok(sub);

    const auditCountBefore = await prisma.auditLog.count({
      where: { entityId: sub.id, action: AuditAction.STATUS_CHANGE },
    });
    const notifCountBefore = NotificationEmitter.eventHistory.length;

    // Run expiration again
    const secondRun = await executeSubscriptionExpiryAutomation(sub.id);

    assert.equal(secondRun.processed, false, 'Second run must not process already expired subscription');
    assert.equal(secondRun.status, 'ALREADY_EXPIRED');

    // Assert no duplicate audit logs or duplicate notifications
    const auditCountAfter = await prisma.auditLog.count({
      where: { entityId: sub.id, action: AuditAction.STATUS_CHANGE },
    });
    assert.equal(auditCountAfter, auditCountBefore, 'Must not duplicate audit log entries');
    assert.equal(NotificationEmitter.eventHistory.length, notifCountBefore, 'Must not duplicate notifications');
  });

  await t.test('3. Payment & Renewal Automation: 4-step sequence on invoice settlement', async () => {
    // Setup customer with an expired subscription and an unpaid invoice
    const sub = await prisma.subscription.findFirst({
      where: { customerId: customer.id },
    });

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        subscriptionId: sub.id,
        invoiceNumber: `INV-AUTO-${ts}`,
        dueDate: new Date(),
        subtotal: 599.00,
        totalAmount: 706.82,
        status: InvoiceStatus.ISSUED,
      },
    });

    mockNas.clearHistory();
    NotificationEmitter.clearHistory();

    // Execute Payment Renewal Automation
    const renewalResult = await executePaymentRenewalAutomation(invoice.id, {
      paymentMethod: PaymentMethod.UPI,
      transactionRef: `UPI-REF-${ts}`,
    });

    assert.equal(renewalResult.processed, true);
    assert.equal(renewalResult.status, 'RENEWED');
    assert.equal(renewalResult.invoiceMarkedPaid, true);
    assert.equal(renewalResult.subscriptionRenewed, true);
    assert.equal(renewalResult.customerStatusUpdated, true);

    // Step 1 Verification: Mark invoice PAID
    const updatedInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    assert.equal(updatedInvoice.status, InvoiceStatus.PAID);
    assert.ok(updatedInvoice.paidAt);
    assert.equal(Number(updatedInvoice.paidAmount), 706.82);

    // Step 2 Verification: Activate/renew subscription with extended endDate
    const renewedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.equal(renewedSub.status, SubscriptionStatus.ACTIVE);
    assert.ok(new Date(renewedSub.endDate) > new Date(), 'New end date must be in future');

    const subHistory = await prisma.subscriptionHistory.findFirst({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(subHistory.toStatus, SubscriptionStatus.ACTIVE);
    assert.equal(subHistory.action, 'RENEW');

    // Step 3 Verification: FreeRADIUS credentials restored & CoA reactivation enqueued
    const radCheck = await prisma.radCheck.findFirst({
      where: { username: customer.username, attribute: 'Cleartext-Password' },
    });
    assert.equal(radCheck.value, customer.pppoePassword, 'Password must be restored in radcheck');

    const rateLimitReply = await prisma.radReply.findFirst({
      where: { username: customer.username, attribute: 'Mikrotik-Rate-Limit' },
    });
    assert.ok(rateLimitReply, 'Rate-limit must be restored in radreply');

    assert.ok(mockNas.receivedPackets.length >= 1, 'MockNAS must receive CoA request');
    assert.equal(mockNas.receivedPackets[0].code, 43, 'Code must be CoA-Request (43)');

    // Step 4 Verification: Update customer status to ACTIVE
    const renewedCustomer = await prisma.customer.findUnique({ where: { id: customer.id } });
    assert.equal(renewedCustomer.status, CustomerStatus.ACTIVE);

    // Notification event verification
    assert.equal(NotificationEmitter.eventHistory.length, 1);
    assert.equal(NotificationEmitter.eventHistory[0].type, NotificationEventType.SUBSCRIPTION_RENEWED);
  });

  await t.test('4. Idempotency of Payment Renewal: Duplicate calls safely no-op', async () => {
    const invoice = await prisma.invoice.findFirst({
      where: { customerId: customer.id, status: InvoiceStatus.PAID },
    });
    assert.ok(invoice);

    const subBefore = await prisma.subscription.findFirst({ where: { customerId: customer.id } });
    const notifCountBefore = NotificationEmitter.eventHistory.length;

    // Run payment renewal again on the already-paid invoice
    const secondRenewal = await executePaymentRenewalAutomation(invoice.id);

    assert.equal(secondRenewal.processed, false);
    assert.equal(secondRenewal.status, 'ALREADY_PAID');

    // Assert endDate was NOT extended twice
    const subAfter = await prisma.subscription.findFirst({ where: { customerId: customer.id } });
    assert.equal(subAfter.endDate.getTime(), subBefore.endDate.getTime(), 'Subscription endDate must remain unchanged');
    assert.equal(NotificationEmitter.eventHistory.length, notifCountBefore, 'No duplicate notification');
  });

  await t.test('5. Periodic Expiry Scanner: Identifies and processes expired subscriptions', async () => {
    // Create a new subscriber with an expired subscription
    const expiredCust = await prisma.customer.create({
      data: {
        organizationId: org.id,
        customerCode: `CUST-SCAN-${ts}`,
        name: `Scan Customer ${ts}`,
        username: `scan_user_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const expiredSub = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        customerId: expiredCust.id,
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        gracePeriodDays: 2,
        price: plan.price,
      },
    });

    const scanResult = await scanAndProcessExpiredSubscriptions(org.id);
    assert.ok(scanResult.scanned >= 1);
    assert.ok(scanResult.expired >= 1);

    const updatedExpiredSub = await prisma.subscription.findUnique({ where: { id: expiredSub.id } });
    assert.equal(updatedExpiredSub.status, SubscriptionStatus.EXPIRED);

    const updatedExpiredCust = await prisma.customer.findUnique({ where: { id: expiredCust.id } });
    assert.equal(updatedExpiredCust.status, CustomerStatus.EXPIRED);
  });

  await t.test('6. BullMQ processBillingJob Worker Dispatch', async () => {
    // Test EXPIRY_CHECK job execution via worker
    const jobResult = await processBillingJob({
      id: `test-billing-job-${ts}`,
      data: {
        type: 'EXPIRY_CHECK',
        organizationId: org.id,
      },
    });

    assert.equal(jobResult.processed, true);
    assert.equal(jobResult.type, 'EXPIRY_CHECK');
    assert.ok(jobResult.details);
  });

  await mockNas.stop();
});
