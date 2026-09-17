import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@isp-crm/database';
import { RadiusService } from '../dist/modules/radius/radius.service.js';
import { RadiusController } from '../dist/modules/radius/radius.controller.js';
import { JwtAuthGuard } from '../dist/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import { UserRole } from '@isp-crm/shared';
import { ROLES_KEY } from '../dist/common/decorators/roles.decorator.js';

const radiusService = new RadiusService();
const radiusController = new RadiusController(radiusService);

// Mock Reflector for unit testing Guards
class MockReflector {
  constructor(metadata = {}) {
    this.metadata = metadata;
  }
  getAllAndOverride(key) {
    return this.metadata[key];
  }
}

// Mock ExecutionContext for testing Guards
function createMockContext(req, metadata = {}) {
  const reflector = new MockReflector(metadata);
  const context = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
  return { context, reflector };
}

test('Live RADIUS Access Request Log Test Suite', async (t) => {
  const timestamp = Date.now();
  const orgASlug = `access-test-a-${timestamp}`;
  const orgBSlug = `access-test-b-${timestamp}`;

  // 1. Seed two distinct organizations for strict tenant isolation testing
  const orgA = await prisma.organization.create({
    data: {
      name: `Tenant A Networks ${timestamp}`,
      slug: orgASlug,
      email: `contact@${orgASlug}.com`,
      phone: '9876543210',
    },
  });

  const orgB = await prisma.organization.create({
    data: {
      name: `Tenant B Networks ${timestamp}`,
      slug: orgBSlug,
      email: `contact@${orgBSlug}.com`,
      phone: '9876543211',
    },
  });

  // 2. Seed customers for Tenant A
  const customerA1 = await prisma.customer.create({
    data: {
      organizationId: orgA.id,
      customerCode: `CUSTA1-${timestamp}`,
      name: 'Ramesh Sharma',
      username: `ramesh_${timestamp}`,
      pppoeUsername: `ramesh_${timestamp}@ispcrm`,
      status: 'ACTIVE',
      macAddress: 'AA:BB:CC:DD:EE:01',
    },
  });

  const customerA2 = await prisma.customer.create({
    data: {
      organizationId: orgA.id,
      customerCode: `CUSTA2-${timestamp}`,
      name: 'Suresh Suspended',
      username: `suresh_${timestamp}`,
      pppoeUsername: `suresh_${timestamp}@ispcrm`,
      status: 'SUSPENDED',
      macAddress: 'AA:BB:CC:DD:EE:02',
    },
  });

  const customerA3 = await prisma.customer.create({
    data: {
      organizationId: orgA.id,
      customerCode: `CUSTA3-${timestamp}`,
      name: 'Pooja Expired',
      username: `pooja_${timestamp}`,
      pppoeUsername: `pooja_${timestamp}@ispcrm`,
      status: 'EXPIRED',
      macAddress: 'AA:BB:CC:DD:EE:03',
    },
  });

  // 3. Seed customer for Tenant B
  const customerB1 = await prisma.customer.create({
    data: {
      organizationId: orgB.id,
      customerCode: `CUSTB1-${timestamp}`,
      name: 'Vikram TenantB',
      username: `vikram_${timestamp}`,
      pppoeUsername: `vikram_${timestamp}@ispcrm`,
      status: 'ACTIVE',
      macAddress: 'AA:BB:CC:DD:EE:99',
    },
  });

  // 4. Seed radpostauth records (Authentication attempt history)
  const baseDate = new Date();
  const pastDate1 = new Date(baseDate.getTime() - 1000 * 60 * 30); // 30 mins ago
  const pastDate2 = new Date(baseDate.getTime() - 1000 * 60 * 15); // 15 mins ago
  const recentDate = new Date(baseDate.getTime() - 1000 * 60 * 5); // 5 mins ago

  await prisma.radPostAuth.createMany({
    data: [
      // Tenant A - Ramesh (Accept)
      {
        username: `ramesh_${timestamp}@ispcrm`,
        pass: 'superSecretPassword123', // Raw password logged by FreeRADIUS
        reply: 'Access-Accept',
        authdate: pastDate1,
      },
      // Tenant A - Ramesh (Reject with wrong password)
      {
        username: `ramesh_${timestamp}@ispcrm`,
        pass: 'wrongPasswordAttempt',
        reply: 'Access-Reject',
        authdate: pastDate2,
      },
      // Tenant A - Suresh (Suspended - Reject)
      {
        username: `suresh_${timestamp}@ispcrm`,
        pass: 'passwordShouldBeRedacted',
        reply: 'Access-Reject',
        authdate: recentDate,
      },
      // Tenant A - Pooja (Expired - Reject)
      {
        username: `pooja_${timestamp}@ispcrm`,
        pass: 'expiredSubscriberPassword',
        reply: 'Access-Reject',
        authdate: baseDate,
      },
      // Tenant B - Vikram (Accept) - MUST NEVER BE RETURNED TO TENANT A
      {
        username: `vikram_${timestamp}@ispcrm`,
        pass: 'tenantBSecretPassword',
        reply: 'Access-Accept',
        authdate: baseDate,
      },
    ],
  });

  await t.test('1. Authenticated access & Tenant Isolation (Tenant A only sees its own subscribers)', async () => {
    const result = await radiusService.getAccessRequests(orgA.id, {});
    assert.ok(result, 'Result should be defined');
    assert.ok(Array.isArray(result.items), 'items should be an array');
    assert.equal(result.total, 4, 'Tenant A should have exactly 4 access requests');
    assert.equal(result.items.length, 4, 'Should return all 4 items for Tenant A');

    // Verify Tenant B username is NOT present
    const tenantBFound = result.items.some((item) => item.username.includes(`vikram_${timestamp}`));
    assert.equal(tenantBFound, false, 'CRITICAL: Tenant B subscriber attempts must NEVER leak to Tenant A!');

    // Verify all returned items belong to Tenant A's subscribers
    const allowedUsernames = [`ramesh_${timestamp}@ispcrm`, `suresh_${timestamp}@ispcrm`, `pooja_${timestamp}@ispcrm`];
    for (const item of result.items) {
      assert.ok(allowedUsernames.includes(item.username), `Item username ${item.username} should belong to Tenant A`);
      assert.ok(item.customerId, 'Should enrich with customerId');
      assert.ok(item.customerName, 'Should enrich with customerName');
    }
  });

  await t.test('2. Credential Redaction (Passwords are strictly omitted from response)', async () => {
    const result = await radiusService.getAccessRequests(orgA.id, {});
    for (const item of result.items) {
      assert.strictEqual(item.pass, undefined, 'CRITICAL: "pass" property must be strictly undefined');
      assert.strictEqual(item.password, undefined, '"password" property must be undefined');
      assert.strictEqual(item.secret, undefined, '"secret" property must be undefined');
    }
  });

  await t.test('3. Intelligent Failure Diagnosis (Rejection Reasons)', async () => {
    const result = await radiusService.getAccessRequests(orgA.id, {});

    // Ramesh Accept
    const acceptItem = result.items.find(
      (i) => i.username === `ramesh_${timestamp}@ispcrm` && i.reply === 'Access-Accept',
    );
    assert.ok(acceptItem, 'Should find accepted item for Ramesh');
    assert.equal(acceptItem.status, 'ACCEPT');
    assert.equal(acceptItem.rejectionReason, 'Authentication Successful');

    // Suresh Suspended Reject
    const sureshItem = result.items.find((i) => i.username === `suresh_${timestamp}@ispcrm`);
    assert.ok(sureshItem, 'Should find Suresh item');
    assert.equal(sureshItem.status, 'REJECT');
    assert.equal(sureshItem.customerStatus, 'SUSPENDED');
    assert.equal(sureshItem.rejectionReason, 'Account is Suspended');

    // Pooja Expired Reject
    const poojaItem = result.items.find((i) => i.username === `pooja_${timestamp}@ispcrm`);
    assert.ok(poojaItem, 'Should find Pooja item');
    assert.equal(poojaItem.status, 'REJECT');
    assert.equal(poojaItem.customerStatus, 'EXPIRED');
    assert.equal(poojaItem.rejectionReason, 'Account is Expired');

    // Ramesh Active with wrong password Reject
    const rameshReject = result.items.find(
      (i) => i.username === `ramesh_${timestamp}@ispcrm` && i.reply === 'Access-Reject',
    );
    assert.ok(rameshReject, 'Should find rejected attempt for Ramesh');
    assert.equal(rameshReject.status, 'REJECT');
    assert.equal(rameshReject.customerStatus, 'ACTIVE');
    assert.equal(rameshReject.rejectionReason, 'Invalid PPPoE Password or MAC Lockout');
  });

  await t.test('4. Pagination Controls (page, limit, totalPages)', async () => {
    // Page 1, limit 2
    const page1 = await radiusService.getAccessRequests(orgA.id, { page: 1, limit: 2 });
    assert.equal(page1.items.length, 2, 'Page 1 should have 2 items');
    assert.equal(page1.page, 1);
    assert.equal(page1.limit, 2);
    assert.equal(page1.total, 4);
    assert.equal(page1.totalPages, 2);

    // Page 2, limit 2
    const page2 = await radiusService.getAccessRequests(orgA.id, { page: 2, limit: 2 });
    assert.equal(page2.items.length, 2, 'Page 2 should have 2 items');
    assert.equal(page2.page, 2);

    // Verify disjoint items between page 1 and page 2
    const page1Ids = page1.items.map((i) => i.id);
    const page2Ids = page2.items.map((i) => i.id);
    for (const id of page2Ids) {
      assert.ok(!page1Ids.includes(id), `Page 2 item ${id} must not exist on Page 1`);
    }
  });

  await t.test('5. Filters: Username, Status (ACCEPT/REJECT), and Date Range', async () => {
    // Filter by username: ramesh
    const byUsername = await radiusService.getAccessRequests(orgA.id, { username: 'ramesh' });
    assert.equal(byUsername.total, 2, 'Ramesh should have 2 total attempts');
    for (const item of byUsername.items) {
      assert.ok(item.username.includes('ramesh'), 'All items should match ramesh');
    }

    // Filter by status: ACCEPT
    const byAccept = await radiusService.getAccessRequests(orgA.id, { status: 'ACCEPT' });
    assert.equal(byAccept.total, 1, 'Should have 1 accepted attempt');
    assert.equal(byAccept.items[0].reply, 'Access-Accept');

    // Filter by status: REJECT
    const byReject = await radiusService.getAccessRequests(orgA.id, { status: 'REJECT' });
    assert.equal(byReject.total, 3, 'Should have 3 rejected attempts');
    for (const item of byReject.items) {
      assert.equal(item.reply, 'Access-Reject');
    }

    // Filter by date range (from 20 mins ago to now)
    const twentyMinsAgo = new Date(baseDate.getTime() - 1000 * 60 * 20).toISOString();
    const byDate = await radiusService.getAccessRequests(orgA.id, { fromDate: twentyMinsAgo });
    assert.ok(byDate.total >= 3, 'Should match attempts within the last 20 minutes');
  });

  await t.test('6. RBAC Role Authorization on Controller endpoint', async () => {
    const endpointRoles = [
      UserRole.ISP_OWNER,
      UserRole.ISP_ADMIN,
      UserRole.TECHNICIAN,
      UserRole.SUPPORT,
      UserRole.READ_ONLY,
    ];

    const rolesGuard = new RolesGuard(
      new MockReflector({
        [ROLES_KEY]: endpointRoles,
      }),
    );

    // Permitted roles (Tenant staff)
    for (const role of endpointRoles) {
      const { context } = createMockContext({ user: { role, organizationId: orgA.id } }, {
        [ROLES_KEY]: endpointRoles,
      });
      const canActivate = rolesGuard.canActivate(context);
      assert.equal(canActivate, true, `Role ${role} should be permitted to view access requests`);
    }

    // Decommissioned SUPER_ADMIN cannot access
    const { context: saContext } = createMockContext({ user: { role: UserRole.SUPER_ADMIN, organizationId: orgA.id } }, {
      [ROLES_KEY]: endpointRoles,
    });
    assert.throws(
      () => rolesGuard.canActivate(saContext),
      /Access denied/,
      'Decommissioned SUPER_ADMIN should be rejected with ForbiddenException',
    );

    // Unauthorized role (e.g. empty user or custom unpermitted role)
    const { context: unauthContext } = createMockContext({ user: { role: 'UNAUTHORIZED_ROLE' } }, {
      [ROLES_KEY]: endpointRoles,
    });
    assert.throws(
      () => rolesGuard.canActivate(unauthContext),
      /Access denied/,
      'Unpermitted role should be rejected with ForbiddenException',
    );
  });


  // Cleanup seeded test organizations and records
  await prisma.radPostAuth.deleteMany({
    where: {
      username: {
        in: [
          `ramesh_${timestamp}@ispcrm`,
          `suresh_${timestamp}@ispcrm`,
          `pooja_${timestamp}@ispcrm`,
          `vikram_${timestamp}@ispcrm`,
        ],
      },
    },
  });
  await prisma.customer.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});
