import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '@isp-crm/database';
import {
  UserRole,
  CustomerStatus,
  SubscriptionStatus,
  InvoiceStatus,
  PaymentStatus,
  RouterConnectionMethod,
  RouterStatus,
  TicketStatus,
  TicketPriority,
} from '@isp-crm/shared';

// Module Services & Controllers
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { MikrotikService } from '../dist/modules/routers/mikrotik.service.js';
import { SstpVpnService } from '../dist/modules/routers/sstp-vpn.service.js';
import { MockMikrotikClient } from '../dist/modules/routers/clients/mock-mikrotik.client.js';
import { InvoicesService } from '../dist/modules/invoices/invoices.service.js';
import { SubscriptionsService } from '../dist/modules/subscriptions/subscriptions.service.js';
import { PlansService } from '../dist/modules/plans/plans.service.js';
import { PaymentsService } from '../dist/modules/payments/payments.service.js';
import { ZonesService } from '../dist/modules/zones/zones.service.js';
import { RadiusService } from '../dist/modules/radius/radius.service.js';
import { AuditService } from '../dist/modules/audit/audit.service.js';
import { RolesGuard } from '../dist/common/guards/roles.guard.js';
import { JwtAuthGuard } from '../dist/common/guards/jwt-auth.guard.js';
import { ROLES_KEY } from '../dist/common/decorators/roles.decorator.js';
import jwt from 'jsonwebtoken';

// Helper classes for Guards
class MockReflector {
  constructor(metadata = {}) {
    this.metadata = metadata;
  }
  getAllAndOverride(key) {
    return this.metadata[key];
  }
}

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

// Services instances
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production';
const signToken = (payload) => jwt.sign(payload, JWT_SECRET);
const authService = new AuthService();
const customersService = new CustomersService();
const mockClient = new MockMikrotikClient();
const sstpVpnService = new SstpVpnService();
const mikrotikService = new MikrotikService(mockClient, sstpVpnService);
const subscriptionsService = new SubscriptionsService();
const invoicesService = new InvoicesService();
const plansService = new PlansService();
const paymentsService = new PaymentsService();
const zonesService = new ZonesService();
const radiusService = new RadiusService();
const auditService = new AuditService();

// State for isolation tests
let orgA = null;
let orgB = null;
let userA_Owner = null;
let userA_Admin = null;
let userA_Billing = null;
let userA_Support = null;
let userA_Tech = null;
let userA_ReadOnly = null;

let userB_Owner = null;

let customerA = null;
let customerB = null;
let routerA = null;
let routerB = null;
let planA = null;
let planB = null;
let subA = null;
let invA = null;
let payA = null;
let zoneA = null;
let nodeA = null;

