import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { PlansService } from '../dist/modules/plans/plans.service.js';
import { SubscriptionsService } from '../dist/modules/subscriptions/subscriptions.service.js';
import {
  SubscriptionStatus,
  CustomerStatus,
  BillingCycle,
  SpeedUnit,
  PlanStatus,
  calculateSubscriptionEndDate,
  calculateGracePeriodEndDate,
  evaluateSubscriptionStatusByDates,
  isLeapYear,
  getDaysInMonth,
} from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';

const authService = new AuthService();
const customersService = new CustomersService();
const plansService = new PlansService();
const subscriptionsService = new SubscriptionsService();

test('Subscriptions: Date Arithmetic (Normal Monthly, Month-End, Leap Year, Grace, Expiry)', async () => {
  // 1. Leap Year Math
  assert.equal(isLeapYear(2024), true, '2024 is a leap year');
  assert.equal(isLeapYear(2028), true, '2028 is a leap year');
  assert.equal(isLeapYear(2000), true, '2000 is a leap year');
  assert.equal(isLeapYear(2025), false, '2025 is not a leap year');
  assert.equal(isLeapYear(2026), false, '2026 is not a leap year');
  assert.equal(isLeapYear(1900), false, '1900 is not a leap year');

  assert.equal(getDaysInMonth(2024, 2), 29, 'Feb 2024 has 29 days');
  assert.equal(getDaysInMonth(2025, 2), 28, 'Feb 2025 has 28 days');
  assert.equal(getDaysInMonth(2024, 4), 30, 'April has 30 days');
  assert.equal(getDaysInMonth(2024, 1), 31, 'January has 31 days');

  // 2. Normal Monthly Subscription (e.g. 15th to 15th next month)
  const normalStart = new Date('2026-03-15T10:00:00.000Z');
  const normalEnd = calculateSubscriptionEndDate(normalStart, BillingCycle.MONTHLY, 30, 'Asia/Kolkata');
  assert.equal(normalEnd.getUTCFullYear(), 2026);
  assert.equal(normalEnd.getUTCMonth(), 3); // 3 = April (0-indexed)
  assert.equal(normalEnd.getUTCDate(), 15);

  // 3. Month-End Clamping Tests
  // A) Jan 31 in non-leap year (2025) -> Feb 28, 2025
  const nonLeapJan31 = new Date('2025-01-31T06:00:00.000Z');
  const nonLeapEnd = calculateSubscriptionEndDate(nonLeapJan31, BillingCycle.MONTHLY, 30, 'Asia/Kolkata');
  assert.equal(nonLeapEnd.getUTCFullYear(), 2025);
  assert.equal(nonLeapEnd.getUTCMonth(), 1); // February
  assert.equal(nonLeapEnd.getUTCDate(), 28, 'Jan 31 non-leap year clamps to Feb 28');

  // B) Aug 31 -> Sep 30
  const aug31 = new Date('2026-08-31T06:00:00.000Z');
  const sepEnd = calculateSubscriptionEndDate(aug31, BillingCycle.MONTHLY, 30, 'Asia/Kolkata');
  assert.equal(sepEnd.getUTCMonth(), 8); // September
  assert.equal(sepEnd.getUTCDate(), 30, 'Aug 31 clamps to Sep 30');

  // C) Mar 31 -> Apr 30
  const mar31 = new Date('2026-03-31T06:00:00.000Z');
  const aprEnd = calculateSubscriptionEndDate(mar31, BillingCycle.MONTHLY, 30, 'Asia/Kolkata');
  assert.equal(aprEnd.getUTCMonth(), 3); // April
  assert.equal(aprEnd.getUTCDate(), 30, 'Mar 31 clamps to Apr 30');

  // 4. Leap Year Tests
  // A) Jan 31 in leap year (2024) -> Feb 29, 2024
  const leapJan31 = new Date('2024-01-31T06:00:00.000Z');
  const leapEnd = calculateSubscriptionEndDate(leapJan31, BillingCycle.MONTHLY, 30, 'Asia/Kolkata');
  assert.equal(leapEnd.getUTCFullYear(), 2024);
  assert.equal(leapEnd.getUTCMonth(), 1); // February
  assert.equal(leapEnd.getUTCDate(), 29, 'Jan 31 leap year clamps to Feb 29');

  // B) Feb 29, 2024 + 1 month -> Mar 29, 2024
  const leapFeb29 = new Date('2024-02-29T06:00:00.000Z');
  const marEnd = calculateSubscriptionEndDate(leapFeb29, BillingCycle.MONTHLY, 30, 'Asia/Kolkata');
  assert.equal(marEnd.getUTCMonth(), 2); // March
  assert.equal(marEnd.getUTCDate(), 29, 'Feb 29 + 1 month yields Mar 29');

  // C) Feb 29, 2024 + 1 year (Annual) -> Feb 28, 2025 (next year is not leap year)
  const annualEnd = calculateSubscriptionEndDate(leapFeb29, BillingCycle.ANNUAL, 365, 'Asia/Kolkata');
  assert.equal(annualEnd.getUTCFullYear(), 2025);
  assert.equal(annualEnd.getUTCMonth(), 1); // February
  assert.equal(annualEnd.getUTCDate(), 28, 'Feb 29 leap year + 1 year clamps to Feb 28 next year');

  // 5. Grace Period & Expiry Evaluation
  const refEnd = new Date('2026-05-01T00:00:00.000Z');
  const graceDays = 3;
  const graceEnd = calculateGracePeriodEndDate(refEnd, graceDays);
  assert.equal(graceEnd.getTime(), refEnd.getTime() + 3 * 24 * 60 * 60 * 1000);

  // Still within active validity
  const activeNow = new Date('2026-04-20T00:00:00.000Z');
  assert.equal(evaluateSubscriptionStatusByDates(refEnd, graceDays, activeNow), 'ACTIVE');

  // After endDate but within grace period (e.g. May 2)
  const graceNow = new Date('2026-05-02T12:00:00.000Z');
  assert.equal(evaluateSubscriptionStatusByDates(refEnd, graceDays, graceNow), 'GRACE');

  // After grace period elapsed (e.g. May 5)
  const expiredNow = new Date('2026-05-05T00:00:00.000Z');
  assert.equal(evaluateSubscriptionStatusByDates(refEnd, graceDays, expiredNow), 'EXPIRED');
});

