import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { PlansService } from '../dist/modules/plans/plans.service.js';
import {
  PlanStatus,
  BillingCycle,
  SpeedUnit,
  AuditAction,
  buildNetworkPolicyFromPlan,
  translateNetworkPolicyToRadius,
} from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';

const authService = new AuthService();
const plansService = new PlansService();

test('Internet Plans: Full Lifecycle, 9 Fields, Network Policy Object, Radius Translation, Multi-Tenancy & Audit Logs', async (t) => {
  const ts = Date.now();

  // 1. Setup Tenant Organizations
  const org1Result = await authService.registerOrganization({
    name: `AirFiber ISP ${ts}`,
    slug: `airfiber-${ts}`,
    email: `contact@airfiber-${ts}.com`,
    phone: '9876500010',
    ownerName: 'AirFiber Admin',
    ownerEmail: `admin.${ts}@airfiber.com`,
    ownerPassword: 'Password123!',
  });
  const org1Id = org1Result.user.organizationId;
  const admin1UserId = org1Result.user.id;

  const org2Result = await authService.registerOrganization({
    name: `MetroNet ISP ${ts}`,
    slug: `metronet-${ts}`,
    email: `contact@metronet-${ts}.com`,
    phone: '9876500020',
    ownerName: 'MetroNet Admin',
    ownerEmail: `admin.${ts}@metronet.com`,
    ownerPassword: 'Password123!',
  });
  const org2Id = org2Result.user.organizationId;

  // 2. Test the 3 required example plans:
  // - 50 Mbps - ₹499
  // - 100 Mbps - ₹799
  // - 200 Mbps - ₹999
  const plan50Data = {
    name: 'Fiber Starter 50M',
    code: `STARTER-50M-${ts}`,
    description: 'Entry-level fiber internet plan for home browsing and streaming',
    downloadSpeed: 50,
    uploadSpeed: 20,
    speedUnit: SpeedUnit.MBPS,
    price: 499,
    validityDays: 30,
    billingCycle: BillingCycle.MONTHLY,
    status: PlanStatus.ACTIVE,
  };

  const plan100Data = {
    name: 'Fiber Standard 100M',
    code: `STD-100M-${ts}`,
    description: 'High-speed fiber connection for streaming 4K and work-from-home',
    downloadSpeed: 100,
    uploadSpeed: 50,
    speedUnit: SpeedUnit.MBPS,
    price: 799,
    validityDays: 30,
    billingCycle: BillingCycle.MONTHLY,
    status: PlanStatus.ACTIVE,
  };

  const plan200Data = {
    name: 'Fiber Ultra 200M',
    code: `ULTRA-200M-${ts}`,
    description: 'Ultra high-speed plan for heavy gaming and multiple users',
    downloadSpeed: 200,
    uploadSpeed: 100,
    speedUnit: SpeedUnit.MBPS,
    price: 999,
    validityDays: 30,
    billingCycle: BillingCycle.MONTHLY,
    status: PlanStatus.ACTIVE,
  };

  const plan50 = await plansService.create(org1Id, admin1UserId, plan50Data);
  const plan100 = await plansService.create(org1Id, admin1UserId, plan100Data);
  const plan200 = await plansService.create(org1Id, admin1UserId, plan200Data);

  // Assert 9 fields on created plan 50 Mbps
  assert.equal(plan50.name, 'Fiber Starter 50M');
  assert.equal(plan50.description, plan50Data.description);
  assert.equal(plan50.downloadSpeed, 50);
  assert.equal(plan50.uploadSpeed, 20);
  assert.equal(plan50.speedUnit, SpeedUnit.MBPS);
  assert.equal(plan50.price, 499);
  assert.equal(plan50.validityDays, 30);
  assert.equal(plan50.billingCycle, BillingCycle.MONTHLY);
  assert.equal(plan50.status, PlanStatus.ACTIVE);
  assert.equal(plan50.organizationId, org1Id);

  // Assert plan 100 Mbps
  assert.equal(plan100.price, 799);
  assert.equal(plan100.downloadSpeed, 100);

  // Assert plan 200 Mbps
  assert.equal(plan200.price, 999);
  assert.equal(plan200.downloadSpeed, 200);

  // Verify Audit Log for CREATE
  const createAudit = await prisma.auditLog.findFirst({
    where: {
      organizationId: org1Id,
      entityType: 'INTERNET_PLAN',
      entityId: plan50.id,
      action: AuditAction.CREATE,
    },
  });
  assert.ok(createAudit, 'CREATE audit log must be recorded');
  assert.equal(createAudit.adminUserId, admin1UserId);
  assert.equal(createAudit.details.name, 'Fiber Starter 50M');
  assert.equal(createAudit.details.price, 499);

  // 3. Test Vendor-Neutral Network Policy Object & RADIUS Translation
  assert.ok(plan50.networkPolicy, 'Plan must contain vendor-neutral network policy object');
  assert.equal(plan50.networkPolicy.rateLimit.downloadSpeed, 50);
  assert.equal(plan50.networkPolicy.rateLimit.uploadSpeed, 20);
  assert.equal(plan50.networkPolicy.rateLimit.unit, SpeedUnit.MBPS);
  assert.equal(plan50.networkPolicy.rateLimit.downloadSpeedBps, 50 * 1000 * 1000);
  assert.equal(plan50.networkPolicy.rateLimit.uploadSpeedBps, 20 * 1000 * 1000);
  assert.equal(plan50.networkPolicy.qosPriority, 8);

  // Test RADIUS attributes translation
  assert.ok(plan50.radiusAttributes, 'Plan must contain compiled RADIUS attributes');
  assert.equal(plan50.radiusAttributes['Mikrotik-Rate-Limit'], '20M/50M');
  assert.equal(plan50.radiusAttributes['WISPr-Bandwidth-Max-Down'], 50000000);
  assert.equal(plan50.radiusAttributes['WISPr-Bandwidth-Max-Up'], 20000000);

  // Test burst policy translation
  const burstPlan = await plansService.create(org1Id, admin1UserId, {
    name: 'Burst Turbo 100M',
    code: `BURST-100M-${ts}`,
    description: 'Turbo boosted plan with 150M initial burst',
    downloadSpeed: 100,
    uploadSpeed: 50,
    speedUnit: SpeedUnit.MBPS,
    price: 1199,
    validityDays: 30,
    billingCycle: BillingCycle.MONTHLY,
    status: PlanStatus.ACTIVE,
    burstDownloadMbps: 150,
    burstUploadMbps: 75,
    burstThresholdMbps: 80,
    burstTimeSecs: 30,
  });

  assert.equal(burstPlan.radiusAttributes['Mikrotik-Rate-Limit'], '50M/100M 75M/150M 80M/80M 30/30 8');

  // 4. Test Edit Plan (Update)
  const updatedPlan = await plansService.update(org1Id, admin1UserId, plan50.id, {
    name: 'Fiber Starter 50M (Monsoon Promo)',
    price: 449,
    description: 'Discounted fiber plan for new residential subscribers',
    validityDays: 45,
  });

  assert.equal(updatedPlan.name, 'Fiber Starter 50M (Monsoon Promo)');
  assert.equal(updatedPlan.price, 449);
  assert.equal(updatedPlan.validityDays, 45);

  const updateAudit = await prisma.auditLog.findFirst({
    where: {
      organizationId: org1Id,
      entityType: 'INTERNET_PLAN',
      entityId: plan50.id,
      action: AuditAction.UPDATE,
    },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(updateAudit, 'UPDATE audit log must be recorded');
  assert.equal(updateAudit.details.after.price, 449);

  // 5. Test Activate / Deactivate Plan
  // Deactivate
  const deactivatedRes = await plansService.toggleStatus(org1Id, admin1UserId, plan50.id, PlanStatus.INACTIVE);
  assert.equal(deactivatedRes.plan.status, PlanStatus.INACTIVE);
  assert.equal(deactivatedRes.plan.isActive, false);

  const deactivateAudit = await prisma.auditLog.findFirst({
    where: {
      organizationId: org1Id,
      entityType: 'INTERNET_PLAN',
      entityId: plan50.id,
      action: AuditAction.STATUS_CHANGE,
    },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(deactivateAudit, 'STATUS_CHANGE audit log must be recorded');
  assert.equal(deactivateAudit.details.oldStatus, PlanStatus.ACTIVE);
  assert.equal(deactivateAudit.details.newStatus, PlanStatus.INACTIVE);

  // Activate (using shortcut toggle)
  const reactivatedRes = await plansService.toggleStatus(org1Id, admin1UserId, plan50.id);
  assert.equal(reactivatedRes.plan.status, PlanStatus.ACTIVE);
  assert.equal(reactivatedRes.plan.isActive, true);

  // 6. Test Plan List with Status Filtering and Search
  const activePlans = await plansService.list(org1Id, { status: PlanStatus.ACTIVE });
  assert.ok(activePlans.length >= 3, 'Should list active plans');
  assert.ok(activePlans.every((p) => p.status === PlanStatus.ACTIVE));

  // Filter by search query
  const searchResults = await plansService.list(org1Id, { search: 'Turbo' });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].name, 'Burst Turbo 100M');

  // 7. Test Multi-Tenant Scoping & Tenant Isolation
  const org2Plans = await plansService.list(org2Id);
  assert.equal(org2Plans.length, 0, 'Org 2 should have no plans initially');

  // Org 2 cannot read Org 1 plan
  await assert.rejects(
    async () => {
      await plansService.getById(org2Id, plan50.id);
    },
    { message: /not found in your organization/i },
    'Org 2 must not be able to read Org 1 plan',
  );

  // Org 2 cannot update Org 1 plan
  await assert.rejects(
    async () => {
      await plansService.update(org2Id, 'admin-2', plan50.id, { price: 100 });
    },
    { message: /not found in your organization/i },
    'Org 2 must not be able to update Org 1 plan',
  );

  // Org 2 cannot toggle Org 1 plan
  await assert.rejects(
    async () => {
      await plansService.toggleStatus(org2Id, 'admin-2', plan50.id);
    },
    { message: /not found in your organization/i },
    'Org 2 must not be able to toggle Org 1 plan',
  );

  console.log('✅ All Internet Plan tests passed successfully!');
});
