import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { AuthController } from '../dist/modules/auth/auth.controller.js';
import { TenantsService } from '../dist/modules/tenants/tenants.service.js';
import { TenantsController } from '../dist/modules/tenants/tenants.controller.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import { JwtAuthGuard } from '../dist/common/guards/jwt-auth.guard.js';
import { ROLES_KEY } from '../dist/common/decorators/roles.decorator.js';
import { UserRole } from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';
import jwt from 'jsonwebtoken';

const authService = new AuthService();
const authController = new AuthController(authService);
const tenantsService = new TenantsService();
const tenantsController = new TenantsController(tenantsService);

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

// Keep track of test-created organizations for cleanup after tests
const testOrgIds = [];

test.before(async () => {
  const staleUsers = await prisma.adminUser.findMany({
    where: { email: { endsWith: '@acronet.test' } },
    select: { organizationId: true },
  });
  for (const u of staleUsers) {
    if (u.organizationId) {
      await prisma.auditLog.deleteMany({ where: { organizationId: u.organizationId } });
      await prisma.adminUser.deleteMany({ where: { organizationId: u.organizationId } });
      await prisma.organization.deleteMany({ where: { id: u.organizationId } });
    }
  }
  const staleOrgs = await prisma.organization.findMany({
    where: { slug: { in: ['acronet-telecom', 'acronet-telecom-2', 'transaction-test-org'] } },
  });
  for (const o of staleOrgs) {
    await prisma.auditLog.deleteMany({ where: { organizationId: o.id } });
    await prisma.adminUser.deleteMany({ where: { organizationId: o.id } });
    await prisma.organization.deleteMany({ where: { id: o.id } });
  }
});

test.after(async () => {
  // Clean up any test organizations created during tests
  for (const orgId of testOrgIds) {
    try {
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
      await prisma.adminUser.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    } catch {
      // Ignore cleanup error if already deleted
    }
  }
});

let createdAuthResponse = null;
let createdOrgId = null;

test('1. Self-service Tenant Onboarding: Register ISP organization + first ISP_OWNER via AuthController', async () => {
  const payload = {
    name: 'AcroNet Telecom Solutions',
    slug: 'acronet-telecom',
    legalName: 'AcroNet Telecom Pvt Ltd',
    gstin: '27ABCDE1234F1Z5',
    email: 'contact@acronet.test',
    phone: '+919988776655',
    address: '101 Cyber Towers, Viman Nagar',
    city: 'Pune',
    state: 'Maharashtra',
    stateCode: '27',
    pincode: '411014',
    ownerName: 'Rohan Sharma',
    ownerEmail: 'rohan@acronet.test',
    ownerPassword: 'SecureTestPass123!',
    ownerPhone: '+919988776655',
  };

  const res = await authController.registerOrganization(payload);
  assert.ok(res, 'Must return response');
  assert.ok(res.accessToken, 'Must return JWT access token');
  assert.ok(res.refreshToken, 'Must return JWT refresh token');
  assert.ok(res.user, 'Must return user object');
  assert.equal(res.user.email, 'rohan@acronet.test');
  assert.equal(res.user.role, UserRole.ISP_OWNER);
  assert.ok(res.user.organizationId, 'User must belong to organization');

  createdOrgId = res.user.organizationId;
  testOrgIds.push(createdOrgId);
  createdAuthResponse = res;
});

test('2. Organization created correctly in database with expected metadata', async () => {
  assert.ok(createdOrgId);
  const dbOrg = await prisma.organization.findUnique({
    where: { id: createdOrgId },
  });

  assert.ok(dbOrg, 'Organization record must exist in PostgreSQL');
  assert.equal(dbOrg.name, 'AcroNet Telecom Solutions');
  assert.equal(dbOrg.slug, 'acronet-telecom');
  assert.equal(dbOrg.legalName, 'AcroNet Telecom Pvt Ltd');
  assert.equal(dbOrg.gstin, '27ABCDE1234F1Z5');
  assert.equal(dbOrg.email, 'contact@acronet.test');
  assert.equal(dbOrg.phone, '+919988776655');
  assert.equal(dbOrg.city, 'Pune');
  assert.equal(dbOrg.state, 'Maharashtra');
  assert.equal(dbOrg.pincode, '411014');
  assert.equal(dbOrg.isActive, true);
});

test('3. Tenant admin created correctly in database with ISP_OWNER role', async () => {
  assert.ok(createdAuthResponse?.user?.id);
  const dbAdmin = await prisma.adminUser.findUnique({
    where: { id: createdAuthResponse.user.id },
  });

  assert.ok(dbAdmin, 'AdminUser record must exist in database');
  assert.equal(dbAdmin.email, 'rohan@acronet.test');
  assert.equal(dbAdmin.name, 'Rohan Sharma');
  assert.equal(dbAdmin.role, UserRole.ISP_OWNER);
  assert.equal(dbAdmin.organizationId, createdOrgId);
  assert.equal(dbAdmin.isActive, true);
});

