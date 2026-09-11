import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { JwtAuthGuard } from '../dist/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import { UserRole } from '@isp-crm/shared';
import { ROLES_KEY } from '../dist/common/decorators/roles.decorator.js';

const authService = new AuthService();
const customersService = new CustomersService();

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

test('1. Organization Registration & Valid Login', async () => {
  const testSlug = `tenant-test-${Date.now()}`;
  const registerDto = {
    name: 'Apex Networks Pvt Ltd',
    slug: testSlug,
    email: `contact@${testSlug}.com`,
    phone: '9876543210',
    ownerName: 'Vikram Mehta',
    ownerEmail: `owner@${testSlug}.com`,
    ownerPassword: 'securePassword123!',
  };

  // Register organization + ISP_OWNER
  const regResult = await authService.registerOrganization(registerDto);
  assert.ok(regResult.accessToken, 'Should return access token');
  assert.ok(regResult.refreshToken, 'Should return refresh token');
  assert.equal(regResult.user.role, UserRole.ISP_OWNER);
  assert.equal(regResult.user.email, registerDto.ownerEmail);
  assert.ok(regResult.user.organizationId, 'Should associate with created organization');

  // Valid Login with registered credentials
  const loginResult = await authService.login({
    email: registerDto.ownerEmail,
    password: registerDto.ownerPassword,
  });

  assert.ok(loginResult.accessToken);
  assert.ok(loginResult.refreshToken);
  assert.equal(loginResult.user.email, registerDto.ownerEmail);
  assert.equal(loginResult.user.role, UserRole.ISP_OWNER);
});

test('2. Invalid Login Handling', async () => {
  // Wrong password
  await assert.rejects(
    async () => {
      await authService.login({
        email: 'admin@speednet.in',
        password: 'incorrectPassword999',
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /Invalid email or password/i);
      return true;
    },
  );

  // Non-existent user
  await assert.rejects(
    async () => {
      await authService.login({
        email: 'doesnotexist@unknown.in',
        password: 'anyPassword123',
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /Invalid email or password/i);
      return true;
    },
  );
});

test('3. Unauthorized API Requests (JwtAuthGuard)', async () => {
  const guard = new JwtAuthGuard(new MockReflector({ isPublic: false }));

  // Request missing Authorization header
  const reqNoAuth = { headers: {} };
  const { context: ctxNoAuth } = createMockContext(reqNoAuth, { isPublic: false });

  await assert.rejects(
    async () => {
      await guard.canActivate(ctxNoAuth);
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /Missing or invalid Authorization header/i);
      return true;
    },
  );

  // Request with invalid/forged Bearer token
  const reqBadToken = { headers: { authorization: 'Bearer forged.fake.token' } };
  const { context: ctxBadToken } = createMockContext(reqBadToken, { isPublic: false });

  await assert.rejects(
    async () => {
      await guard.canActivate(ctxBadToken);
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /Token is invalid or expired/i);
      return true;
    },
  );
});