test('Subscriptions: Full Lifecycle, 9 Operations, FSM Transitions, History Tracking & RADIUS Sync', async () => {
  const ts = Date.now();

  // 1. Setup Tenant Organizations
  const org1Result = await authService.registerOrganization({
    name: `SkyNet ISP ${ts}`,
    slug: `skynet-${ts}`,
    email: `contact@skynet-${ts}.com`,
    phone: '9876500030',
    ownerName: 'SkyNet Admin',
    ownerEmail: `admin.${ts}@skynet.com`,
    ownerPassword: 'Password123!',
  });
  const org1Id = org1Result.user.organizationId;
  const admin1UserId = org1Result.user.id;

  const org2Result = await authService.registerOrganization({
    name: `CableNet ISP ${ts}`,
    slug: `cablenet-${ts}`,
    email: `contact@cablenet-${ts}.com`,
    phone: '9876500040',
    ownerName: 'CableNet Admin',
    ownerEmail: `admin.${ts}@cablenet.com`,
    ownerPassword: 'Password123!',
  });
  const org2Id = org2Result.user.organizationId;

  // 2. Create Plans (Starter 50M, Standard 100M, Ultra 200M)
  const plan50 = await plansService.create(org1Id, admin1UserId, {
    name: 'Fiber 50 Mbps',
    code: `FIBER-50M-${ts}`,
    downloadSpeed: 50,
    uploadSpeed: 20,
    speedUnit: SpeedUnit.MBPS,
    price: 499,
    validityDays: 30,
    billingCycle: BillingCycle.MONTHLY,
    status: PlanStatus.ACTIVE,
  });

  const plan100 = await plansService.create(org1Id, admin1UserId, {
    name: 'Fiber 100 Mbps',
    code: `FIBER-100M-${ts}`,
    downloadSpeed: 100,
    uploadSpeed: 50,
    speedUnit: SpeedUnit.MBPS,
    price: 799,
    validityDays: 30,
    billingCycle: BillingCycle.MONTHLY,
    status: PlanStatus.ACTIVE,
  });

  // 3. Create Customer
  const customer = await customersService.create(org1Id, admin1UserId, {
    customerCode: `CUST-SUB-${ts}`,
    name: 'Rahul Sharma',
    mobile: '9811223344',
    email: `rahul.${ts}@example.com`,
    address: 'B-102, Gokul Dham',
    area: 'Powai',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400076',
    username: `rahul_sharma_${ts}`,
    pppoePassword: 'PppoePassword123!',
    status: CustomerStatus.LEAD,
  });

  // ==========================================
  // OPERATION 1: CREATE (as PENDING)
  // ==========================================
  const pendingSub = await subscriptionsService.create(org1Id, admin1UserId, {
    customerId: customer.id,
    planId: plan50.id,
    status: SubscriptionStatus.PENDING,
    billingCycle: BillingCycle.MONTHLY,
    gracePeriodDays: 3,
  });

  assert.equal(pendingSub.status, SubscriptionStatus.PENDING);
  assert.equal(pendingSub.customerId, customer.id);
  assert.equal(pendingSub.planId, plan50.id);
  assert.equal(Number(pendingSub.price), 499);
  assert.equal(pendingSub.gracePeriodDays, 3);
  assert.equal(pendingSub.billingCycle, BillingCycle.MONTHLY);

  // Verify History for CREATE
  const historyAfterCreate = await subscriptionsService.getHistory(org1Id, pendingSub.id);
  assert.equal(historyAfterCreate.length, 1);
  assert.equal(historyAfterCreate[0].action, 'CREATE');
  assert.equal(historyAfterCreate[0].toStatus, SubscriptionStatus.PENDING);
  assert.equal(historyAfterCreate[0].adminUserId, admin1UserId);

  // ==========================================
  // OPERATION 2: ACTIVATE (PENDING -> ACTIVE)
  // ==========================================
  const activatedSub = await subscriptionsService.activate(org1Id, admin1UserId, pendingSub.id);
  assert.equal(activatedSub.status, SubscriptionStatus.ACTIVE);
  assert.ok(new Date(activatedSub.endDate) > new Date(activatedSub.startDate));

  // Verify Customer status transitioned to ACTIVE
  const activeCustomer = await customersService.getById(org1Id, customer.id);
  assert.equal(activeCustomer.status, CustomerStatus.ACTIVE);

  // Verify FreeRADIUS radreply has active rate-limit
  const radreply = await prisma.radReply.findFirst({
    where: { username: customer.username, attribute: 'Mikrotik-Rate-Limit' },
  });
  assert.ok(radreply, 'FreeRADIUS radreply must be populated on activation');
  assert.equal(radreply.value, '20M/50M');

  // Verify History for ACTIVATE
  const historyAfterActivate = await subscriptionsService.getHistory(org1Id, pendingSub.id);
  assert.equal(historyAfterActivate.length, 2);
  assert.equal(historyAfterActivate[0].action, 'ACTIVATE');
  assert.equal(historyAfterActivate[0].fromStatus, SubscriptionStatus.PENDING);
  assert.equal(historyAfterActivate[0].toStatus, SubscriptionStatus.ACTIVE);

  // ==========================================
  // OPERATION 3: UPGRADE PLAN (50M -> 100M)
  // ==========================================
  const upgradedSub = await subscriptionsService.upgrade(
    org1Id,
    admin1UserId,
    pendingSub.id,
    plan100.id,
    'Customer requested 100M upgrade',
  );
  assert.equal(upgradedSub.planId, plan100.id);
  assert.equal(Number(upgradedSub.price), 799);

  // Verify FreeRADIUS updated with new plan speed
  const upgradedRadReply = await prisma.radReply.findFirst({
    where: { username: customer.username, attribute: 'Mikrotik-Rate-Limit' },
  });
  assert.equal(upgradedRadReply.value, '50M/100M');

  // Verify History for UPGRADE
  const historyAfterUpgrade = await subscriptionsService.getHistory(org1Id, pendingSub.id);
  assert.equal(historyAfterUpgrade[0].action, 'UPGRADE');
  assert.equal(historyAfterUpgrade[0].fromPlanId, plan50.id);
  assert.equal(historyAfterUpgrade[0].toPlanId, plan100.id);

  // ==========================================
  // OPERATION 4: DOWNGRADE PLAN (100M -> 50M)
  // ==========================================
  const downgradedSub = await subscriptionsService.downgrade(
    org1Id,
    admin1UserId,
    pendingSub.id,
    plan50.id,
    'Downgraded back to 50M',
  );
  assert.equal(downgradedSub.planId, plan50.id);
  assert.equal(Number(downgradedSub.price), 499);

  const downgradedRadReply = await prisma.radReply.findFirst({
    where: { username: customer.username, attribute: 'Mikrotik-Rate-Limit' },
  });
  assert.equal(downgradedRadReply.value, '20M/50M');

  const historyAfterDowngrade = await subscriptionsService.getHistory(org1Id, pendingSub.id);
  assert.equal(historyAfterDowngrade[0].action, 'DOWNGRADE');

  // ==========================================
  // OPERATION 5: SUSPEND
  // ==========================================
  const suspendedSub = await subscriptionsService.suspend(
    org1Id,
    admin1UserId,
    pendingSub.id,
    'Payment overdue suspension',
  );
  assert.equal(suspendedSub.status, SubscriptionStatus.SUSPENDED);

  // Customer status should be SUSPENDED
  const suspendedCustomer = await customersService.getById(org1Id, customer.id);
  assert.equal(suspendedCustomer.status, CustomerStatus.SUSPENDED);

  // FreeRADIUS rate limit should be removed
  const suspendedRadReply = await prisma.radReply.findFirst({
    where: { username: customer.username, attribute: 'Mikrotik-Rate-Limit' },
  });
  assert.equal(suspendedRadReply, null, 'Rate limit should be removed on suspension');

  const historyAfterSuspend = await subscriptionsService.getHistory(org1Id, pendingSub.id);
  assert.equal(historyAfterSuspend[0].action, 'SUSPEND');
  assert.equal(historyAfterSuspend[0].toStatus, SubscriptionStatus.SUSPENDED);

  // ==========================================
  // OPERATION 6: REACTIVATE
  // ==========================================
  const reactivatedSub = await subscriptionsService.reactivate(org1Id, admin1UserId, pendingSub.id);
  assert.equal(reactivatedSub.status, SubscriptionStatus.ACTIVE);

  const restoredCustomer = await customersService.getById(org1Id, customer.id);
  assert.equal(restoredCustomer.status, CustomerStatus.ACTIVE);

  const restoredRadReply = await prisma.radReply.findFirst({
    where: { username: customer.username, attribute: 'Mikrotik-Rate-Limit' },
  });
  assert.ok(restoredRadReply, 'Rate limit restored on reactivate');

  const historyAfterReactivate = await subscriptionsService.getHistory(org1Id, pendingSub.id);
  assert.equal(historyAfterReactivate[0].action, 'REACTIVATE');

  // ==========================================
  // OPERATION 7: RENEW
  // ==========================================
  const oldEndDate = new Date(reactivatedSub.endDate);
  const renewedSub = await subscriptionsService.renew(org1Id, admin1UserId, pendingSub.id);
  assert.equal(renewedSub.status, SubscriptionStatus.ACTIVE);
  assert.ok(
    new Date(renewedSub.endDate) > oldEndDate,
    'Renewing active subscription must extend endDate beyond previous endDate',
  );

  const historyAfterRenew = await subscriptionsService.getHistory(org1Id, pendingSub.id);
  assert.equal(historyAfterRenew[0].action, 'RENEW');

  // ==========================================
  // OPERATION 8: EXPIRE
  // ==========================================
  const expiredSub = await subscriptionsService.expire(
    org1Id,
    admin1UserId,
    pendingSub.id,
    'Grace period exhausted',
  );
  assert.equal(expiredSub.status, SubscriptionStatus.EXPIRED);

  const expiredCustomer = await customersService.getById(org1Id, customer.id);
  assert.equal(expiredCustomer.status, CustomerStatus.EXPIRED);

  const historyAfterExpire = await subscriptionsService.getHistory(org1Id, pendingSub.id);
  assert.equal(historyAfterExpire[0].action, 'EXPIRE');

  // ==========================================
  // OPERATION 9: CANCEL (Terminal State)
  // ==========================================
  const cancelledSub = await subscriptionsService.cancel(
    org1Id,
    admin1UserId,
    pendingSub.id,
    'Subscriber relocated outside service area',
  );
  assert.equal(cancelledSub.status, SubscriptionStatus.CANCELLED);

  const historyAfterCancel = await subscriptionsService.getHistory(org1Id, pendingSub.id);
  assert.equal(historyAfterCancel[0].action, 'CANCEL');

  // ==========================================
  // FSM REJECTION: CANNOT TRANSITION OUT OF CANCELLED
  // ==========================================
  await assert.rejects(
    async () => {
      await subscriptionsService.activate(org1Id, admin1UserId, pendingSub.id);
    },
    { message: /terminal state/i },
    'Cannot activate a cancelled subscription',
  );

  await assert.rejects(
    async () => {
      await subscriptionsService.renew(org1Id, admin1UserId, pendingSub.id);
    },
    { message: /terminal state/i },
    'Cannot renew a cancelled subscription',
  );

  await assert.rejects(
    async () => {
      await subscriptionsService.suspend(org1Id, admin1UserId, pendingSub.id);
    },
    { message: /terminal state/i },
    'Cannot suspend a cancelled subscription',
  );

  // ==========================================
  // TENANT ISOLATION
  // ==========================================
  await assert.rejects(
    async () => {
      await subscriptionsService.getById(org2Id, pendingSub.id);
    },
    { message: /not found in your organization/i },
    'Org 2 must not be able to read Org 1 subscription',
  );

  await assert.rejects(
    async () => {
      await subscriptionsService.renew(org2Id, 'admin-2', pendingSub.id);
    },
    { message: /not found in your organization/i },
    'Org 2 must not be able to renew Org 1 subscription',
  );

  console.log('✅ All subscription lifecycle and FSM tests passed successfully!');
});
