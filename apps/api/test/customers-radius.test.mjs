import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { PlansService } from '../dist/modules/plans/plans.service.js';
import { SubscriptionsService } from '../dist/modules/subscriptions/subscriptions.service.js';
import { CustomerStatus, SubscriptionStatus } from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';

const authService = new AuthService();
const customersService = new CustomersService();
const plansService = new PlansService();
const subscriptionsService = new SubscriptionsService();

test('Subscriber & FreeRADIUS Lifecycle Orchestration', async (t) => {
  const ts = Date.now();

  // 1. Setup Tenant Organization
  const orgResult = await authService.registerOrganization({
    name: `Apex Broadband ${ts}`,
    slug: `apex-${ts}`,
    email: `contact@apex-${ts}.com`,
    phone: '9988776611',
    ownerName: 'Apex Owner',
    ownerEmail: `owner.${ts}@apex.com`,
    ownerPassword: 'Password123!',
  });
  const orgId = orgResult.user.organizationId;

  // 2. Create Internet Plans (Standard + Burst)
  const standardPlan = await plansService.create(orgId, {
    name: 'Fiber 50 Mbps',
    code: `FIBER50_${ts}`,
    downloadSpeedMbps: 50,
    uploadSpeedMbps: 20,
    validityDays: 30,
    price: 699,
    gstRatePercent: 18.0,
  });
  assert.equal(standardPlan.rateLimitString, '20M/50M');

  const burstPlan = await plansService.create(orgId, {
    name: 'Fiber 100 Burst',
    code: `FIBER100B_${ts}`,
    downloadSpeedMbps: 100,
    uploadSpeedMbps: 50,
    validityDays: 30,
    price: 999,
    burstDownloadMbps: 150,
    burstUploadMbps: 80,
    burstThresholdMbps: 75,
    burstTimeSecs: 10,
  });
  assert.equal(burstPlan.rateLimitString, '50M/100M 80M/150M 75M/75M 10/10 8');

  // 3. Create Customer with Plan & Static IP
  const pppoeUser = `apex_sub_${ts}`;
  const pppoePass = 'secretPppoePass1!';
  const staticIp = '100.64.10.45';

  const customer = await customersService.create(orgId, {
    name: 'Sunil Sharma',
    customerCode: `CUST-SHARMA-${ts}`,
    email: `sunil.${ts}@gmail.com`,
    phone: '9876543210',
    installationAddress: 'Flat 402, Green Valley Apartments, Pune',
    pppoeUsername: pppoeUser,
    pppoePassword: pppoePass,
    staticIp,
    planId: standardPlan.id,
  });

  assert.equal(customer.organizationId, orgId);
  assert.equal(customer.status, CustomerStatus.ACTIVE);

  // 3.1 Verify Subscription created automatically
  const subs = await prisma.subscription.findMany({
    where: { customerId: customer.id },
  });
  assert.equal(subs.length, 1);
  assert.equal(subs[0].planId, standardPlan.id);
  assert.equal(subs[0].status, SubscriptionStatus.ACTIVE);

  // 3.2 Verify FreeRADIUS radcheck created
  const radCheck = await prisma.radCheck.findFirst({
    where: { username: pppoeUser, attribute: 'Cleartext-Password' },
  });
  assert.ok(radCheck, 'radcheck record must exist');
  assert.equal(radCheck.value, pppoePass);
  assert.equal(radCheck.op, ':=');

  // 3.3 Verify FreeRADIUS radreply rate limit and static IP created
  const radReplyRate = await prisma.radReply.findFirst({
    where: { username: pppoeUser, attribute: 'Mikrotik-Rate-Limit' },
  });
  assert.ok(radReplyRate, 'radreply rate limit record must exist');
  assert.equal(radReplyRate.value, '20M/50M');

  const radReplyIp = await prisma.radReply.findFirst({
    where: { username: pppoeUser, attribute: 'Framed-IP-Address' },
  });
  assert.ok(radReplyIp, 'radreply framed IP record must exist');
  assert.equal(radReplyIp.value, staticIp);

  // 4. Suspend Subscriber
  const suspendRes = await customersService.suspend(orgId, customer.id);
  assert.equal(suspendRes.customer.status, CustomerStatus.SUSPENDED);

  // Verify radcheck is updated to invalidate authentication
  const radCheckSuspended = await prisma.radCheck.findFirst({
    where: { username: pppoeUser, attribute: 'Cleartext-Password' },
  });
  assert.match(radCheckSuspended.value, /^SUSPENDED_/, 'radcheck must reject login');

  // Verify subscription is SUSPENDED
  const subSuspended = await prisma.subscription.findUnique({
    where: { id: subs[0].id },
  });
  assert.equal(subSuspended.status, SubscriptionStatus.SUSPENDED);

  // 5. Reactivate Subscriber
  const reactivateRes = await customersService.reactivate(orgId, customer.id);
  assert.equal(reactivateRes.customer.status, CustomerStatus.ACTIVE);

  // Verify radcheck restored
  const radCheckRestored = await prisma.radCheck.findFirst({
    where: { username: pppoeUser, attribute: 'Cleartext-Password' },
  });
  assert.equal(radCheckRestored.value, pppoePass);

  // Verify subscription restored
  const subRestored = await prisma.subscription.findUnique({
    where: { id: subs[0].id },
  });
  assert.equal(subRestored.status, SubscriptionStatus.ACTIVE);

  // Verify radreply restored on reactivation
  const radReplyRestoredIp = await prisma.radReply.findFirst({
    where: { username: pppoeUser, attribute: 'Framed-IP-Address' },
  });
  assert.ok(radReplyRestoredIp, 'radreply framed IP record must exist after reactivation');
  assert.equal(radReplyRestoredIp.value, staticIp);

  const radReplyRestoredRate = await prisma.radReply.findFirst({
    where: { username: pppoeUser, attribute: 'Mikrotik-Rate-Limit' },
  });
  assert.ok(radReplyRestoredRate, 'radreply rate limit record must exist after reactivation');
  assert.equal(radReplyRestoredRate.value, standardPlan.rateLimitString);

  // 6. Subscription Renewal
  const oldEndDate = subRestored.endDate;
  const renewedSub = await subscriptionsService.renew(orgId, subs[0].id);
  assert.ok(renewedSub.endDate > oldEndDate, 'End date must be extended');

  // 7. Upgrade / Change Plan
  const changedSub = await subscriptionsService.changePlan(orgId, subs[0].id, burstPlan.id);
  assert.equal(changedSub.planId, burstPlan.id);

  // Verify FreeRADIUS radreply updated with new rate limit string
  const radReplyUpdated = await prisma.radReply.findFirst({
    where: { username: pppoeUser, attribute: 'Mikrotik-Rate-Limit' },
  });
  assert.equal(radReplyUpdated.value, burstPlan.rateLimitString);

  // 8. Disconnect Endpoint
  const disconnectRes = await customersService.disconnect(orgId, customer.id);
  assert.equal(disconnectRes.status, 'DISPATCHED');
  assert.equal(disconnectRes.pppoeUsername, `${pppoeUser}@ispcrm`);

  // 9. Phase 9J Focused Regression Test: Dynamic Pool Customer Reactivation & Password Preservation
  const poolUser = `apex_pool_${ts}`;
  const poolPass = 'securePoolPass9J!';

  const poolCustomer = await customersService.create(orgId, {
    name: 'Ramesh Patel',
    customerCode: `CUST-PATEL-${ts}`,
    email: `ramesh.${ts}@gmail.com`,
    phone: '9876543211',
    installationAddress: 'Shop 12, Market Yard, Pune',
    pppoeUsername: poolUser,
    pppoePassword: poolPass,
    planId: standardPlan.id,
  });

  const dbCustomerCreated = await prisma.customer.findUnique({ where: { id: poolCustomer.id } });
  assert.equal(dbCustomerCreated.pppoePassword, poolPass);

  // 9.1 Verify initial Framed-Pool = pppoe in radreply
  const initialPool = await prisma.radReply.findFirst({
    where: { username: poolUser, attribute: 'Framed-Pool' },
  });
  assert.ok(initialPool, 'Dynamic customer must have Framed-Pool');
  assert.equal(initialPool.value, 'pppoe');

  // 9.2 Test Defect 1: Update customer with empty pppoePassword: "" must NOT overwrite persisted password
  await customersService.update(orgId, undefined, poolCustomer.id, {
    address: 'Updated Address 456',
    pppoePassword: '', // empty string from "leave blank to keep current"
  });
  const dbCustomerAfterUpdate = await prisma.customer.findUnique({ where: { id: poolCustomer.id } });
  assert.equal(dbCustomerAfterUpdate.pppoePassword, poolPass, 'Empty password update must not overwrite persisted password');

  // 9.3 Suspend customer
  await customersService.suspend(orgId, poolCustomer.id);
  const poolCheckSuspended = await prisma.radCheck.findFirst({
    where: { username: poolUser, attribute: 'Cleartext-Password' },
  });
  assert.match(poolCheckSuspended.value, /^SUSPENDED_/);

  // 9.4 Test Defect 2: Reactivate customer must restore Framed-Pool = pppoe and original pppoePassword
  const poolReactivateRes = await customersService.reactivate(orgId, poolCustomer.id);
  assert.equal(poolReactivateRes.customer.status, CustomerStatus.ACTIVE);

  const poolCheckRestored = await prisma.radCheck.findFirst({
    where: { username: poolUser, attribute: 'Cleartext-Password' },
  });
  assert.equal(poolCheckRestored.value, poolPass, 'Reactivation must restore persisted pppoe password');

  const poolReplyRestored = await prisma.radReply.findFirst({
    where: { username: poolUser, attribute: 'Framed-Pool' },
  });
  assert.ok(poolReplyRestored, 'Reactivation must restore Framed-Pool attribute');
  assert.equal(poolReplyRestored.value, 'pppoe');

  const poolRateRestored = await prisma.radReply.findFirst({
    where: { username: poolUser, attribute: 'Mikrotik-Rate-Limit' },
  });
  assert.ok(poolRateRestored, 'Reactivation must restore Mikrotik-Rate-Limit');
  assert.equal(poolRateRestored.value, standardPlan.rateLimitString);
});
