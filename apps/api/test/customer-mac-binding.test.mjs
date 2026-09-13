import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { CustomersService } from '../dist/modules/customers/customers.service.js';
import { PlansService } from '../dist/modules/plans/plans.service.js';
import { CustomerStatus } from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';
import { getRadiusUsernameCandidates } from '@isp-crm/shared';

const authService = new AuthService();
const customersService = new CustomersService();
const plansService = new PlansService();

test('Phase 10 Step 2: One-User-One-MAC FreeRADIUS Synchronization & Tenant Isolation', async (t) => {
  const ts = Date.now();

  // 1. Setup Tenant Organization A
  const orgResultA = await authService.registerOrganization({
    name: `Netlink ISP A ${ts}`,
    slug: `netlink-a-${ts}`,
    email: `admin.${ts}@netlink-a.com`,
    phone: '9876543210',
    ownerName: 'Owner A',
    ownerEmail: `owner.${ts}@netlink-a.com`,
    ownerPassword: 'Password123!',
  });
  const orgIdA = orgResultA.user.organizationId;

  // Setup Tenant Organization B for Tenant Isolation Verification
  const orgResultB = await authService.registerOrganization({
    name: `Netlink ISP B ${ts}`,
    slug: `netlink-b-${ts}`,
    email: `admin.${ts}@netlink-b.com`,
    phone: '9876543211',
    ownerName: 'Owner B',
    ownerEmail: `owner.${ts}@netlink-b.com`,
    ownerPassword: 'Password123!',
  });
  const orgIdB = orgResultB.user.organizationId;

  // Create Internet Plan in Org A
  const planA = await plansService.create(orgIdA, {
    name: '50 Mbps Fiber',
    code: `FIBER50_${ts}`,
    downloadSpeedMbps: 50,
    uploadSpeedMbps: 25,
    validityDays: 30,
    price: 499,
    gstRatePercent: 18.0,
  });

  let custWithMac;
  let custNoMac;

  await t.test('1. Create customer with MAC -> canonical MAC persisted + radcheck Calling-Station-Id created', async () => {
    const username = `mac_user_1_${ts}`;
    const inputMac = '0a:f8:44:0e:8c:17'; // Lowercase colon notation
    const expectedCanonical = '0A:F8:44:0E:8C:17';

    custWithMac = await customersService.create(orgIdA, {
      name: 'MAC Subscriber 1',
      customerCode: `CUST-MAC1-${ts}`,
      mobile: '9811111111',
      address: '100 Cyber City, Pune',
      username,
      pppoePassword: 'testPassword123!',
      macAddress: inputMac,
      planId: planA.id,
    });

    // Verify canonical format in returned DTO
    assert.equal(custWithMac.macAddress, expectedCanonical);

    // Verify DB persistence
    const dbCust = await prisma.customer.findUnique({ where: { id: custWithMac.id } });
    assert.equal(dbCust.macAddress, expectedCanonical);

    // Verify FreeRADIUS radcheck entries for all candidate usernames (base + realm)
    const candidates = getRadiusUsernameCandidates(username);
    assert.ok(candidates.length >= 2, 'Must have at least clean and @ispcrm candidates');

    for (const cand of candidates) {
      const macCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Calling-Station-Id' },
      });
      assert.ok(macCheck, `radcheck Calling-Station-Id record must exist for candidate ${cand}`);
      assert.equal(macCheck.op, '==');
      assert.equal(macCheck.value, expectedCanonical);

      const passCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Cleartext-Password' },
      });
      assert.ok(passCheck, `radcheck Cleartext-Password record must exist for candidate ${cand}`);
      assert.equal(passCheck.value, 'testPassword123!');
    }
  });

  await t.test('2. Create customer without MAC -> existing behavior preserved (no Calling-Station-Id in radcheck)', async () => {
    const username = `nomac_user_${ts}`;

    custNoMac = await customersService.create(orgIdA, {
      name: 'No MAC Subscriber',
      customerCode: `CUST-NOMAC-${ts}`,
      mobile: '9822222222',
      address: '200 Cyber City, Pune',
      username,
      pppoePassword: 'testPassword456!',
      planId: planA.id,
    });

    assert.equal(custNoMac.macAddress, null);

    const dbCust = await prisma.customer.findUnique({ where: { id: custNoMac.id } });
    assert.equal(dbCust.macAddress, null);

    const candidates = getRadiusUsernameCandidates(username);
    for (const cand of candidates) {
      const macCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Calling-Station-Id' },
      });
      assert.equal(macCheck, null, 'Must NOT create Calling-Station-Id check for customer without MAC');

      const passCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Cleartext-Password' },
      });
      assert.ok(passCheck, 'Password check must still exist');
    }
  });

  await t.test('3. Update unbound customer with MAC -> binding created', async () => {
    const newMac = 'aa-bb-cc-dd-ee-ff'; // Hyphen notation
    const expectedCanonical = 'AA:BB:CC:DD:EE:FF';

    const updated = await customersService.update(orgIdA, custNoMac.id, {
      macAddress: newMac,
    });

    assert.equal(updated.macAddress, expectedCanonical);

    const dbCust = await prisma.customer.findUnique({ where: { id: custNoMac.id } });
    assert.equal(dbCust.macAddress, expectedCanonical);

    const candidates = getRadiusUsernameCandidates(custNoMac.username);
    for (const cand of candidates) {
      const macCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Calling-Station-Id' },
      });
      assert.ok(macCheck, `radcheck Calling-Station-Id record must exist for candidate ${cand}`);
      assert.equal(macCheck.op, '==');
      assert.equal(macCheck.value, expectedCanonical);
    }
  });

  await t.test('4. Update customer from MAC A -> MAC B -> old check removed and new check created', async () => {
    const updatedMac = 'aabb.ccdd.eeff'; // Cisco dot notation
    const expectedCanonical = 'AA:BB:CC:DD:EE:FF';
    const newMac = '11:22:33:44:55:66';

    const updated = await customersService.update(orgIdA, custWithMac.id, {
      macAddress: newMac,
    });

    assert.equal(updated.macAddress, newMac);

    const candidates = getRadiusUsernameCandidates(custWithMac.username);
    for (const cand of candidates) {
      // Old check should not exist
      const oldCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Calling-Station-Id', value: '0A:F8:44:0E:8C:17' },
      });
      assert.equal(oldCheck, null, 'Old MAC check must be removed');

      // New check must exist
      const newCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Calling-Station-Id' },
      });
      assert.ok(newCheck, 'New MAC check must exist');
      assert.equal(newCheck.op, '==');
      assert.equal(newCheck.value, newMac);
    }
  });

  await t.test('5. Explicitly clear MAC -> Customer.macAddress null + MAC check removed', async () => {
    const updated = await customersService.update(orgIdA, custWithMac.id, {
      macAddress: null,
    });

    assert.equal(updated.macAddress, null);

    const dbCust = await prisma.customer.findUnique({ where: { id: custWithMac.id } });
    assert.equal(dbCust.macAddress, null);

    const candidates = getRadiusUsernameCandidates(custWithMac.username);
    for (const cand of candidates) {
      const macCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Calling-Station-Id' },
      });
      assert.equal(macCheck, null, 'All Calling-Station-Id checks must be removed when MAC is cleared');
    }
  });

  await t.test('6. Update unrelated customer fields without macAddress -> existing MAC remains unchanged', async () => {
    // First re-assign a MAC to custWithMac
    const testMac = '22:33:44:55:66:77';
    await customersService.update(orgIdA, custWithMac.id, { macAddress: testMac });

    // Update only address and name (omitting macAddress)
    const updated = await customersService.update(orgIdA, custWithMac.id, {
      name: 'Renamed Customer',
      address: '999 New Road, Pune',
    });

    assert.equal(updated.name, 'Renamed Customer');
    assert.equal(updated.macAddress, testMac, 'macAddress must remain intact when not supplied in update');

    const dbCust = await prisma.customer.findUnique({ where: { id: custWithMac.id } });
    assert.equal(dbCust.macAddress, testMac);

    const candidates = getRadiusUsernameCandidates(custWithMac.username);
    for (const cand of candidates) {
      const macCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Calling-Station-Id' },
      });
      assert.ok(macCheck, 'MAC check must still exist');
      assert.equal(macCheck.value, testMac);
    }
  });

  await t.test('7. Reactivate customer with MAC -> MAC check restored', async () => {
    // Suspend customer
    const suspendRes = await customersService.suspend(orgIdA, custWithMac.id);
    assert.equal(suspendRes.customer.status, CustomerStatus.SUSPENDED);

    // Verify radcheck password was locked
    const candidates = getRadiusUsernameCandidates(custWithMac.username);
    const radSuspended = await prisma.radCheck.findFirst({
      where: { username: candidates[0], attribute: 'Cleartext-Password' },
    });
    assert.match(radSuspended.value, /^SUSPENDED_/);

    // Reactivate customer
    const reactivateRes = await customersService.reactivate(orgIdA, custWithMac.id);
    assert.equal(reactivateRes.customer.status, CustomerStatus.ACTIVE);

    // Verify Calling-Station-Id check is restored
    for (const cand of candidates) {
      const macCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Calling-Station-Id' },
      });
      assert.ok(macCheck, `Calling-Station-Id must be restored upon reactivation for ${cand}`);
      assert.equal(macCheck.op, '==');
      assert.equal(macCheck.value, '22:33:44:55:66:77');

      const passCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Cleartext-Password' },
      });
      assert.equal(passCheck.value, 'testPassword123!', 'Password must be restored');
    }
  });

  await t.test('8. Reactivate customer without MAC -> no MAC check', async () => {
    // Clear MAC on custNoMac first
    await customersService.update(orgIdA, custNoMac.id, { macAddress: '' });

    // Suspend
    await customersService.suspend(orgIdA, custNoMac.id);

    // Reactivate
    const reactivateRes = await customersService.reactivate(orgIdA, custNoMac.id);
    assert.equal(reactivateRes.customer.status, CustomerStatus.ACTIVE);

    // Verify no MAC check exists
    const candidates = getRadiusUsernameCandidates(custNoMac.username);
    for (const cand of candidates) {
      const macCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Calling-Station-Id' },
      });
      assert.equal(macCheck, null, 'Must NOT create MAC check on reactivation if customer has no bound MAC');

      const passCheck = await prisma.radCheck.findFirst({
        where: { username: cand, attribute: 'Cleartext-Password' },
      });
      assert.equal(passCheck.value, 'testPassword456!');
    }
  });

  await t.test('9. Correct tenant isolation', async () => {
    // Customer in Org B
    const custB = await customersService.create(orgIdB, {
      name: 'Org B Customer',
      customerCode: `CUST-ORGB-${ts}`,
      mobile: '9833333333',
      address: 'Org B Address',
      username: `org_b_sub_${ts}`,
      pppoePassword: 'passwordB123!',
      macAddress: '33:44:55:66:77:88',
    });

    // Org A cannot update Org B customer
    await assert.rejects(
      async () => {
        await customersService.update(orgIdA, custB.id, { macAddress: '99:99:99:99:99:99' });
      },
      (err) => err.status === 404 || err.name === 'NotFoundException'
    );

    // Org B customer's MAC and radcheck remains unchanged
    const custBAfter = await prisma.customer.findUnique({ where: { id: custB.id } });
    assert.equal(custBAfter.macAddress, '33:44:55:66:77:88');

    const checkB = await prisma.radCheck.findFirst({
      where: { username: custB.username, attribute: 'Calling-Station-Id' },
    });
    assert.equal(checkB.value, '33:44:55:66:77:88');
  });

  await t.test('10. Invalid MAC format rejection', async () => {
    // Invalid characters in create
    await assert.rejects(
      async () => {
        await customersService.create(orgIdA, {
          name: 'Invalid MAC Customer',
          customerCode: `CUST-INV-${ts}`,
          mobile: '9844444444',
          address: 'Test Address',
          username: `inv_mac_${ts}`,
          pppoePassword: 'password123!',
          macAddress: '00:11:22:33:44:GG',
        });
      },
      (err) => err.status === 400 || err.name === 'BadRequestException'
    );

    // Invalid length in update
    await assert.rejects(
      async () => {
        await customersService.update(orgIdA, custWithMac.id, {
          macAddress: '00:11:22',
        });
      },
      (err) => err.status === 400 || err.name === 'BadRequestException'
    );
  });
});
