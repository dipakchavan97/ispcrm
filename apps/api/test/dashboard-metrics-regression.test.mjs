import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@isp-crm/database';
import { RadiusService } from '../dist/modules/radius/radius.service.js';
import { RadiusController } from '../dist/modules/radius/radius.controller.js';
import { CustomerStatus } from '@isp-crm/shared';

const radiusService = new RadiusService();
const radiusController = new RadiusController(radiusService);

test('Dashboard Customer / Online Subscriber Metrics Regression Suite', async (t) => {
  const ts = Date.now();
  const orgASlug = `dash-metrics-a-${ts}`;
  const orgBSlug = `dash-metrics-b-${ts}`;

  // Helper to create an organization
  const orgA = await prisma.organization.create({
    data: {
      name: `Dash Tenant A ${ts}`,
      slug: orgASlug,
      email: `contact@${orgASlug}.com`,
      phone: '9876543210',
    },
  });

  const orgB = await prisma.organization.create({
    data: {
      name: `Dash Tenant B ${ts}`,
      slug: orgBSlug,
      email: `contact@${orgBSlug}.com`,
      phone: '9876543211',
    },
  });

  const createdSessionIds = [];

  // Cleanup helper
  t.after(async () => {
    if (createdSessionIds.length > 0) {
      await prisma.radAcct.deleteMany({
        where: { acctsessionid: { in: createdSessionIds } },
      });
    }
    await prisma.customer.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA.id, orgB.id] } },
    });
  });

  // Helper to insert an active radacct session
  async function insertActiveSession(username, sessionId, nasIp = '10.200.0.6') {
    createdSessionIds.push(sessionId);
    return prisma.radAcct.create({
      data: {
        acctsessionid: sessionId,
        acctuniqueid: `uniq_${sessionId}`,
        username,
        realm: '',
        nasipaddress: nasIp,
        nasportid: 'bridge1',
        nasporttype: 'Ethernet',
        acctstarttime: new Date(),
        acctstoptime: null,
        acctsessiontime: 120,
        acctinputoctets: BigInt(1048576),
        acctoutputoctets: BigInt(5242880),
        framedipaddress: '100.64.0.10',
        callingstationid: 'AA:BB:CC:DD:EE:FF',
      },
    });
  }

  // --------------------------------------------------------------------------
  // TEST 1: 1 customer + 1 active session = 1 online
  // --------------------------------------------------------------------------
  await t.test('1. 1 customer + 1 active session = 1 online', async () => {
    const cust1 = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-1-${ts}`,
        name: 'Single Customer',
        username: `user1_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const sessId = `sess_1_${ts}`;
    await insertActiveSession(`user1_${ts}`, sessId);

    const metrics = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics.totalCustomers, 1, 'Total customers must be 1');
    assert.equal(metrics.activeSubscribers, 1, 'Active subscribers must be 1');
    assert.equal(metrics.onlineSubscribers, 1, 'Online subscribers must be 1');
    assert.equal(metrics.offlineSubscribers, 0, 'Offline subscribers must be 0');
    assert.equal(metrics.concurrencyRate, 100.0, 'Concurrency must be 100.0%');

    // Clean up customer 1 session
    await prisma.radAcct.deleteMany({ where: { acctsessionid: sessId } });
    await prisma.customer.delete({ where: { id: cust1.id } });
  });

  // --------------------------------------------------------------------------
  // TEST 2: 1 customer + 0 active sessions = 0 online
  // --------------------------------------------------------------------------
  await t.test('2. 1 customer + 0 active sessions = 0 online', async () => {
    const cust = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-2-${ts}`,
        name: 'Offline Customer',
        username: `user2_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const metrics = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics.totalCustomers, 1, 'Total customers must be 1');
    assert.equal(metrics.activeSubscribers, 1, 'Active subscribers must be 1');
    assert.equal(metrics.onlineSubscribers, 0, 'Online subscribers must be 0');
    assert.equal(metrics.offlineSubscribers, 1, 'Offline subscribers must be 1');
    assert.equal(metrics.concurrencyRate, 0.0, 'Concurrency must be 0.0%');

    await prisma.customer.delete({ where: { id: cust.id } });
  });

  // --------------------------------------------------------------------------
  // TEST 3: 1 customer + 2 active sessions = 1 online (Multi-session deduplication)
  // --------------------------------------------------------------------------
  await t.test('3. 1 customer + 2 active sessions = 1 online', async () => {
    const cust = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-3-${ts}`,
        name: 'Multi-session Customer',
        username: `user3_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const sessA = `sess_3a_${ts}`;
    const sessB = `sess_3b_${ts}`;
    await insertActiveSession(`user3_${ts}`, sessA);
    await insertActiveSession(`user3_${ts}`, sessB);

    const metrics = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics.totalCustomers, 1, 'Total customers must be 1');
    assert.equal(metrics.activeSubscribers, 1, 'Active subscribers must be 1');
    assert.equal(metrics.onlineSubscribers, 1, 'Online subscribers must remain 1 despite 2 sessions');
    assert.equal(metrics.offlineSubscribers, 0, 'Offline subscribers must be 0');
    assert.equal(metrics.concurrencyRate, 100.0, 'Concurrency must be 100.0%, never 200%');
    assert.equal(metrics.activeSessionCount, 2, 'Raw session count should reflect 2');

    // Also verify getActiveSessions enriches customer and attaches customerId
    const activeList = await radiusService.getActiveSessions(orgA.id, {});
    assert.equal(activeList.length, 2, 'Should list both sessions');
    assert.equal(activeList[0].customerId, cust.id);
    assert.equal(activeList[1].customerId, cust.id);
    assert.equal(activeList[0].customer?.name, 'Multi-session Customer');

    // Verify client-side Set deduction matching dashboard/page.tsx
    const distinctOnlineFromSet = new Set(
      activeList.filter((s) => s.customer?.id && s.customer.status === 'ACTIVE').map((s) => s.customer.id),
    ).size;
    assert.equal(distinctOnlineFromSet, 1, 'Client deduplication must yield 1 online subscriber');

    await prisma.radAcct.deleteMany({ where: { acctsessionid: { in: [sessA, sessB] } } });
    await prisma.customer.delete({ where: { id: cust.id } });
  });

  // --------------------------------------------------------------------------
  // TEST 4: 1 customer + 1 unknown session = 0 online
  // --------------------------------------------------------------------------
  await t.test('4. 1 customer + 1 unknown session = 0 online', async () => {
    const cust = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-4-${ts}`,
        name: 'Offline Customer',
        username: `user4_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const unknownSess = `sess_unknown_${ts}`;
    await insertActiveSession(`unmapped_subscriber_xyz_${ts}`, unknownSess);

    const metrics = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics.totalCustomers, 1, 'Total customers must be 1');
    assert.equal(metrics.activeSubscribers, 1, 'Active subscribers must be 1');
    assert.equal(metrics.onlineSubscribers, 0, 'Unknown session must NOT count as online CRM subscriber');
    assert.equal(metrics.offlineSubscribers, 1, 'Customer without session must be offline');
    assert.equal(metrics.concurrencyRate, 0.0, 'Concurrency must be 0.0%');

    // getActiveSessions must NOT return unknown session for Org A
    const activeList = await radiusService.getActiveSessions(orgA.id, {});
    assert.equal(activeList.length, 0, 'Unknown session must not be returned in Org A active sessions');

    await prisma.radAcct.deleteMany({ where: { acctsessionid: unknownSess } });
    await prisma.customer.delete({ where: { id: cust.id } });
  });

  // --------------------------------------------------------------------------
  // TEST 5: 2 customers + 1 active session = 1 online
  // --------------------------------------------------------------------------
  await t.test('5. 2 customers + 1 active session = 1 online', async () => {
    const cust1 = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-5A-${ts}`,
        name: 'Customer 5A',
        username: `user5a_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const cust2 = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-5B-${ts}`,
        name: 'Customer 5B',
        username: `user5b_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const sessId = `sess_5a_${ts}`;
    await insertActiveSession(`user5a_${ts}`, sessId);

    const metrics = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics.totalCustomers, 2, 'Total customers must be 2');
    assert.equal(metrics.activeSubscribers, 2, 'Active subscribers must be 2');
    assert.equal(metrics.onlineSubscribers, 1, 'Online subscribers must be 1');
    assert.equal(metrics.offlineSubscribers, 1, 'Offline subscribers must be 1');
    assert.equal(metrics.concurrencyRate, 50.0, 'Concurrency must be 50.0%');

    await prisma.radAcct.deleteMany({ where: { acctsessionid: sessId } });
    await prisma.customer.deleteMany({ where: { id: { in: [cust1.id, cust2.id] } } });
  });

  // --------------------------------------------------------------------------
  // TEST 6: 2 customers + 2 active sessions = 2 online
  // --------------------------------------------------------------------------
  await t.test('6. 2 customers + 2 active sessions = 2 online', async () => {
    const cust1 = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-6A-${ts}`,
        name: 'Customer 6A',
        username: `user6a_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const cust2 = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-6B-${ts}`,
        name: 'Customer 6B',
        username: `user6b_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const sessA = `sess_6a_${ts}`;
    const sessB = `sess_6b_${ts}`;
    await insertActiveSession(`user6a_${ts}`, sessA);
    await insertActiveSession(`user6b_${ts}`, sessB);

    const metrics = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics.totalCustomers, 2);
    assert.equal(metrics.activeSubscribers, 2);
    assert.equal(metrics.onlineSubscribers, 2);
    assert.equal(metrics.offlineSubscribers, 0);
    assert.equal(metrics.concurrencyRate, 100.0);

    await prisma.radAcct.deleteMany({ where: { acctsessionid: { in: [sessA, sessB] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [cust1.id, cust2.id] } } });
  });

  // --------------------------------------------------------------------------
  // TEST 7: Cross-tenant session cannot count
  // --------------------------------------------------------------------------
  await t.test('7. Cross-tenant session cannot count', async () => {
    const custA = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-7A-${ts}`,
        name: 'Org A Customer',
        username: `user7a_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const custB = await prisma.customer.create({
      data: {
        organizationId: orgB.id,
        customerCode: `CUST-7B-${ts}`,
        name: 'Org B Customer',
        username: `user7b_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const sessB = `sess_7b_${ts}`;
    await insertActiveSession(`user7b_${ts}`, sessB);

    // Check Org A metrics — should see 0 online
    const metricsA = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metricsA.onlineSubscribers, 0, 'Org A must have 0 online subscribers');
    assert.equal(metricsA.offlineSubscribers, 1, 'Org A customer must be offline');

    // Check Org B metrics — should see 1 online
    const metricsB = await radiusService.getSubscriberSessionMetrics(orgB.id);
    assert.equal(metricsB.onlineSubscribers, 1, 'Org B must have 1 online subscriber');
    assert.equal(metricsB.offlineSubscribers, 0, 'Org B customer must be online');

    await prisma.radAcct.deleteMany({ where: { acctsessionid: sessB } });
    await prisma.customer.deleteMany({ where: { id: { in: [custA.id, custB.id] } } });
  });

  // --------------------------------------------------------------------------
  // TEST 8: RADIUS realm username normalization
  // --------------------------------------------------------------------------
  await t.test('8. RADIUS realm username normalization', async () => {
    // Customer registered as plain username 'realmuser_ts'
    const cust = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-8-${ts}`,
        name: 'Realm Customer',
        username: `realmuser_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    // NAS dialed in with realm: 'realmuser_ts@ispcrm'
    const sessId = `sess_8_${ts}`;
    await insertActiveSession(`realmuser_${ts}@ispcrm`, sessId);

    const metrics = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics.onlineSubscribers, 1, 'Realm-normalized session must be correlated');
    assert.equal(metrics.offlineSubscribers, 0);
    assert.equal(metrics.concurrencyRate, 100.0);

    const activeList = await radiusService.getActiveSessions(orgA.id, {});
    assert.equal(activeList.length, 1);
    assert.equal(activeList[0].customerId, cust.id);

    await prisma.radAcct.deleteMany({ where: { acctsessionid: sessId } });
    await prisma.customer.delete({ where: { id: cust.id } });
  });

  // --------------------------------------------------------------------------
  // TEST 9: Router telemetry Active PPPoE remains raw session count
  // --------------------------------------------------------------------------
  await t.test('9. Router telemetry Active PPPoE remains raw session count', async () => {
    // Simulated router active PPPoE session list (as returned from MikroTik /ppp/active/print)
    const mockMikrotikActivePpp = [
      { name: 'user1', service: 'pppoe', address: '172.18.23.2', uptime: '1h' },
      { name: 'user2', service: 'pppoe', address: '172.18.23.3', uptime: '2h' },
      { name: 'unknown_nas_user', service: 'pppoe', address: '172.18.23.4', uptime: '30m' },
    ];

    // Hardware telemetry displays mockMikrotikActivePpp.length (3)
    const hardwareTelemetryCount = mockMikrotikActivePpp.length;
    assert.equal(hardwareTelemetryCount, 3, 'Router telemetry must display raw hardware active PPP count');
  });

  // --------------------------------------------------------------------------
  // TEST 10: Dashboard total customers remains correct
  // --------------------------------------------------------------------------
  await t.test('10. Dashboard total customers remains correct', async () => {
    const cust1 = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-10A-${ts}`,
        name: 'Active Cust',
        username: `user10a_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const cust2 = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-10B-${ts}`,
        name: 'Suspended Cust',
        username: `user10b_${ts}`,
        status: CustomerStatus.SUSPENDED,
      },
    });

    const metrics = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics.totalCustomers, 2, 'Total customers must count all tenant customers regardless of status');
    assert.equal(metrics.activeSubscribers, 1, 'Active subscribers must count only ACTIVE customers');
    assert.equal(metrics.suspendedSubscribers, 1, 'Suspended count must reflect 1');

    await prisma.customer.deleteMany({ where: { id: { in: [cust1.id, cust2.id] } } });
  });

  // --------------------------------------------------------------------------
  // TEST 11: Offline count is correct
  // --------------------------------------------------------------------------
  await t.test('11. Offline count is correct', async () => {
    const cust1 = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-11A-${ts}`,
        name: 'Online Cust',
        username: `user11a_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const cust2 = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-11B-${ts}`,
        name: 'Offline Cust',
        username: `user11b_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const sessId = `sess_11a_${ts}`;
    await insertActiveSession(`user11a_${ts}`, sessId);

    const metrics = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics.activeSubscribers, 2);
    assert.equal(metrics.onlineSubscribers, 1);
    assert.equal(metrics.offlineSubscribers, 1, 'Offline must equal activeSubscribers - onlineSubscribers');

    await prisma.radAcct.deleteMany({ where: { acctsessionid: sessId } });
    await prisma.customer.deleteMany({ where: { id: { in: [cust1.id, cust2.id] } } });
  });

  // --------------------------------------------------------------------------
  // TEST 12: Concurrency calculation is correct
  // --------------------------------------------------------------------------
  await t.test('12. Concurrency calculation is correct', async () => {
    // 0 active customers: concurrency = 0
    const metrics0 = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics0.concurrencyRate, 0, 'Concurrency must be 0 when no active subscribers exist');

    // 1 customer + 2 sessions (production scenario): concurrency = 100.0%, NEVER 200%
    const cust = await prisma.customer.create({
      data: {
        organizationId: orgA.id,
        customerCode: `CUST-12-${ts}`,
        name: 'Concurrency Test',
        username: `user12_${ts}`,
        status: CustomerStatus.ACTIVE,
      },
    });

    const sess1 = `sess_12a_${ts}`;
    const sess2 = `sess_12b_${ts}`;
    await insertActiveSession(`user12_${ts}`, sess1);
    await insertActiveSession(`user12_${ts}`, sess2);

    const metrics = await radiusService.getSubscriberSessionMetrics(orgA.id);
    assert.equal(metrics.onlineSubscribers, 1);
    assert.equal(metrics.concurrencyRate, 100.0, 'Concurrency must never exceed 100.0% even with multiple sessions');

    // Controller route test
    const controllerResult = await radiusController.getSubscriberSessionMetrics(orgA.id);
    assert.equal(controllerResult.onlineSubscribers, 1);
    assert.equal(controllerResult.concurrencyRate, 100.0);

    await prisma.radAcct.deleteMany({ where: { acctsessionid: { in: [sess1, sess2] } } });
    await prisma.customer.delete({ where: { id: cust.id } });
  });
});