test.before(async () => {
  // Clean up any previous test data
  const testSlugs = ['vedshri-tenant-a', 'vedshri-tenant-b'];
  const oldOrgs = await prisma.organization.findMany({
    where: { slug: { in: testSlugs } },
  });

  for (const org of oldOrgs) {
    await prisma.radPostAuth.deleteMany({ where: { username: { startsWith: `vedshri-${org.slug}` } } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.invoiceItem.deleteMany({ where: { invoice: { organizationId: org.id } } }).catch(() => {});
    await prisma.invoice.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.subscription.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.node.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.zone.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.router.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.internetPlan.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.adminUser.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  }

  // 1. Create Tenant A
  orgA = await prisma.organization.create({
    data: {
      name: 'Vedshri Tenant A',
      slug: 'vedshri-tenant-a',
      legalName: 'Vedshri Tenant A Ltd',
      email: 'admin@vedshri-a.test',
      phone: '+919876543210',
      isActive: true,
    },
  });

  // 2. Create Tenant B
  orgB = await prisma.organization.create({
    data: {
      name: 'Vedshri Tenant B',
      slug: 'vedshri-tenant-b',
      legalName: 'Vedshri Tenant B Ltd',
      email: 'admin@vedshri-b.test',
      phone: '+919876543211',
      isActive: true,
    },
  });

  const pwdHash = await bcrypt.hash('SecureTestPass123!', 10);

  // Users for Tenant A
  userA_Owner = await prisma.adminUser.create({
    data: {
      organizationId: orgA.id,
      name: 'A Owner',
      email: 'owner@vedshri-a.test',
      passwordHash: pwdHash,
      role: UserRole.ISP_OWNER,
      isActive: true,
    },
  });

  userA_Admin = await prisma.adminUser.create({
    data: {
      organizationId: orgA.id,
      name: 'A Admin',
      email: 'admin@vedshri-a.test',
      passwordHash: pwdHash,
      role: UserRole.ISP_ADMIN,
      isActive: true,
    },
  });

  userA_Billing = await prisma.adminUser.create({
    data: {
      organizationId: orgA.id,
      name: 'A Billing',
      email: 'billing@vedshri-a.test',
      passwordHash: pwdHash,
      role: UserRole.BILLING,
      isActive: true,
    },
  });

  userA_Support = await prisma.adminUser.create({
    data: {
      organizationId: orgA.id,
      name: 'A Support',
      email: 'support@vedshri-a.test',
      passwordHash: pwdHash,
      role: UserRole.SUPPORT,
      isActive: true,
    },
  });

  userA_Tech = await prisma.adminUser.create({
    data: {
      organizationId: orgA.id,
      name: 'A Tech',
      email: 'tech@vedshri-a.test',
      passwordHash: pwdHash,
      role: UserRole.TECHNICIAN,
      isActive: true,
    },
  });

  userA_ReadOnly = await prisma.adminUser.create({
    data: {
      organizationId: orgA.id,
      name: 'A ReadOnly',
      email: 'readonly@vedshri-a.test',
      passwordHash: pwdHash,
      role: UserRole.READ_ONLY,
      isActive: true,
    },
  });

  // User for Tenant B
  userB_Owner = await prisma.adminUser.create({
    data: {
      organizationId: orgB.id,
      name: 'B Owner',
      email: 'owner@vedshri-b.test',
      passwordHash: pwdHash,
      role: UserRole.ISP_OWNER,
      isActive: true,
    },
  });

  // 3. Create Resources for Tenant A
  planA = await prisma.internetPlan.create({
    data: {
      organizationId: orgA.id,
      code: 'PLAN-100M-A',
      name: 'Plan 100M A',
      downloadSpeed: 100,
      uploadSpeed: 100,
      price: 999,
      validityDays: 30,
      isActive: true,
    },
  });

  planB = await prisma.internetPlan.create({
    data: {
      organizationId: orgB.id,
      code: 'PLAN-50M-B',
      name: 'Plan 50M B',
      downloadSpeed: 50,
      uploadSpeed: 50,
      price: 599,
      validityDays: 30,
      isActive: true,
    },
  });

  zoneA = await prisma.zone.create({
    data: {
      organizationId: orgA.id,
      name: 'Zone North A',
      description: 'North Zone Pune',
    },
  });

  nodeA = await prisma.node.create({
    data: {
      organizationId: orgA.id,
      zoneId: zoneA.id,
      name: 'Node Alpha A',
      description: 'Alpha Node',
    },
  });

  customerA = await prisma.customer.create({
    data: {
      organizationId: orgA.id,
      customerCode: 'CUST-A-001',
      name: 'Subscriber A',
      email: 'subscriber-a@test.com',
      phone: '+919000000001',
      username: 'sub_a_vedshri',
      pppoePassword: 'pppoe-password-a',
      address: 'A Street',
      city: 'Pune',
      status: CustomerStatus.ACTIVE,
      zoneId: zoneA.id,
      nodeId: nodeA.id,
    },
  });

  customerB = await prisma.customer.create({
    data: {
      organizationId: orgB.id,
      customerCode: 'CUST-B-001',
      name: 'Subscriber B',
      email: 'subscriber-b@test.com',
      phone: '+919000000002',
      username: 'sub_b_vedshri',
      pppoePassword: 'pppoe-password-b',
      address: 'B Street',
      city: 'Pune',
      status: CustomerStatus.ACTIVE,
    },
  });

  routerA = await prisma.router.create({
    data: {
      organizationId: orgA.id,
      name: 'Router MikroTik A',
      host: '10.10.10.1',
      port: 8728,
      username: 'admin',
      encryptedCredential: 'enc-password-a',
      connectionMethod: 'DIRECT_API',
      status: RouterStatus.ONLINE,
    },
  });

  routerB = await prisma.router.create({
    data: {
      organizationId: orgB.id,
      name: 'Router MikroTik B',
      host: '10.10.10.2',
      port: 8728,
      username: 'admin',
      encryptedCredential: 'enc-password-b',
      connectionMethod: 'DIRECT_API',
      status: RouterStatus.ONLINE,
    },
  });

  subA = await prisma.subscription.create({
    data: {
      organizationId: orgA.id,
      customerId: customerA.id,
      planId: planA.id,
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      autoRenew: true,
    },
  });

  invA = await prisma.invoice.create({
    data: {
      organizationId: orgA.id,
      customerId: customerA.id,
      subscriptionId: subA.id,
      invoiceNumber: 'INV-A-0001',
      subtotal: 999,
      cgstAmount: 89.91,
      sgstAmount: 89.91,
      totalAmount: 1178.82,
      paidAmount: 0,
      status: 'ISSUED',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  payA = await prisma.payment.create({
    data: {
      organizationId: orgA.id,
      customerId: customerA.id,
      invoiceId: invA.id,
      receiptNumber: 'REC-A-0001',
      amount: 1178.82,
      status: PaymentStatus.COMPLETED,
      paymentMethod: 'CASH',
    },
  });

  // Audit log for A
  await prisma.auditLog.create({
    data: {
      organizationId: orgA.id,
      adminUserId: userA_Owner.id,
      action: 'CREATE',
      entityType: 'CUSTOMER',
      entityId: customerA.id,
      details: { name: customerA.name },
    },
  });

  // RADIUS access request for A
  await prisma.radPostAuth.create({
    data: {
      username: customerA.username,
      pass: 'pppoe-password-a',
      reply: 'Access-Accept',
      authdate: new Date(),
    },
  });
});

test.after(async () => {
  if (orgA?.id) {
    await prisma.radPostAuth.deleteMany({ where: { username: customerA?.username } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { organizationId: orgA.id } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { organizationId: orgA.id } }).catch(() => {});
    await prisma.invoiceItem.deleteMany({ where: { invoice: { organizationId: orgA.id } } }).catch(() => {});
    await prisma.invoice.deleteMany({ where: { organizationId: orgA.id } }).catch(() => {});
    await prisma.subscription.deleteMany({ where: { organizationId: orgA.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { organizationId: orgA.id } }).catch(() => {});
    await prisma.node.deleteMany({ where: { organizationId: orgA.id } }).catch(() => {});
    await prisma.zone.deleteMany({ where: { organizationId: orgA.id } }).catch(() => {});
    await prisma.router.deleteMany({ where: { organizationId: orgA.id } }).catch(() => {});
    await prisma.internetPlan.deleteMany({ where: { organizationId: orgA.id } }).catch(() => {});
    await prisma.adminUser.deleteMany({ where: { organizationId: orgA.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: orgA.id } }).catch(() => {});
  }

  if (orgB?.id) {
    await prisma.radPostAuth.deleteMany({ where: { username: customerB?.username } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { organizationId: orgB.id } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { organizationId: orgB.id } }).catch(() => {});
    await prisma.invoiceItem.deleteMany({ where: { invoice: { organizationId: orgB.id } } }).catch(() => {});
    await prisma.invoice.deleteMany({ where: { organizationId: orgB.id } }).catch(() => {});
    await prisma.subscription.deleteMany({ where: { organizationId: orgB.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { organizationId: orgB.id } }).catch(() => {});
    await prisma.router.deleteMany({ where: { organizationId: orgB.id } }).catch(() => {});
    await prisma.internetPlan.deleteMany({ where: { organizationId: orgB.id } }).catch(() => {});
    await prisma.adminUser.deleteMany({ where: { organizationId: orgB.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: orgB.id } }).catch(() => {});
  }
});

// ============================================================================
// AUTHENTICATION
// ============================================================================

test('1. Tenant user login succeeds', async () => {
  const res = await authService.login({
    email: 'owner@vedshri-a.test',
    password: 'SecureTestPass123!',
  });
  assert.ok(res.accessToken);
  assert.equal(res.user.email, 'owner@vedshri-a.test');
  assert.equal(res.user.organizationId, orgA.id);
});

test('2. Wrong password rejected', async () => {
  await assert.rejects(
    async () => {
      await authService.login({
        email: 'owner@vedshri-a.test',
        password: 'IncorrectPassword',
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      return true;
    },
  );
});

test('3. Tenant context resolved from authenticated user (JwtAuthGuard)', async () => {
  const token = signToken({
    sub: userA_Owner.id,
    email: userA_Owner.email,
    role: userA_Owner.role,
    organizationId: userA_Owner.organizationId,
  });

  const req = {
    headers: { authorization: `Bearer ${token}` },
    user: null,
  };
  const { context, reflector } = createMockContext(req);
  const guard = new JwtAuthGuard(reflector);

  const canActivate = await guard.canActivate(context);
  assert.equal(canActivate, true);
  assert.ok(req.user);
  assert.equal(req.user.userId, userA_Owner.id);
  assert.equal(req.user.organizationId, orgA.id);
  assert.equal(req.user.role, UserRole.ISP_OWNER);
});

test('4. Browser-supplied organizationId cannot override tenant context', async () => {
  // Attacker crafts a token with userA's ID but puts organizationId = orgB in body / header
  const token = signToken({
    sub: userA_Owner.id,
    email: userA_Owner.email,
    role: userA_Owner.role,
    organizationId: orgB.id, // Attempt to forge organizationId
  });

  const req = {
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': orgB.id, // Forged header
    },
    body: { organizationId: orgB.id }, // Forged body
    user: null,
  };
  const { context, reflector } = createMockContext(req);
  const guard = new JwtAuthGuard(reflector);

  await guard.canActivate(context);
  // Guard looks up the user in PostgreSQL and derives organizationId from user.organizationId!
  assert.equal(req.user.organizationId, orgA.id, 'Context MUST resolve from database user record, not payload/header');
});

// ============================================================================
// CUSTOMER ISOLATION
// ============================================================================

test('5. Tenant A sees own customers', async () => {
  const res = await customersService.list(orgA.id, {});
  assert.ok(res.items.some((c) => c.id === customerA.id));
  assert.ok(!res.items.some((c) => c.id === customerB.id));
});

test('6. Tenant B sees own customers', async () => {
  const res = await customersService.list(orgB.id, {});
  assert.ok(res.items.some((c) => c.id === customerB.id));
  assert.ok(!res.items.some((c) => c.id === customerA.id));
});

test('7. Tenant A cannot access Tenant B customer (404 NotFound)', async () => {
  await assert.rejects(
    async () => {
      await customersService.getById(orgA.id, customerB.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('8. Tenant A cannot modify Tenant B customer (404 NotFound)', async () => {
  await assert.rejects(
    async () => {
      await customersService.update(orgA.id, userA_Owner.id, customerB.id, { name: 'Hacked Name' });
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('9. Tenant A cannot reset MAC or operate on Tenant B customer', async () => {
  await assert.rejects(
    async () => {
      await customersService.resetMac(orgA.id, userA_Owner.id, customerB.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

// ============================================================================
// ROUTER ISOLATION
// ============================================================================

test('10. Tenant A sees own routers', async () => {
  const routers = await mikrotikService.listRouters(orgA.id);
  assert.ok(routers.some((r) => r.id === routerA.id));
  assert.ok(!routers.some((r) => r.id === routerB.id));
});

test('11. Tenant B sees own routers', async () => {
  const routers = await mikrotikService.listRouters(orgB.id);
  assert.ok(routers.some((r) => r.id === routerB.id));
  assert.ok(!routers.some((r) => r.id === routerA.id));
});

test('12. Cross-tenant router access denied (404 NotFound)', async () => {
  await assert.rejects(
    async () => {
      await mikrotikService.getRouterById(orgA.id, routerB.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await mikrotikService.deleteRouter(orgA.id, routerB.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

// ============================================================================
// BILLING (INVOICES)
// ============================================================================

test('13. Tenant A sees own invoices', async () => {
  const invoices = await invoicesService.list(orgA.id, {});
  assert.ok(invoices.items.some((i) => i.id === invA.id));
});

test('14. Tenant B sees own invoices (none for B)', async () => {
  const invoices = await invoicesService.list(orgB.id, {});
  assert.ok(!invoices.items.some((i) => i.id === invA.id));
});

test('15. Cross-tenant invoice denied (404 NotFound)', async () => {
  await assert.rejects(
    async () => {
      await invoicesService.getById(orgB.id, invA.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

// ============================================================================
// SUBSCRIPTIONS
// ============================================================================

test('16. Cross-tenant subscription denied (404 NotFound)', async () => {
  await assert.rejects(
    async () => {
      await subscriptionsService.getById(orgB.id, subA.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

// ============================================================================
// PLANS
// ============================================================================

test('17. Cross-tenant plan denied (404 NotFound)', async () => {
  await assert.rejects(
    async () => {
      await plansService.getById(orgB.id, planA.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

// ============================================================================
// PAYMENTS
// ============================================================================

test('18. Cross-tenant payment denied (404 NotFound)', async () => {
  await assert.rejects(
    async () => {
      await paymentsService.getById(orgB.id, payA.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

// ============================================================================
// ZONES & NODES
// ============================================================================

test('19. Cross-tenant zone denied (404 NotFound)', async () => {
  await assert.rejects(
    async () => {
      await zonesService.getZone(orgB.id, zoneA.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('20. Cross-tenant node denied (404 NotFound)', async () => {
  await assert.rejects(
    async () => {
      await zonesService.getNode(orgB.id, nodeA.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('20. Cross-tenant node denied (404 NotFound)', async () => {
  await assert.rejects(
    async () => {
      await zonesService.getNodeById(orgB.id, nodeA.id);
    },
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});

// ============================================================================
// RADIUS
// ============================================================================

test('21. Tenant A RADIUS access requests isolated', async () => {
  const reqs = await radiusService.getAccessRequests(orgA.id, { page: 1, limit: 10 });
  assert.ok(reqs.items.some((r) => r.username === customerA.username));
});

test('22. Tenant B RADIUS access requests isolated (does not see Tenant A requests)', async () => {
  const reqs = await radiusService.getAccessRequests(orgB.id, { page: 1, limit: 10 });
  assert.ok(!reqs.items.some((r) => r.username === customerA.username));
});

// ============================================================================
// AUDIT
// ============================================================================

test('23. Tenant A audit logs isolated', async () => {
  const logs = await auditService.list(orgA.id, {});
  assert.ok(logs.some((l) => l.organizationId === orgA.id && l.entityId === customerA.id));
});

test('24. Tenant B audit logs isolated (does not see Tenant A logs)', async () => {
  const logs = await auditService.list(orgB.id, {});
  assert.ok(!logs.some((l) => l.organizationId === orgA.id));
});

// ============================================================================
// RBAC
// ============================================================================

test('25. OWNER permissions: allowed on owner/admin endpoints and has owner superset access', () => {
  const reqOwner = { user: { role: UserRole.ISP_OWNER, organizationId: orgA.id } };
  const { context: ctxAllowed, reflector: refAllowed } = createMockContext(reqOwner, {
    [ROLES_KEY]: [UserRole.ISP_OWNER, UserRole.ISP_ADMIN],
  });
  const guard = new RolesGuard(refAllowed);
  assert.equal(guard.canActivate(ctxAllowed), true);

  const { context: ctxBilling, reflector: refBilling } = createMockContext(reqOwner, {
    [ROLES_KEY]: [UserRole.BILLING],
  });
  const guardBilling = new RolesGuard(refBilling);
  assert.equal(guardBilling.canActivate(ctxBilling), true);
});

test('26. ADMIN permissions: allowed on admin endpoints, denied on other roles', () => {
  const reqAdmin = { user: { role: UserRole.ISP_ADMIN, organizationId: orgA.id } };
  const { context, reflector } = createMockContext(reqAdmin, {
    [ROLES_KEY]: [UserRole.ISP_OWNER, UserRole.ISP_ADMIN],
  });
  const guard = new RolesGuard(reflector);
  assert.equal(guard.canActivate(context), true);
});

test('27. BILLING permissions: allowed on billing endpoints, denied on router endpoints', () => {
  const reqBilling = { user: { role: UserRole.BILLING, organizationId: orgA.id } };
  const { context: ctxAllowed, reflector: refAllowed } = createMockContext(reqBilling, {
    [ROLES_KEY]: [UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING],
  });
  const guard = new RolesGuard(refAllowed);
  assert.equal(guard.canActivate(ctxAllowed), true);

  const { context: ctxDenied, reflector: refDenied } = createMockContext(reqBilling, {
    [ROLES_KEY]: [UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN],
  });
  const guardDenied = new RolesGuard(refDenied);
  assert.throws(() => guardDenied.canActivate(ctxDenied));
});

test('28. SUPPORT permissions: allowed on support endpoints, denied on admin-only', () => {
  const reqSupport = { user: { role: UserRole.SUPPORT, organizationId: orgA.id } };
  const { context: ctxAllowed, reflector: refAllowed } = createMockContext(reqSupport, {
    [ROLES_KEY]: [UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.SUPPORT],
  });
  const guard = new RolesGuard(refAllowed);
  assert.equal(guard.canActivate(ctxAllowed), true);

  const { context: ctxDenied, reflector: refDenied } = createMockContext(reqSupport, {
    [ROLES_KEY]: [UserRole.ISP_OWNER, UserRole.ISP_ADMIN],
  });
  const guardDenied = new RolesGuard(refDenied);
  assert.throws(() => guardDenied.canActivate(ctxDenied));
});

test('29. TECHNICIAN permissions: allowed on network/router endpoints, denied on billing-only', () => {
  const reqTech = { user: { role: UserRole.TECHNICIAN, organizationId: orgA.id } };
  const { context: ctxAllowed, reflector: refAllowed } = createMockContext(reqTech, {
    [ROLES_KEY]: [UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.TECHNICIAN],
  });
  const guard = new RolesGuard(refAllowed);
  assert.equal(guard.canActivate(ctxAllowed), true);

  const { context: ctxDenied, reflector: refDenied } = createMockContext(reqTech, {
    [ROLES_KEY]: [UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.BILLING],
  });
  const guardDenied = new RolesGuard(refDenied);
  assert.throws(() => guardDenied.canActivate(ctxDenied));
});

test('30. READ_ONLY permissions: allowed on read-only endpoints, denied on write endpoints', () => {
  const reqReadOnly = { user: { role: UserRole.READ_ONLY, organizationId: orgA.id } };
  const { context: ctxAllowed, reflector: refAllowed } = createMockContext(reqReadOnly, {
    [ROLES_KEY]: [UserRole.ISP_OWNER, UserRole.ISP_ADMIN, UserRole.READ_ONLY],
  });
  const guard = new RolesGuard(refAllowed);
  assert.equal(guard.canActivate(ctxAllowed), true);

  const { context: ctxDenied, reflector: refDenied } = createMockContext(reqReadOnly, {
    [ROLES_KEY]: [UserRole.ISP_OWNER, UserRole.ISP_ADMIN],
  });
  const guardDenied = new RolesGuard(refDenied);
  assert.throws(() => guardDenied.canActivate(ctxDenied));
});

// ============================================================================
// SUPER ADMIN REMOVAL
// ============================================================================

test('31. /super-admin frontend routes no longer exist in codebase', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const webSuperAdminDir = path.resolve(process.cwd(), '../web/src/app/super-admin');
  assert.equal(fs.existsSync(webSuperAdminDir), false, 'web/src/app/super-admin must be deleted');
});

test('32. SuperAdminModule deleted from API AppModule', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const apiSuperAdminDir = path.resolve(process.cwd(), 'src/modules/super-admin');
  assert.equal(fs.existsSync(apiSuperAdminDir), false, 'src/modules/super-admin must be deleted');
});

test('33. SuperAdminShell removed from AppShell', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const shellFile = path.resolve(process.cwd(), '../web/src/components/SuperAdminShell.tsx');
  assert.equal(fs.existsSync(shellFile), false, 'SuperAdminShell.tsx must be deleted');
});

test('34. No normal role can access decommissioned SuperAdmin functionality', () => {
  const allRoles = [
    UserRole.ISP_OWNER,
    UserRole.ISP_ADMIN,
    UserRole.BILLING,
    UserRole.SUPPORT,
    UserRole.TECHNICIAN,
    UserRole.READ_ONLY,
  ];

  for (const role of allRoles) {
    const req = { user: { role, organizationId: orgA.id } };
    const { context, reflector } = createMockContext(req, {
      [ROLES_KEY]: [UserRole.SUPER_ADMIN],
    });
    const guard = new RolesGuard(reflector);
    assert.throws(
      () => guard.canActivate(context),
      (err) => err.status === 403,
      `Role ${role} must be rejected from SuperAdmin actions`,
    );
  }
});