test('4. Tenant Isolation Enforcement', async () => {
  const ts = Date.now();
  // Register Tenant A
  const orgA = await authService.registerOrganization({
    name: `Tenant A ISP ${ts}`,
    slug: `tenant-a-${ts}`,
    email: `info@tenant-a-${ts}.com`,
    phone: '9000000001',
    ownerName: 'Owner A',
    ownerEmail: `owner.a.${ts}@ispa.com`,
    ownerPassword: 'PasswordA123!',
  });

  // Register Tenant B
  const orgB = await authService.registerOrganization({
    name: `Tenant B ISP ${ts}`,
    slug: `tenant-b-${ts}`,
    email: `info@tenant-b-${ts}.com`,
    phone: '9000000002',
    ownerName: 'Owner B',
    ownerEmail: `owner.b.${ts}@ispb.com`,
    ownerPassword: 'PasswordB123!',
  });

  const orgIdA = orgA.user.organizationId;
  const orgIdB = orgB.user.organizationId;

  // Create customer in Tenant A
  const custA = await customersService.create(orgIdA, {
    name: 'Customer of Org A',
    customerCode: `CUST-A-${ts}`,
    phone: '9888800001',
    installationAddress: 'Building A, Pune',
    pppoeUsername: `pppoe_a_${ts}`,
    pppoePassword: 'passWordA!',
  });

  // Attempt to spoof organizationId in payload for Tenant B
  // NEVER accept organizationId from frontend - service derives it from authenticated context
  const custB = await customersService.create(orgIdB, {
    organizationId: orgIdA, // Maliciously trying to inject Tenant A's ID
    name: 'Customer of Org B',
    customerCode: `CUST-B-${ts}`,
    phone: '9888800002',
    installationAddress: 'Building B, Mumbai',
    pppoeUsername: `pppoe_b_${ts}`,
    pppoePassword: 'passWordB!',
  });

  // Verify that custB was assigned to orgIdB, completely ignoring the malicious organizationId payload
  assert.equal(custB.organizationId, orgIdB, 'Entity organizationId must strictly come from auth context');

  // Tenant B attempts to list customers -> must NOT see Tenant A's customer
  const listB = await customersService.list(orgIdB, {});
  const itemsB = Array.isArray(listB) ? listB : listB.items;
  const foundAinB = itemsB.find((c) => c.id === custA.id);
  assert.equal(foundAinB, undefined, 'Tenant B must not see Tenant A customer');

  // Tenant B attempts to access Tenant A's customer by ID -> must throw 404 NotFound
  await assert.rejects(
    async () => {
      await customersService.getById(orgIdB, custA.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('5. RBAC Role Authorization (RolesGuard)', async () => {
  // Test route requiring ISP_ADMIN
  const requiredRoles = [UserRole.ISP_ADMIN];

  // 5.1 READ_ONLY user is denied
  const reqReadOnly = {
    user: {
      userId: 'user-ro',
      organizationId: 'org-1',
      email: 'readonly@isp.com',
      role: UserRole.READ_ONLY,
    },
  };
  const { context: ctxRO, reflector: refRO } = createMockContext(reqReadOnly, {
    [ROLES_KEY]: requiredRoles,
  });
  const guardRO = new RolesGuard(refRO);

  assert.throws(
    () => guardRO.canActivate(ctxRO),
    (err) => {
      assert.equal(err.status, 403);
      assert.match(err.message, /Access denied/i);
      return true;
    },
  );

  // 5.2 SUPPORT user is denied on admin-only route
  const reqSupport = {
    user: {
      userId: 'user-supp',
      organizationId: 'org-1',
      email: 'support@isp.com',
      role: UserRole.SUPPORT,
    },
  };
  const { context: ctxSupp, reflector: refSupp } = createMockContext(reqSupport, {
    [ROLES_KEY]: requiredRoles,
  });
  const guardSupp = new RolesGuard(refSupp);

  assert.throws(
    () => guardSupp.canActivate(ctxSupp),
    (err) => {
      assert.equal(err.status, 403);
      return true;
    },
  );

  // 5.3 ISP_ADMIN is granted access
  const reqAdmin = {
    user: {
      userId: 'user-admin',
      organizationId: 'org-1',
      email: 'admin@isp.com',
      role: UserRole.ISP_ADMIN,
    },
  };
  const { context: ctxAdmin, reflector: refAdmin } = createMockContext(reqAdmin, {
    [ROLES_KEY]: requiredRoles,
  });
  const guardAdmin = new RolesGuard(refAdmin);
  assert.equal(guardAdmin.canActivate(ctxAdmin), true);

  // 5.4 ISP_OWNER is granted access (Owner superset privilege)
  const reqOwner = {
    user: {
      userId: 'user-owner',
      organizationId: 'org-1',
      email: 'owner@isp.com',
      role: UserRole.ISP_OWNER,
    },
  };
  const { context: ctxOwner, reflector: refOwner } = createMockContext(reqOwner, {
    [ROLES_KEY]: requiredRoles,
  });
  const guardOwner = new RolesGuard(refOwner);
  assert.equal(guardOwner.canActivate(ctxOwner), true);
});

test('6. Password Hashing Verification', async () => {
  const ts = Date.now();
  const rawPassword = 'SecretPassword987!';
  const regResult = await authService.registerOrganization({
    name: `Hash Test ISP ${ts}`,
    slug: `hash-test-${ts}`,
    email: `hash.${ts}@test.com`,
    phone: '9991112222',
    ownerName: 'Hash Tester',
    ownerEmail: `hasher.${ts}@test.com`,
    ownerPassword: rawPassword,
  });

  const { prisma } = await import('@isp-crm/database');
  const user = await prisma.adminUser.findUnique({
    where: { id: regResult.user.id },
  });

  assert.ok(user, 'User must exist in database');
  assert.notEqual(user.passwordHash, rawPassword, 'Password must never be saved in plaintext');
  assert.match(user.passwordHash, /^\$2[aby]\$\d{2}\$/, 'Password must be hashed with bcrypt');
});

test('7. Refresh Token Rotation & Logout Invalidation', async () => {
  const ts = Date.now();
  const regResult = await authService.registerOrganization({
    name: `Refresh ISP ${ts}`,
    slug: `refresh-${ts}`,
    email: `refresh.${ts}@test.com`,
    phone: '9993334444',
    ownerName: 'Refresh User',
    ownerEmail: `refresh.${ts}@test.com`,
    ownerPassword: 'Password123!',
  });

  // 7.1 Refresh token rotation
  const refreshed = await authService.refreshToken({
    refreshToken: regResult.refreshToken,
  });
  assert.ok(refreshed.accessToken, 'Must return new access token');
  assert.ok(refreshed.refreshToken, 'Must return new refresh token');

  // 7.2 Logout
  const logoutRes = await authService.logout(regResult.user.id);
  assert.equal(logoutRes.message, 'Logged out successfully');

  // 7.3 Attempting to refresh using old token after logout must fail
  await assert.rejects(
    async () => {
      await authService.refreshToken({
        refreshToken: refreshed.refreshToken,
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      return true;
    },
  );
});

test('8. Staff Admin User Creation & Tenant Scoping (UsersService)', async () => {
  const { UsersService } = await import('../dist/modules/users/users.service.js');
  const usersService = new UsersService();

  const ts = Date.now();
  const orgResult = await authService.registerOrganization({
    name: `Staff Org ${ts}`,
    slug: `staff-org-${ts}`,
    email: `staff.${ts}@test.com`,
    phone: '9995556666',
    ownerName: 'Org Owner',
    ownerEmail: `owner.${ts}@staff.com`,
    ownerPassword: 'Password123!',
  });

  const orgId = orgResult.user.organizationId;

  // Create technician staff user
  const technician = await usersService.create(orgId, {
    name: 'Tech Rajesh',
    email: `tech.rajesh.${ts}@staff.com`,
    password: 'TechPassword123!',
    role: UserRole.TECHNICIAN,
    phone: '9876543219',
  });

  assert.equal(technician.role, UserRole.TECHNICIAN);
  assert.equal(technician.name, 'Tech Rajesh');

  // Attempting to create duplicate ISP_OWNER via staff API must be forbidden
  await assert.rejects(
    async () => {
      await usersService.create(orgId, {
        name: 'Second Owner',
        email: `secondowner.${ts}@staff.com`,
        password: 'Password123!',
        role: UserRole.ISP_OWNER,
      });
    },
    (err) => {
      assert.equal(err.status, 403);
      return true;
    },
  );

  // List staff users - must contain owner and technician
  const list = await usersService.list(orgId);
  assert.ok(list.length >= 2, 'Should list both owner and created staff');
  assert.ok(list.some((u) => u.id === technician.id));
});