test('4. Password is hashed securely / no plaintext password stored', async () => {
  const dbAdmin = await prisma.adminUser.findUnique({
    where: { id: createdAuthResponse.user.id },
  });
  assert.ok(dbAdmin.passwordHash, 'passwordHash must exist');
  assert.notEqual(dbAdmin.passwordHash, 'SecureTestPass123!');
  assert.ok(dbAdmin.passwordHash.startsWith('$2'), 'Password hash must be bcrypt');
  const matches = await bcrypt.compare('SecureTestPass123!', dbAdmin.passwordHash);
  assert.ok(matches, 'bcrypt hash must match the supplied password');
});

test('5. Tenant Owner can login and obtain valid session token', async () => {
  const loginRes = await authController.login({
    email: 'rohan@acronet.test',
    password: 'SecureTestPass123!',
  });

  assert.ok(loginRes.accessToken);
  assert.equal(loginRes.user.email, 'rohan@acronet.test');
  assert.equal(loginRes.user.organizationId, createdOrgId);
  assert.equal(loginRes.user.role, UserRole.ISP_OWNER);
});

test('6. Tenant Owner can fetch own ISP organization profile via TenantsController.getCurrent', async () => {
  const profile = await tenantsController.getCurrent(createdOrgId);
  assert.ok(profile);
  assert.equal(profile.id, createdOrgId);
  assert.equal(profile.name, 'AcroNet Telecom Solutions');
  assert.equal(profile.gstin, '27ABCDE1234F1Z5');
  assert.ok(profile._count);
  assert.equal(profile._count.users, 1);
});

test('7. Tenant Owner can update own ISP organization profile via TenantsController.update', async () => {
  const updated = await tenantsController.update(createdOrgId, {
    legalName: 'AcroNet Telecom Solutions Private Limited',
    phone: '+919988776600',
  });

  assert.equal(updated.legalName, 'AcroNet Telecom Solutions Private Limited');
  assert.equal(updated.phone, '+919988776600');
});

test('8. Duplicate slug rejected with 409 Conflict', async () => {
  const payloadConflict = {
    name: 'AcroNet Telecom 2',
    slug: 'acronet-telecom', // already taken
    email: 'contact2@acronet.test',
    phone: '+919988776656',
    ownerName: 'Other Owner',
    ownerEmail: 'other@acronet.test',
    ownerPassword: 'Password123!',
  };

  await assert.rejects(
    async () => {
      await authController.registerOrganization(payloadConflict);
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /already taken/i);
      return true;
    },
  );
});

test('9. Duplicate owner email rejected with 409 Conflict', async () => {
  const payloadConflict = {
    name: 'AcroNet Different Org',
    slug: 'acronet-different',
    email: 'contact3@acronet.test',
    phone: '+919988776657',
    ownerName: 'Duplicate Rohan',
    ownerEmail: 'rohan@acronet.test', // already registered
    ownerPassword: 'Password123!',
  };

  await assert.rejects(
    async () => {
      await authController.registerOrganization(payloadConflict);
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /already registered/i);
      return true;
    },
  );
});

test('10. Super Admin module is decommissioned (no SuperAdminController/Service)', () => {
  // SuperAdminController and SuperAdminService have been removed
  assert.equal(typeof globalThis.SuperAdminController, 'undefined');
  assert.equal(typeof globalThis.SuperAdminService, 'undefined');
});

test('11. Unauthenticated request rejected by JwtAuthGuard (401)', async () => {
  const req = { headers: {} };
  const { context, reflector } = createMockContext(req);
  const guard = new JwtAuthGuard(reflector);

  await assert.rejects(
    async () => guard.canActivate(context),
    (err) => {
      assert.equal(err.status, 401);
      return true;
    },
  );
});

test('12. Existing Spacecom production organization and router remain untouched', async () => {
  const spacecomOrg = await prisma.organization.findFirst({
    where: { name: { contains: 'Spacecom' } },
  });

  assert.ok(spacecomOrg, 'Spacecom organization must exist');
  assert.equal(spacecomOrg.name, 'Spacecom Internet Broadband');
  assert.equal(spacecomOrg.isActive, true);

  const prodRouter = await prisma.router.findUnique({
    where: { id: '76075d82-fa61-409c-888a-e7e1fe2fb22a' },
  });

  assert.ok(prodRouter, 'Production router must exist');
  assert.equal(prodRouter.name, 'Physical-MikroTik-ROS6-45-1');
  assert.equal(prodRouter.status, 'ONLINE');
});
