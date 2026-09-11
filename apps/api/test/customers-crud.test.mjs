import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { CustomerStatus, AuditAction } from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';

const authService = new AuthService();
const customersService = new CustomersService();

test('Customer Management: Full Lifecycle, Pagination, Filters, Audit Logging', async (t) => {
  const ts = Date.now();

  // 1. Setup Tenant Organization and Admin User
  const orgResult = await authService.registerOrganization({
    name: `FastNet ISP ${ts}`,
    slug: `fastnet-${ts}`,
    email: `contact@fastnet-${ts}.com`,
    phone: '9876500001',
    ownerName: 'FastNet Admin',
    ownerEmail: `admin.${ts}@fastnet.com`,
    ownerPassword: 'Password123!',
  });
  const orgId = orgResult.user.organizationId;
  const adminUserId = orgResult.user.id;

  // 2. Create customer with all 15 fields
  const installDate = new Date('2026-03-01T10:00:00.000Z');
  const initialData = {
    customerCode: `CUST-${ts}-01`,
    name: 'Amit Patel',
    mobile: '9820011223',
    email: `amit.${ts}@gmail.com`,
    address: 'Flat 301, Sunrise Heights, Link Road',
    area: 'Andheri West',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400053',
    username: `amit_patel_${ts}`,
    pppoePassword: 'SecurePassword123',
    status: CustomerStatus.LEAD,
    installationDate: installDate.toISOString(),
    notes: 'Inquired for 100Mbps fiber connection during apartment drive',
  };

  const createdCustomer = await customersService.create(orgId, adminUserId, initialData);

  // Validate all 15 required customer fields
  assert.ok(createdCustomer.id, 'Customer must have an id');
  assert.equal(createdCustomer.organizationId, orgId, 'organizationId must match tenant');
  assert.equal(createdCustomer.customerCode, initialData.customerCode);
  assert.equal(createdCustomer.name, initialData.name);
  assert.equal(createdCustomer.mobile, initialData.mobile);
  assert.equal(createdCustomer.email, initialData.email);
  assert.equal(createdCustomer.address, initialData.address);
  assert.equal(createdCustomer.area, initialData.area);
  assert.equal(createdCustomer.city, initialData.city);
  assert.equal(createdCustomer.state, initialData.state);
  assert.equal(createdCustomer.pincode, initialData.pincode);
  assert.equal(createdCustomer.username, initialData.username);
  assert.equal(createdCustomer.status, CustomerStatus.LEAD);
  assert.ok(createdCustomer.installationDate, 'installationDate must be present');
  assert.equal(createdCustomer.notes, initialData.notes);

  // Verify CREATE audit log was recorded
  const createAudit = await prisma.auditLog.findFirst({
    where: {
      organizationId: orgId,
      entityType: 'CUSTOMER',
      entityId: createdCustomer.id,
      action: AuditAction.CREATE,
    },
  });
  assert.ok(createAudit, 'CREATE audit log must be recorded');
  assert.equal(createAudit.adminUserId, adminUserId);
  assert.equal((createAudit.details).customerCode, initialData.customerCode);
  assert.equal((createAudit.details).status, CustomerStatus.LEAD);

  // 3. Create additional customers for pagination and filter testing
  const statuses = [
    CustomerStatus.PENDING,
    CustomerStatus.ACTIVE,
    CustomerStatus.SUSPENDED,
    CustomerStatus.EXPIRED,
    CustomerStatus.TERMINATED,
  ];

  for (let i = 0; i < statuses.length; i++) {
    await customersService.create(orgId, adminUserId, {
      customerCode: `CUST-${ts}-0${i + 2}`,
      name: `Subscriber ${i + 2} ${ts}`,
      mobile: `982001122${i + 4}`,
      email: `sub${i + 2}.${ts}@example.com`,
      address: `Tower B, Flat ${100 * (i + 1)}`,
      area: i % 2 === 0 ? 'Bandra' : 'Andheri West',
      city: i % 2 === 0 ? 'Mumbai' : 'Pune',
      state: 'Maharashtra',
      pincode: '400050',
      username: `sub_${ts}_${i + 2}`,
      status: statuses[i],
      notes: `Test subscriber with status ${statuses[i]}`,
    });
  }

  // 4. Test Server-side Pagination
  // Total customers in this org = 1 + 5 = 6
  const page1 = await customersService.list(orgId, { page: 1, limit: 2 });
  assert.equal(page1.items.length, 2);
  assert.equal(page1.total, 6);
  assert.equal(page1.page, 1);
  assert.equal(page1.limit, 2);
  assert.equal(page1.totalPages, 3);

  const page2 = await customersService.list(orgId, { page: 2, limit: 2 });
  assert.equal(page2.items.length, 2);
  assert.equal(page2.page, 2);
  // Verify items on page 1 and page 2 are different
  const page1Ids = page1.items.map((c) => c.id);
  const page2Ids = page2.items.map((c) => c.id);
  for (const id of page2Ids) {
    assert.ok(!page1Ids.includes(id), 'Page 2 items must not overlap with Page 1');
  }

  // 5. Test Search across multiple fields
  // Search by customerCode
  const searchByCode = await customersService.list(orgId, { search: `CUST-${ts}-01` });
  assert.equal(searchByCode.items.length, 1);
  assert.equal(searchByCode.items[0].customerCode, `CUST-${ts}-01`);

  // Search by name
  const searchByName = await customersService.list(orgId, { search: 'Amit Patel' });
  assert.equal(searchByName.items.length, 1);
  assert.equal(searchByName.items[0].name, 'Amit Patel');

  // Search by mobile
  const searchByMobile = await customersService.list(orgId, { search: '9820011223' });
  assert.equal(searchByMobile.items.length, 1);
  assert.equal(searchByMobile.items[0].username, `amit_patel_${ts}`);

  // 6. Test Filtering by Status, Area, and City
  // Filter by status = LEAD
  const filterLead = await customersService.list(orgId, { status: CustomerStatus.LEAD });
  assert.equal(filterLead.items.length, 1);
  assert.equal(filterLead.items[0].status, CustomerStatus.LEAD);

  // Filter by status = SUSPENDED
  const filterSuspended = await customersService.list(orgId, { status: CustomerStatus.SUSPENDED });
  assert.equal(filterSuspended.items.length, 1);
  assert.equal(filterSuspended.items[0].status, CustomerStatus.SUSPENDED);

  // Filter by area
  const filterBandra = await customersService.list(orgId, { area: 'Bandra' });
  for (const c of filterBandra.items) {
    assert.equal(c.area, 'Bandra');
  }

  // Filter by city
  const filterPune = await customersService.list(orgId, { city: 'Pune' });
  for (const c of filterPune.items) {
    assert.equal(c.city, 'Pune');
  }

  // 7. Test Customer Edit (Update) and UPDATE Audit Log
  const editUpdate = await customersService.update(orgId, adminUserId, createdCustomer.id, {
    name: 'Amit K. Patel',
    address: 'Penthouse 1201, Sunrise Heights',
    notes: 'Upgraded to premium inquiries after site visit',
  });
  assert.equal(editUpdate.name, 'Amit K. Patel');
  assert.equal(editUpdate.address, 'Penthouse 1201, Sunrise Heights');
  assert.equal(editUpdate.notes, 'Upgraded to premium inquiries after site visit');

  const updateAudit = await prisma.auditLog.findFirst({
    where: {
      organizationId: orgId,
      entityType: 'CUSTOMER',
      entityId: createdCustomer.id,
      action: AuditAction.UPDATE,
    },
  });
  assert.ok(updateAudit, 'UPDATE audit log must be recorded');
  assert.equal(updateAudit.adminUserId, adminUserId);

  // 8. Test Status Transitions and STATUS_CHANGE Audit Logs
  // Transition LEAD -> PENDING
  await customersService.updateStatus(
    orgId,
    adminUserId,
    createdCustomer.id,
    CustomerStatus.PENDING,
    'Feasibility approved, pending physical fiber line cabling',
  );

  // Transition PENDING -> ACTIVE
  await customersService.updateStatus(
    orgId,
    adminUserId,
    createdCustomer.id,
    CustomerStatus.ACTIVE,
    'ONU installed and fiber optical signal verified (-19 dBm)',
  );

  // Transition ACTIVE -> SUSPENDED
  await customersService.updateStatus(
    orgId,
    adminUserId,
    createdCustomer.id,
    CustomerStatus.SUSPENDED,
    'Subscriber requested temporary holiday suspension',
  );

  // Transition SUSPENDED -> EXPIRED
  await customersService.updateStatus(
    orgId,
    adminUserId,
    createdCustomer.id,
    CustomerStatus.EXPIRED,
    'Validity elapsed without renewal payment',
  );

  // Transition EXPIRED -> TERMINATED
  await customersService.updateStatus(
    orgId,
    adminUserId,
    createdCustomer.id,
    CustomerStatus.TERMINATED,
    'Subscriber relocated, fiber ONU retrieved',
  );

  // Check STATUS_CHANGE audit logs
  const statusAudits = await prisma.auditLog.findMany({
    where: {
      organizationId: orgId,
      entityType: 'CUSTOMER',
      entityId: createdCustomer.id,
      action: AuditAction.STATUS_CHANGE,
    },
    orderBy: { createdAt: 'asc' },
  });

  assert.equal(statusAudits.length, 5, 'Must record 5 STATUS_CHANGE audit logs');
  assert.equal((statusAudits[0].details).oldStatus, CustomerStatus.LEAD);
  assert.equal((statusAudits[0].details).newStatus, CustomerStatus.PENDING);

  assert.equal((statusAudits[1].details).oldStatus, CustomerStatus.PENDING);
  assert.equal((statusAudits[1].details).newStatus, CustomerStatus.ACTIVE);

  assert.equal((statusAudits[2].details).oldStatus, CustomerStatus.ACTIVE);
  assert.equal((statusAudits[2].details).newStatus, CustomerStatus.SUSPENDED);

  assert.equal((statusAudits[3].details).oldStatus, CustomerStatus.SUSPENDED);
  assert.equal((statusAudits[3].details).newStatus, CustomerStatus.EXPIRED);

  assert.equal((statusAudits[4].details).oldStatus, CustomerStatus.EXPIRED);
  assert.equal((statusAudits[4].details).newStatus, CustomerStatus.TERMINATED);

  // 9. Customer Details View (getById)
  const details = await customersService.getById(orgId, createdCustomer.id);
  assert.equal(details.id, createdCustomer.id);
  assert.equal(details.status, CustomerStatus.TERMINATED);
  assert.ok(Array.isArray(details.auditLogs), 'Customer details must contain auditLogs array');
  assert.ok(details.auditLogs.length >= 7, 'Must contain CREATE, UPDATE, and 5 STATUS_CHANGE audit logs');
  assert.equal(details.auditLogs[0].adminUser.id, adminUserId);
});
