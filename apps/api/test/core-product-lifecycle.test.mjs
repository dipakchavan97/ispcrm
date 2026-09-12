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
  RadiusCoaClient,
  RADIUS_COA_CODE,
  CoaAction,
  CoaRequestType,
} from '@isp-crm/shared';
import {
  executeSubscriptionExpiryAutomation,
  executePaymentRenewalAutomation,
  scanAndProcessExpiredSubscriptions,
  processBillingJob,
} from '../../worker/dist/processors/billing.processor.js';
import { processRadiusCoaJob } from '../../worker/dist/processors/radius-coa.processor.js';
import { SubscriptionsService } from '../dist/modules/subscriptions/subscriptions.service.js';

test('Core Product Lifecycle: Rajesh (50 Mbps) -> Upgrade (100 Mbps) -> Expiry Disconnect -> Payment Restores Internet', async (t) => {
  const ts = Date.now();
  NotificationEmitter.clearHistory();

  // 0. Spin up MockNAS test double simulating MikroTik RouterOS Dynamic Authorization Port (RFC 3576)
  const mockNas = new MockNAS({ secret: 'testing123', behavior: 'ACK' });
  const nasPort = await mockNas.start(0);
  assert.ok(nasPort > 0, 'MockNAS should bind to ephemeral test port');

  // 1. Provision Organization
  const org = await prisma.organization.create({
    data: {
      name: `Apex Broadband ${ts}`,
      slug: `apex-${ts}`,
      email: `contact.${ts}@apexisp.in`,
      phone: '9876500000',
    },
  });

  // 2. Provision Admin User
  const adminUser = await prisma.adminUser.create({
    data: {
      organizationId: org.id,
      name: 'System Admin',
      email: `admin.${ts}@apexisp.in`,
      passwordHash: 'dummy_hash',
      role: 'ISP_ADMIN',
    },
  });

  // 3. Register MikroTik Router linked to the NAS Port
  const router = await prisma.router.create({
    data: {
      organizationId: org.id,
      name: `MikroTik CCR2004 - Core BRAS ${ts}`,
      host: '127.0.0.1',
      port: nasPort,
      username: 'admin',
      encryptedCredential: 'encrypted_secret',
      radiusSecret: 'testing123',
    },
  });

  // 4. Provision 50 Mbps and 100 Mbps Plans
  const plan50M = await prisma.internetPlan.create({
    data: {
      organizationId: org.id,
      name: 'Fiber Standard 50 Mbps',
      code: `FIBER-50M-${ts}`,
      downloadSpeed: 50,
      uploadSpeed: 25,
      downloadSpeedMbps: 50,
      uploadSpeedMbps: 25,
      validityDays: 30,
      price: 499.00,
      isActive: true,
    },
  });

  const plan100M = await prisma.internetPlan.create({
    data: {
      organizationId: org.id,
      name: 'Fiber Ultra 100 Mbps',
      code: `FIBER-100M-${ts}`,
      downloadSpeed: 100,
      uploadSpeed: 50,
      downloadSpeedMbps: 100,
      uploadSpeedMbps: 50,
      validityDays: 30,
      price: 799.00,
      isActive: true,
    },
  });

  // 5. Provision Subscriber: Rajesh
  const rajesh = await prisma.customer.create({
    data: {
      organizationId: org.id,
      customerCode: `RAJESH-${ts}`,
      name: 'Rajesh Kumar',
      mobile: '9820098200',
      email: `rajesh.${ts}@gmail.com`,
      username: `rajesh_${ts}`,
      pppoePassword: 'RajeshSecurePass123',
      status: CustomerStatus.ACTIVE,
    },
  });

  // 6. Setup Rajesh's initial 50 Mbps Active Subscription
  const subStartDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
  const subEndDate = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000); // 25 days remaining
  const subscription = await prisma.subscription.create({
    data: {
      organizationId: org.id,
      customerId: rajesh.id,
      planId: plan50M.id,
      status: SubscriptionStatus.ACTIVE,
      startDate: subStartDate,
      endDate: subEndDate,
      price: plan50M.price,
      gracePeriodDays: 2,
    },
  });

  // Initial FreeRADIUS radcheck & radreply configuration
  await prisma.radCheck.create({
    data: {
      username: rajesh.username,
      attribute: 'Cleartext-Password',
      op: ':=',
      value: rajesh.pppoePassword,
    },
  });

  await prisma.radReply.create({
    data: {
      username: rajesh.username,
      attribute: 'Mikrotik-Rate-Limit',
      op: '=',
      value: '25M/50M', // 25M upload, 50M download
    },
  });

  // Active PPPoE Session on MikroTik router
  const activeSessionId = `sess_rajesh_${ts}`;
  await prisma.radAcct.create({
    data: {
      acctuniqueid: `uniq_rajesh_${ts}`,
      acctsessionid: activeSessionId,
      username: rajesh.username,
      nasipaddress: '127.0.0.1',
      framedipaddress: '100.64.20.55',
      acctstarttime: new Date(Date.now() - 3600000), // 1 hour ago
    },
  });

  // -------------------------------------------------------------------------
  // PHASE 1: Rajesh (50 Mbps) -> UPGRADE -> 100 Mbps -> CoA -> MikroTik Live
  // -------------------------------------------------------------------------
  await t.test('Phase 1: Rajesh (50 Mbps, ACTIVE) Upgrades to 100 Mbps with Dynamic CoA to MikroTik', async () => {
    mockNas.clearHistory();

    // 1. Execute Plan Upgrade via SubscriptionsService
    const subsService = new SubscriptionsService();
    const upgradedSub = await subsService.upgrade(
      org.id,
      adminUser.id,
      subscription.id,
      plan100M.id,
      'Rajesh requested high-speed tier upgrade for 4K streaming',
    );

    assert.equal(upgradedSub.id, subscription.id);
    assert.equal(upgradedSub.planId, plan100M.id);
    assert.equal(Number(upgradedSub.price), 799.00);
    assert.equal(upgradedSub.status, SubscriptionStatus.ACTIVE);

    // Verify Subscription History Log
    const history = await prisma.subscriptionHistory.findFirst({
      where: { subscriptionId: subscription.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(history.action, 'UPGRADE');
    assert.equal(history.toPlanId, plan100M.id);

    // Verify FreeRADIUS radreply updated to 50M/100M
    const radReply = await prisma.radReply.findFirst({
      where: { username: rajesh.username, attribute: 'Mikrotik-Rate-Limit' },
    });
    assert.equal(radReply.value, '50M/100M', 'FreeRADIUS radreply rate-limit must be 50M/100M');

    // Worker processes the queued CoA job to the live MikroTik router
    const coaResult = await processRadiusCoaJob({
      id: `coa-upgrade-${ts}`,
      data: {
        organizationId: org.id,
        customerId: rajesh.id,
        subscriptionId: subscription.id,
        username: rajesh.username,
        action: CoaAction.PLAN_UPGRADE,
        requestType: CoaRequestType.COA,
        rateLimit: '50M/100M',
        nasIp: '127.0.0.1',
        nasPort,
        secret: 'testing123',
        sessionId: activeSessionId,
        framedIp: '100.64.20.55',
      },
    });

    assert.equal(coaResult.success, true, 'CoA dispatch must succeed');
    assert.equal(coaResult.codeName, 'COA_ACK');

    // Verify MikroTik / MockNAS received the exact CoA packet
    assert.equal(mockNas.receivedPackets.length, 1);
    const coaPacket = mockNas.receivedPackets[0];
    assert.equal(coaPacket.code, RADIUS_COA_CODE.COA_REQUEST);
    assert.equal(coaPacket.username, rajesh.username);
    assert.equal(coaPacket.sessionId, activeSessionId);
    assert.equal(coaPacket.rateLimit, '50M/100M');

    console.log(`[CoreTest] Phase 1 Success: Rajesh upgraded to 100 Mbps. MikroTik dynamically applied 50M/100M queue.`);
  });

  // -------------------------------------------------------------------------
  // PHASE 2: Subscription Expires -> Automatic Suspension -> MikroTik Disconnect
  // -------------------------------------------------------------------------
  await t.test('Phase 2: Subscription Expires -> Automated Suspension -> FreeRADIUS Lock -> MikroTik PoD Disconnect', async () => {
    mockNas.clearHistory();
    NotificationEmitter.clearHistory();

    // Simulate time elapsed: subscription passes validity and 2-day grace period
    const expiredDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { endDate: expiredDate },
    });

    // Execute 5-Step Automated Expiry Engine
    const expiryResult = await executeSubscriptionExpiryAutomation(subscription.id, {
      reason: 'Automated validity and grace elapsed check',
    });

    assert.equal(expiryResult.processed, true);
    assert.equal(expiryResult.status, 'EXPIRED');
    assert.equal(expiryResult.auditLogged, true);
    assert.equal(expiryResult.notificationSent, true);
    assert.equal(expiryResult.customerStatusUpdated, true);

    // Step 1: Subscription is EXPIRED in Database
    const subInDb = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    assert.equal(subInDb.status, SubscriptionStatus.EXPIRED);

    // Step 2: Audit Event created
    const auditLog = await prisma.auditLog.findFirst({
      where: { entityId: subscription.id, action: AuditAction.STATUS_CHANGE },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(auditLog);
    assert.equal(auditLog.details.toStatus, 'EXPIRED');

    // Step 3: FreeRADIUS credentials locked & MikroTik Disconnect sent
    const radCheck = await prisma.radCheck.findFirst({
      where: { username: rajesh.username, attribute: 'Cleartext-Password' },
    });
    assert.ok(radCheck.value.startsWith('SUSPENDED_'), 'FreeRADIUS password must be locked');

    assert.equal(mockNas.receivedPackets.length, 1);
    const podPacket = mockNas.receivedPackets[0];
    assert.equal(podPacket.code, RADIUS_COA_CODE.DISCONNECT_REQUEST);
    assert.equal(podPacket.username, rajesh.username);
    assert.equal(podPacket.sessionId, activeSessionId);

    // Step 4: Notification event emitted
    assert.equal(NotificationEmitter.eventHistory.length, 1);
    const notif = NotificationEmitter.eventHistory[0];
    assert.equal(notif.type, NotificationEventType.SUBSCRIPTION_EXPIRED);
    assert.equal(notif.recipient.username, rajesh.username);

    // Step 5: Customer status updated to EXPIRED
    const rajeshInDb = await prisma.customer.findUnique({ where: { id: rajesh.id } });
    assert.equal(rajeshInDb.status, CustomerStatus.EXPIRED);

    console.log(`[CoreTest] Phase 2 Success: Rajesh expired. FreeRADIUS locked. MikroTik PoD disconnected session.`);
  });

  // -------------------------------------------------------------------------
  // PHASE 3: Payment -> Renew -> FreeRADIUS Restored -> CoA -> Internet Restored
  // -------------------------------------------------------------------------
  await t.test('Phase 3: Rajesh Pays Invoice -> Renewal -> FreeRADIUS Restored -> CoA -> Internet Restored', async () => {
    mockNas.clearHistory();
    NotificationEmitter.clearHistory();

    // 1. Create renewal invoice for Rajesh
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: org.id,
        customerId: rajesh.id,
        subscriptionId: subscription.id,
        invoiceNumber: `INV-RAJESH-${ts}`,
        dueDate: new Date(),
        subtotal: 799.00,
        totalAmount: 942.82, // including GST
        status: InvoiceStatus.ISSUED,
      },
    });

    // 2. Rajesh makes payment via UPI -> Execute 4-Step Payment Renewal Automation
    const renewalResult = await executePaymentRenewalAutomation(invoice.id, {
      paymentMethod: PaymentMethod.UPI,
      transactionRef: `UPI-TXN-RAJESH-${ts}`,
      adminUserId: adminUser.id,
    });

    assert.equal(renewalResult.processed, true);
    assert.equal(renewalResult.status, 'RENEWED');
    assert.equal(renewalResult.invoiceMarkedPaid, true);
    assert.equal(renewalResult.subscriptionRenewed, true);
    assert.equal(renewalResult.customerStatusUpdated, true);

    // Step 1: Invoice marked PAID & Payment Ledger recorded
    const paidInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    assert.equal(paidInvoice.status, InvoiceStatus.PAID);
    assert.equal(Number(paidInvoice.paidAmount), 942.82);

    const paymentRecord = await prisma.payment.findFirst({ where: { invoiceId: invoice.id } });
    assert.ok(paymentRecord);
    assert.equal(paymentRecord.status, PaymentStatus.SUCCESS);
    assert.equal(paymentRecord.paymentMethod, PaymentMethod.UPI);

    // Step 2: Subscription renewed and extended into future
    const renewedSub = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    assert.equal(renewedSub.status, SubscriptionStatus.ACTIVE);
    assert.ok(new Date(renewedSub.endDate) > new Date(), 'New end date must be in future');

    // Step 3: Customer status updated to ACTIVE
    const renewedCustomer = await prisma.customer.findUnique({ where: { id: rajesh.id } });
    assert.equal(renewedCustomer.status, CustomerStatus.ACTIVE);

    // Step 4: FreeRADIUS credentials restored
    const radCheck = await prisma.radCheck.findFirst({
      where: { username: rajesh.username, attribute: 'Cleartext-Password' },
    });
    assert.equal(radCheck.value, rajesh.pppoePassword, 'FreeRADIUS cleartext password restored');

    const radReply = await prisma.radReply.findFirst({
      where: { username: rajesh.username, attribute: 'Mikrotik-Rate-Limit' },
    });
    assert.equal(radReply.value, '50M/100M', 'FreeRADIUS 100M rate limit restored');

    // Step 5: MikroTik / MockNAS receives CoA reactivation packet
    assert.equal(mockNas.receivedPackets.length, 1);
    const coaReactivate = mockNas.receivedPackets[0];
    assert.equal(coaReactivate.code, RADIUS_COA_CODE.COA_REQUEST);
    assert.equal(coaReactivate.username, rajesh.username);
    assert.equal(coaReactivate.rateLimit, '50M/100M');

    // Step 6: Notification event emitted
    assert.equal(NotificationEmitter.eventHistory.length, 1);
    assert.equal(NotificationEmitter.eventHistory[0].type, NotificationEventType.SUBSCRIPTION_RENEWED);

    console.log(`[CoreTest] Phase 3 Success: Rajesh paid. Subscription renewed. FreeRADIUS & MikroTik 100 Mbps restored.`);
  });

  // -------------------------------------------------------------------------
  // PHASE 4: Full Idempotency Guarantee Checks
  // -------------------------------------------------------------------------
  await t.test('Phase 4: Idempotency Verification Across Entire Lifecycle', async () => {
    // 1. Repeated payment renewal on already paid invoice must cleanly no-op
    const paidInvoice = await prisma.invoice.findFirst({
      where: { customerId: rajesh.id, status: InvoiceStatus.PAID },
    });
    const duplicateRenewal = await executePaymentRenewalAutomation(paidInvoice.id);
    assert.equal(duplicateRenewal.processed, false);
    assert.equal(duplicateRenewal.status, 'ALREADY_PAID');

    // 2. Repeated expiry execution on already expired subscription must cleanly no-op
    const expCust = await prisma.customer.create({
      data: {
        organizationId: org.id,
        customerCode: `EXP-IDEMP-${ts}`,
        name: 'Expired Customer',
        username: `exp_user_${ts}`,
        status: CustomerStatus.EXPIRED,
      },
    });
    const expSub = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        customerId: expCust.id,
        planId: plan50M.id,
        status: SubscriptionStatus.EXPIRED,
        startDate: new Date(Date.now() - 40 * 86400000),
        endDate: new Date(Date.now() - 10 * 86400000),
        price: plan50M.price,
      },
    });

    const duplicateExpiry = await executeSubscriptionExpiryAutomation(expSub.id);
    assert.equal(duplicateExpiry.processed, false);
    assert.equal(duplicateExpiry.status, 'ALREADY_EXPIRED');

    console.log(`[CoreTest] Phase 4 Success: Full idempotency guaranteed for both renewal and expiry.`);
  });

  await mockNas.stop();
});
