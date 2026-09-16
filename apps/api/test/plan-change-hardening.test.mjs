import test from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { PlansService } from '../dist/modules/plans/plans.service.js';
import { SubscriptionsService } from '../dist/modules/subscriptions/subscriptions.service.js';
import { SubscriptionsController } from '../dist/modules/subscriptions/subscriptions.controller.js';
import { UserRole, AuditAction, InvoiceSource, getRadiusUsernameCandidates } from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';

const authService = new AuthService();
const customersService = new CustomersService();
const plansService = new PlansService();
const subscriptionsService = new SubscriptionsService();

test('Plan Change Hardening Regression Suite (AuditLog, RADIUS Realm, RBAC)', async (t) => {
  const ts = Date.now();

  // 1. Setup Tenant Organization A
  const orgResultA = await authService.registerOrganization({
    name: `Hardening Org A ${ts}`,
    slug: `harden-org-a-${ts}`,
    email: `contact.a.${ts}@harden.com`,
    phone: '9988112233',
    ownerName: 'Owner A',
    ownerEmail: `owner.a.${ts}@harden.com`,
    ownerPassword: 'Password123!',
  });
  const orgAId = orgResultA.user.organizationId;
  const adminAUserId = orgResultA.user.id;

  // 2. Setup Tenant Organization B (for isolation checks)
  const orgResultB = await authService.registerOrganization({
    name: `Hardening Org B ${ts}`,
    slug: `harden-org-b-${ts}`,
    email: `contact.b.${ts}@harden.com`,
    phone: '9988112244',
    ownerName: 'Owner B',
    ownerEmail: `owner.b.${ts}@harden.com`,
    ownerPassword: 'Password123!',
  });
  const orgBId = orgResultB.user.organizationId;

  // 3. Create Plans in Org A
  const plan50M = await plansService.create(orgAId, {
    name: 'Starter 50M',
    code: `PLAN50_${ts}`,
    downloadSpeedMbps: 50,
    uploadSpeedMbps: 25,
    validityDays: 30,
    price: 499,
    gstRatePercent: 18.0,
  });

  const plan100M = await plansService.create(orgAId, {
    name: 'Turbo 100M',
    code: `PLAN100_${ts}`,
    downloadSpeedMbps: 100,
    uploadSpeedMbps: 50,
    validityDays: 30,
    price: 799,
    gstRatePercent: 18.0,
  });

  // 4. Create Customer in Org A with realm-qualified username
  const custUsername = `vikram_${ts}@ispcrm`;
  const customer = await customersService.create(orgAId, {
    name: 'Vikram Malhotra',
    customerCode: `CUST-VM-${ts}`,
    email: `vikram.${ts}@example.com`,
    phone: '9876543210',
    pppoeUsername: custUsername,
    pppoePassword: 'SecretPppoePassword99!',
    planId: plan50M.id,
  });

  const sub = await prisma.subscription.findFirst({
    where: { customerId: customer.id, organizationId: orgAId },
  });
  assert.ok(sub, 'Subscription must exist');

  const candidates = getRadiusUsernameCandidates(custUsername);
  assert.equal(candidates.length, 2, 'Must produce 2 candidate usernames');
  assert.ok(candidates.includes(`vikram_${ts}@ispcrm`));
  assert.ok(candidates.includes(`vikram_${ts}`));

  // Initial radreply verification for initial 50M plan
  for (const c of candidates) {
    const r = await prisma.radReply.findFirst({
      where: { username: c, attribute: 'Mikrotik-Rate-Limit' },
    });
    assert.ok(r, `Rate limit must exist for candidate ${c}`);
    assert.equal(r.value, '25M/50M');
  }

  // =========================================================================
  // TEST 1: Plan Upgrade Creates AuditLog, Generates Invoice, Excludes Secrets
  // =========================================================================
  let upgradeResult;
  await t.test('1. Plan Upgrade creates AuditLog, generates invoice, excludes secrets', async () => {
    upgradeResult = await subscriptionsService.upgrade(
      orgAId,
      adminAUserId,
      sub.id,
      plan100M.id,
      'Customer requested upgrade to 100 Mbps',
    );

    assert.ok(upgradeResult, 'Upgrade result must exist');
    assert.equal(upgradeResult.planId, plan100M.id);
    assert.equal(Number(upgradeResult.price), 799);
    assert.ok(upgradeResult.invoice, 'Invoice must be generated');
    assert.equal(upgradeResult.invoice.source, InvoiceSource.PLAN_CHANGE);
    assert.equal(Number(upgradeResult.invoice.subtotal), 799);

    // Verify AuditLog record in DB
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        organizationId: orgAId,
        entityType: 'SUBSCRIPTION',
        entityId: sub.id,
        action: AuditAction.UPDATE,
      },
      orderBy: { createdAt: 'desc' },
    });

    assert.ok(auditLog, 'AuditLog entry must be created');
    assert.equal(auditLog.adminUserId, adminAUserId);
    assert.equal(auditLog.entityId, sub.id);

    const details = auditLog.details;
    assert.equal(details.action, 'PLAN_CHANGE');
    assert.equal(details.subAction, 'UPGRADE');
    assert.equal(details.oldPlanId, plan50M.id);
    assert.equal(details.newPlanId, plan100M.id);
    assert.equal(details.oldPlanName, 'Starter 50M');
    assert.equal(details.newPlanName, 'Turbo 100M');
    assert.equal(Number(details.oldPrice), Number(sub.price));
    assert.equal(Number(details.newPrice), 799);
    assert.equal(details.oldBandwidth, '25M/50M');
    assert.equal(details.newBandwidth, '50M/100M');
    assert.equal(details.invoiceId, upgradeResult.invoice.id);

    // Assert NO secrets in AuditLog details
    const detailsJson = JSON.stringify(details);
    assert.ok(!detailsJson.toLowerCase().includes('password'), 'AuditLog must not contain password');
    assert.ok(!detailsJson.toLowerCase().includes('secret'), 'AuditLog must not contain secret');
    assert.ok(!detailsJson.includes('SecretPppoePassword99!'), 'AuditLog must not contain subscriber password');
  });

  // =========================================================================
  // TEST 2: FreeRADIUS Realm Candidate Normalization Updates Both Candidates
  // =========================================================================
  await t.test('2. FreeRADIUS radreply updates both candidate usernames without duplicates', async () => {
    const rateLimitRows = await prisma.radReply.findMany({
      where: {
        username: { in: candidates },
        attribute: 'Mikrotik-Rate-Limit',
      },
    });

    assert.equal(rateLimitRows.length, 2, 'Exactly 2 candidate rows must exist (1 per candidate)');
    for (const row of rateLimitRows) {
      assert.equal(row.value, '50M/100M', `Rate limit must be updated to 50M/100M for ${row.username}`);
      assert.equal(row.op.trim(), '=');
    }

    // radcheck credentials must remain intact
    const credRows = await prisma.radCheck.findMany({
      where: { username: { in: candidates }, attribute: 'Cleartext-Password' },
    });
    assert.equal(credRows.length, 2);
    for (const c of credRows) {
      assert.equal(c.value, 'SecretPppoePassword99!');
    }
  });

  // =========================================================================
  // TEST 3: Tenant Isolation of AuditLog & Subscription Mutation
  // =========================================================================
  await t.test('3. Tenant isolation protects AuditLog and prevents cross-tenant plan change', async () => {
    // Org B cannot find Org A's audit log
    const orgBAudit = await prisma.auditLog.findMany({
      where: {
        organizationId: orgBId,
        entityId: sub.id,
      },
    });
    assert.equal(orgBAudit.length, 0, 'Org B must not see Org A audit log');

    // Org B cannot upgrade Org A's subscription
    await assert.rejects(
      async () => {
        await subscriptionsService.upgrade(orgBId, 'attacker-id', sub.id, plan100M.id);
      },
      { message: /not found in your organization/i },
      'Org B must be blocked from modifying Org A subscription',
    );
  });

  // =========================================================================
  // TEST 4: Plan Downgrade Creates AuditLog and Updates Candidate Radreply
  // =========================================================================
  await t.test('4. Plan Downgrade creates AuditLog and updates both candidate radreply rows', async () => {
    const downgradeResult = await subscriptionsService.downgrade(
      orgAId,
      adminAUserId,
      sub.id,
      plan50M.id,
      'Downgrade back to 50M',
    );

    assert.ok(downgradeResult);
    assert.equal(downgradeResult.planId, plan50M.id);

    // Verify AuditLog for DOWNGRADE
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        organizationId: orgAId,
        entityType: 'SUBSCRIPTION',
        entityId: sub.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    assert.ok(auditLog);
    assert.equal(auditLog.details.action, 'PLAN_CHANGE');
    assert.equal(auditLog.details.subAction, 'DOWNGRADE');
    assert.equal(auditLog.details.oldPlanId, plan100M.id);
    assert.equal(auditLog.details.newPlanId, plan50M.id);
    assert.equal(auditLog.details.newBandwidth, '25M/50M');

    // Verify radreply updated for both candidates
    const rateLimitRows = await prisma.radReply.findMany({
      where: {
        username: { in: candidates },
        attribute: 'Mikrotik-Rate-Limit',
      },
    });
    assert.equal(rateLimitRows.length, 2);
    for (const row of rateLimitRows) {
      assert.equal(row.value, '25M/50M');
    }
  });

  // =========================================================================
  // TEST 5: Controller RBAC Roles Enforcement
  // =========================================================================
  await t.test('5. Controller RBAC restricts package change to OWNER, ADMIN, BILLING', () => {
    const upgradeRoles = Reflect.getMetadata('roles', SubscriptionsController.prototype.upgrade);
    const downgradeRoles = Reflect.getMetadata('roles', SubscriptionsController.prototype.downgrade);
    const changePlanRoles = Reflect.getMetadata('roles', SubscriptionsController.prototype.changePlan);

    for (const roles of [upgradeRoles, downgradeRoles, changePlanRoles]) {
      assert.ok(roles, 'Roles metadata must be defined on controller endpoint');
      assert.ok(roles.includes(UserRole.ISP_OWNER), 'Must allow ISP_OWNER');
      assert.ok(roles.includes(UserRole.ISP_ADMIN), 'Must allow ISP_ADMIN');
      assert.ok(roles.includes(UserRole.BILLING), 'Must allow BILLING');

      assert.ok(!roles.includes(UserRole.SUPPORT), 'Must NOT allow SUPPORT');
      assert.ok(!roles.includes(UserRole.TECHNICIAN), 'Must NOT allow TECHNICIAN');
      assert.ok(!roles.includes(UserRole.READ_ONLY), 'Must NOT allow READ_ONLY');
    }
  });

  // =========================================================================
  // TEST 6: Invoice Idempotency on Repeated Request
  // =========================================================================
  await t.test('6. Repeated upgrade to same plan returns identical invoice without duplicates', async () => {
    const repeatResult = await subscriptionsService.upgrade(
      orgAId,
      adminAUserId,
      sub.id,
      plan50M.id,
      'Retry same plan',
    );

    assert.ok(repeatResult.invoice);
    const planChangeInvoices = await prisma.invoice.findMany({
      where: {
        subscriptionId: sub.id,
        source: InvoiceSource.PLAN_CHANGE,
        status: { not: 'CANCELLED' },
      },
    });

    // Sub had upgrade (plan 100) + downgrade (plan 50). Retry of plan 50 must NOT add a 3rd invoice.
    assert.equal(planChangeInvoices.length, 2, 'Must not duplicate invoice on retry');
  });

  console.log('✅ All Plan Change Hardening tests passed successfully!');
});
