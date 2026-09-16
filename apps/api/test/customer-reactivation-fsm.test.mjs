import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { PlansService } from '../dist/modules/plans/plans.service.js';
import { SubscriptionsService } from '../dist/modules/subscriptions/subscriptions.service.js';
import { CustomerStatus, SubscriptionStatus, AuditAction } from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';

const authService = new AuthService();
const customersService = new CustomersService();
const plansService = new PlansService();
const subscriptionsService = new SubscriptionsService();

test('Customer Reactivation & Subscription FSM Enforcement Regression Suite', async (t) => {
  const ts = Date.now();

  // 1. Setup Tenant Organization
  const orgResult = await authService.registerOrganization({
    name: `FSM Test Org ${ts}`,
    slug: `fsm-org-${ts}`,
    email: `contact@fsm-${ts}.com`,
    phone: '9988776622',
    ownerName: 'FSM Owner',
    ownerEmail: `owner.${ts}@fsm.com`,
    ownerPassword: 'Password123!',
  });
  const orgId = orgResult.user.organizationId;
  const adminUserId = orgResult.user.id;

  // Setup Second Tenant for Isolation Testing
  const orgBResult = await authService.registerOrganization({
    name: `FSM Org B ${ts}`,
    slug: `fsm-org-b-${ts}`,
    email: `contact@fsm-b-${ts}.com`,
    phone: '9988776633',
    ownerName: 'FSM Owner B',
    ownerEmail: `owner.b.${ts}@fsm.com`,
    ownerPassword: 'Password123!',
  });
  const orgBId = orgBResult.user.organizationId;

  // Create Standard Plan
  const plan = await plansService.create(orgId, {
    name: 'FSM Fiber 100M',
    code: `FSM100_${ts}`,
    downloadSpeedMbps: 100,
    uploadSpeedMbps: 50,
    validityDays: 30,
    price: 799,
    gstRatePercent: 18.0,
  });

  // =========================================================================
  // SCENARIO 1: SUSPENDED subscription -> Reactivate -> ACTIVE succeeds
  // =========================================================================
  await t.test('1. SUSPENDED subscription -> Reactivate -> ACTIVE succeeds', async () => {
    const custUsername = `fsm_sub1_${ts}`;
    const cust = await customersService.create(orgId, {
      name: 'Rohan Sharma',
      customerCode: `CUST-S1-${ts}`,
      email: `rohan.${ts}@example.com`,
      phone: '9876500001',
      pppoeUsername: custUsername,
      pppoePassword: 'PasswordS1!',
      planId: plan.id,
    });

    const sub = await prisma.subscription.findFirst({ where: { customerId: cust.id } });
    assert.ok(sub);
    assert.equal(sub.status, SubscriptionStatus.ACTIVE);

    // Suspend Customer
    await customersService.suspend(orgId, adminUserId, cust.id);
    const suspendedCust = await prisma.customer.findUnique({ where: { id: cust.id } });
    const suspendedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.equal(suspendedCust.status, CustomerStatus.SUSPENDED);
    assert.equal(suspendedSub.status, SubscriptionStatus.SUSPENDED);

    // Verify radcheck was locked
    const radCheckSuspended = await prisma.radCheck.findFirst({
      where: { username: custUsername, attribute: 'Cleartext-Password' },
    });
    assert.match(radCheckSuspended.value, /^SUSPENDED_/);

    // Reactivate Customer
    const reactivateRes = await customersService.reactivate(orgId, adminUserId, cust.id);
    assert.equal(reactivateRes.customer.status, CustomerStatus.ACTIVE);

    // Verify subscription is ACTIVE
    const reactivatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.equal(reactivatedSub.status, SubscriptionStatus.ACTIVE);

    // Verify subscriptionHistory recorded
    const history = await prisma.subscriptionHistory.findFirst({
      where: { subscriptionId: sub.id, action: 'REACTIVATE' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(history, 'SubscriptionHistory REACTIVATE record must exist');
    assert.equal(history.fromStatus, SubscriptionStatus.SUSPENDED);
    assert.equal(history.toStatus, SubscriptionStatus.ACTIVE);

    // Verify FreeRADIUS radcheck was restored
    const radCheckRestored = await prisma.radCheck.findFirst({
      where: { username: custUsername, attribute: 'Cleartext-Password' },
    });
    assert.equal(radCheckRestored.value, 'PasswordS1!');
  });

  // =========================================================================
  // SCENARIO 2: CANCELLED subscription -> Reactivate must be REJECTED
  // =========================================================================
  await t.test('2. CANCELLED subscription -> Reactivate is rejected and never resurrected', async () => {
    const custUsername = `fsm_sub2_${ts}`;
    const cust = await customersService.create(orgId, {
      name: 'Anjali Verma',
      customerCode: `CUST-S2-${ts}`,
      email: `anjali.${ts}@example.com`,
      phone: '9876500002',
      pppoeUsername: custUsername,
      pppoePassword: 'PasswordS2!',
      planId: plan.id,
    });

    const sub = await prisma.subscription.findFirst({ where: { customerId: cust.id } });
    assert.ok(sub);

    // Cancel Subscription via subscriptionsService
    await subscriptionsService.cancel(orgId, adminUserId, sub.id, 'Subscriber disconnected service');
    const cancelledSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.equal(cancelledSub.status, SubscriptionStatus.CANCELLED);

    // Set customer status to SUSPENDED or EXPIRED to test reactivation attempt
    await prisma.customer.update({
      where: { id: cust.id },
      data: { status: CustomerStatus.SUSPENDED },
    });

    // Attempt Reactivate: MUST THROW BadRequestException
    await assert.rejects(
      async () => {
        await customersService.reactivate(orgId, adminUserId, cust.id);
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /CANCELLED \(terminal state\)/i);
        return true;
      },
      'Reactivating customer with CANCELLED subscription must be rejected with 400 Bad Request',
    );

    // Also attempt updateStatus(..., ACTIVE): MUST THROW BadRequestException
    await assert.rejects(
      async () => {
        await customersService.updateStatus(orgId, adminUserId, cust.id, CustomerStatus.ACTIVE);
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /CANCELLED/i);
        return true;
      },
    );

    // Verify subscription REMAINS CANCELLED
    const subAfter = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.equal(subAfter.status, SubscriptionStatus.CANCELLED);

    // Verify customer status REMAINS SUSPENDED (not resurrected)
    const custAfter = await prisma.customer.findUnique({ where: { id: cust.id } });
    assert.equal(custAfter.status, CustomerStatus.SUSPENDED);

    // Verify FreeRADIUS radcheck does NOT have active valid credentials
    const radCheckAfter = await prisma.radCheck.findFirst({
      where: { username: custUsername, attribute: 'Cleartext-Password' },
    });
    assert.ok(
      !radCheckAfter ||
      radCheckAfter.value.startsWith('DISABLED_') ||
      radCheckAfter.value.startsWith('SUSPENDED_') ||
      radCheckAfter.value.startsWith('CANCELLED_'),
      'radcheck must remain disabled/suspended'
    );
    if (radCheckAfter) {
      assert.notEqual(radCheckAfter.value, 'PasswordS2!', 'Password must NOT be restored to active password');
    }
  });

  // =========================================================================
  // SCENARIO 3: EXPIRED subscription -> Reactivate must be REJECTED
  // =========================================================================
  await t.test('3. EXPIRED subscription -> Reactivate is rejected (requires renewal)', async () => {
    const custUsername = `fsm_sub3_${ts}`;
    const cust = await customersService.create(orgId, {
      name: 'Vikram Singh',
      customerCode: `CUST-S3-${ts}`,
      email: `vikram.${ts}@example.com`,
      phone: '9876500003',
      pppoeUsername: custUsername,
      pppoePassword: 'PasswordS3!',
      planId: plan.id,
    });

    const sub = await prisma.subscription.findFirst({ where: { customerId: cust.id } });
    assert.ok(sub);

    // Force subscription and customer to EXPIRED
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubscriptionStatus.EXPIRED,
        endDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      },
    });
    await prisma.customer.update({
      where: { id: cust.id },
      data: { status: CustomerStatus.EXPIRED },
    });

    // Attempt Reactivate: MUST THROW BadRequestException requiring renewal
    await assert.rejects(
      async () => {
        await customersService.reactivate(orgId, adminUserId, cust.id);
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /EXPIRED/i);
        return true;
      },
    );

    // Verify subscription remains EXPIRED
    const subAfter = await prisma.subscription.findUnique({ where: { id: sub.id } });
    assert.equal(subAfter.status, SubscriptionStatus.EXPIRED);
  });

  // =========================================================================
  // SCENARIO 4: Suspended subscription expired past grace period
  // =========================================================================
  await t.test('4. SUSPENDED subscription past grace period cannot be reactivated directly', async () => {
    const custUsername = `fsm_sub4_${ts}`;
    const cust = await customersService.create(orgId, {
      name: 'Pooja Nair',
      customerCode: `CUST-S4-${ts}`,
      email: `pooja.${ts}@example.com`,
      phone: '9876500004',
      pppoeUsername: custUsername,
      pppoePassword: 'PasswordS4!',
      planId: plan.id,
    });

    const sub = await prisma.subscription.findFirst({ where: { customerId: cust.id } });

    // Mark suspended with past end date beyond grace period (e.g. 15 days ago)
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubscriptionStatus.SUSPENDED,
        endDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        gracePeriodDays: 3,
      },
    });
    await prisma.customer.update({
      where: { id: cust.id },
      data: { status: CustomerStatus.SUSPENDED },
    });

    // Reactivate attempt must fail because validity + grace period expired
    await assert.rejects(
      async () => {
        await customersService.reactivate(orgId, adminUserId, cust.id);
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /validity and grace period have expired/i);
        return true;
      },
    );
  });

  // =========================================================================
  // SCENARIO 5: Multiple subscriptions handling
  // =========================================================================
  await t.test('5. Multiple subscriptions: older CANCELLED + newer SUSPENDED reactivates newer only', async () => {
    const custUsername = `fsm_sub5_${ts}`;
    const cust = await customersService.create(orgId, {
      name: 'Karan Mehra',
      customerCode: `CUST-S5-${ts}`,
      email: `karan.${ts}@example.com`,
      phone: '9876500005',
      pppoeUsername: custUsername,
      pppoePassword: 'PasswordS5!',
      planId: plan.id,
    });

    const oldSub = await prisma.subscription.findFirst({ where: { customerId: cust.id } });

    // Cancel old subscription
    await prisma.subscription.update({
      where: { id: oldSub.id },
      data: { status: SubscriptionStatus.CANCELLED, createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    });

    // Create a newer suspended subscription (valid end date in future)
    const newSub = await prisma.subscription.create({
      data: {
        organizationId: orgId,
        customerId: cust.id,
        planId: plan.id,
        status: SubscriptionStatus.SUSPENDED,
        startDate: new Date(),
        endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        price: 799,
        createdAt: new Date(),
      },
    });

    await prisma.customer.update({
      where: { id: cust.id },
      data: { status: CustomerStatus.SUSPENDED },
    });

    // Reactivate: should reactivate newSub and NOT touch oldSub
    const res = await customersService.reactivate(orgId, adminUserId, cust.id);
    assert.equal(res.customer.status, CustomerStatus.ACTIVE);

    // newSub must be ACTIVE
    const newSubAfter = await prisma.subscription.findUnique({ where: { id: newSub.id } });
    assert.equal(newSubAfter.status, SubscriptionStatus.ACTIVE);

    // oldSub must STILL be CANCELLED
    const oldSubAfter = await prisma.subscription.findUnique({ where: { id: oldSub.id } });
    assert.equal(oldSubAfter.status, SubscriptionStatus.CANCELLED);
  });

  await t.test('5b. Multiple subscriptions: older SUSPENDED + newer CANCELLED is rejected', async () => {
    const custUsername = `fsm_sub5b_${ts}`;
    const cust = await customersService.create(orgId, {
      name: 'Sunita Mehra',
      customerCode: `CUST-S5B-${ts}`,
      email: `sunita.${ts}@example.com`,
      phone: '9876500006',
      pppoeUsername: custUsername,
      pppoePassword: 'PasswordS5B!',
      planId: plan.id,
    });

    const oldSub = await prisma.subscription.findFirst({ where: { customerId: cust.id } });
    await prisma.subscription.update({
      where: { id: oldSub.id },
      data: { status: SubscriptionStatus.SUSPENDED, createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });

    // Newer subscription is CANCELLED
    const newCancelledSub = await prisma.subscription.create({
      data: {
        organizationId: orgId,
        customerId: cust.id,
        planId: plan.id,
        status: SubscriptionStatus.CANCELLED,
        startDate: new Date(),
        endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        price: 799,
        createdAt: new Date(),
      },
    });

    await prisma.customer.update({
      where: { id: cust.id },
      data: { status: CustomerStatus.SUSPENDED },
    });

    // Reactivation must be rejected because the current/latest subscription is CANCELLED
    await assert.rejects(
      async () => {
        await customersService.reactivate(orgId, adminUserId, cust.id);
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /CANCELLED/i);
        return true;
      },
    );

    // Old sub remains SUSPENDED
    const oldSubAfter = await prisma.subscription.findUnique({ where: { id: oldSub.id } });
    assert.equal(oldSubAfter.status, SubscriptionStatus.SUSPENDED);

    // New sub remains CANCELLED
    const newSubAfter = await prisma.subscription.findUnique({ where: { id: newCancelledSub.id } });
    assert.equal(newSubAfter.status, SubscriptionStatus.CANCELLED);
  });

  // =========================================================================
  // SCENARIO 6: Tenant Isolation
  // =========================================================================
  await t.test('6. Tenant Isolation: Org B cannot reactivate Org A customer', async () => {
    const custUsername = `fsm_sub6_${ts}`;
    const cust = await customersService.create(orgId, {
      name: 'Tenant Iso Cust',
      customerCode: `CUST-S6-${ts}`,
      email: `iso.${ts}@example.com`,
      phone: '9876500007',
      pppoeUsername: custUsername,
      pppoePassword: 'PasswordS6!',
      planId: plan.id,
    });

    await customersService.suspend(orgId, adminUserId, cust.id);

    // Org B attempts reactivate -> Must fail with NotFoundException (404)
    await assert.rejects(
      async () => {
        await customersService.reactivate(orgBId, orgBResult.user.id, cust.id);
      },
      (err) => {
        assert.equal(err.status, 404);
        return true;
      },
    );
  });

  // =========================================================================
  // SCENARIO 7: Audit log and RADIUS state correctness
  // =========================================================================
  await t.test('7. Audit log & RADIUS state correctness on rejection vs success', async () => {
    const custUsername = `fsm_sub7_${ts}`;
    const cust = await customersService.create(orgId, {
      name: 'Audit Check Cust',
      customerCode: `CUST-S7-${ts}`,
      email: `audit.${ts}@example.com`,
      phone: '9876500008',
      pppoeUsername: custUsername,
      pppoePassword: 'PasswordS7!',
      planId: plan.id,
    });

    const sub = await prisma.subscription.findFirst({ where: { customerId: cust.id } });

    // Cancel subscription
    await subscriptionsService.cancel(orgId, adminUserId, sub.id, 'Cancelled for audit test');

    const auditCountBefore = await prisma.auditLog.count({
      where: { entityId: cust.id },
    });

    // Try to reactivate -> rejected
    try {
      await customersService.reactivate(orgId, adminUserId, cust.id);
    } catch {}

    const auditCountAfterReject = await prisma.auditLog.count({
      where: { entityId: cust.id },
    });
    // No audit log must be added for the rejected attempt
    assert.equal(auditCountAfterReject, auditCountBefore, 'No STATUS_CHANGE audit log on rejected reactivation');

    // Customer status remains whatever it was
    const custUnchanged = await prisma.customer.findUnique({ where: { id: cust.id } });
    assert.notEqual(custUnchanged.status, CustomerStatus.ACTIVE);
  });

  // =========================================================================
  // SCENARIO 8: Customer without subscriptions
  // =========================================================================
  await t.test('8. Customer with no subscription can transition LEAD -> ACTIVE without error', async () => {
    const cust = await customersService.create(orgId, {
      name: 'Lead Customer No Sub',
      customerCode: `CUST-S8-${ts}`,
      email: `lead.${ts}@example.com`,
      phone: '9876500009',
      username: `lead_sub_${ts}`,
      pppoePassword: 'PasswordS8!',
      status: CustomerStatus.LEAD,
    });

    // Transition to ACTIVE (e.g. before plan is assigned)
    const res = await customersService.updateStatus(orgId, adminUserId, cust.id, CustomerStatus.ACTIVE);
    assert.equal(res.customer.status, CustomerStatus.ACTIVE);
  });
});
