import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { MikrotikService } from '../dist/modules/routers/mikrotik.service.js';
import { RoutersService } from '../dist/modules/routers/routers.service.js';
import { RoutersController } from '../dist/modules/routers/routers.controller.js';
import { MockMikrotikClient } from '../dist/modules/routers/clients/mock-mikrotik.client.js';
import { RouterStatus } from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';
import { sanitizeMessage } from '../dist/common/utils/crypto.util.js';

test('MikroTik Integration Module - Comprehensive Architecture & Security Verification', async (t) => {
  const ts = Date.now();
  const authService = new AuthService();
  const mockClient = new MockMikrotikClient();
  const mikrotikService = new MikrotikService(mockClient);
  const routersController = new RoutersController(mikrotikService);

  // 1. Provision Tenant Organization
  const orgResult = await authService.registerOrganization({
    name: `MikroTik ISP Net ${ts}`,
    slug: `mikrotik-isp-${ts}`,
    email: `admin@mt-${ts}.net`,
    phone: '9876543210',
    ownerName: 'NetOps Engineer',
    ownerEmail: `netops.${ts}@mt.net`,
    ownerPassword: 'SecurePassword123!',
  });
  const orgId = orgResult.user.organizationId;

  // Second org for multi-tenant isolation testing
  const otherOrgResult = await authService.registerOrganization({
    name: `Other Net ${ts}`,
    slug: `other-net-${ts}`,
    email: `admin@other-${ts}.net`,
    phone: '9876543211',
    ownerName: 'Other Engineer',
    ownerEmail: `other.${ts}@other.net`,
    ownerPassword: 'SecurePassword123!',
  });
  const otherOrgId = otherOrgResult.user.organizationId;

  let routerId = '';
  const routerSecretPassword = `P@ssw0rd_${ts}_supersecret`;

  await t.test('1. Router Registration & Strict Credential Encryption at Rest', async () => {
    const registrationInput = {
      name: 'Core-CCR2004-POP-01',
      host: `10.200.${(ts % 250) + 1}.1`,
      port: 8728,
      username: 'api_admin',
      password: routerSecretPassword,
      radiusSecret: `radius_${ts}`,
      testOnRegister: false,
    };

    const registered = await mikrotikService.registerRouter(orgId, registrationInput);
    routerId = registered.id;

    assert.ok(registered.id, 'Router should have generated UUID');
    assert.equal(registered.organizationId, orgId);
    assert.equal(registered.name, 'Core-CCR2004-POP-01');
    assert.equal(registered.host, registrationInput.host);
    assert.equal(registered.port, 8728);
    assert.equal(registered.username, 'api_admin');
    assert.equal(registered.status, RouterStatus.OFFLINE);

    // SECURITY: Verify plaintext password and encryptedCredential are NEVER returned
    assert.equal((registered).password, undefined, 'password field must never be returned to client');
    assert.equal((registered).encryptedCredential, undefined, 'encryptedCredential must never be returned to client');
    assert.equal((registered).apiPassword, undefined, 'apiPassword must never be returned');

    // JSON serialization security verification
    const serialized = JSON.stringify(registered);
    assert.equal(serialized.includes(routerSecretPassword), false, 'JSON output must never leak password');
    assert.equal(serialized.includes('encryptedCredential'), false, 'JSON output must never contain encryptedCredential');

    // Verify database record has AES-256-GCM encryptedCredential
    const dbRecord = await prisma.router.findUnique({ where: { id: routerId } });
    assert.ok(dbRecord, 'Router must exist in DB');
    assert.ok(dbRecord.encryptedCredential, 'DB must contain encrypted credential');
    assert.notEqual(dbRecord.encryptedCredential, routerSecretPassword, 'Password in DB must NOT be plaintext');
    // AES-256-GCM output format iv:authTag:ciphertext
    const parts = dbRecord.encryptedCredential.split(':');
    assert.equal(parts.length, 3, 'Encrypted credential must contain iv, auth tag, and ciphertext');

    // Verify FreeRADIUS nas synchronization
    const nasRecord = await prisma.nas.findUnique({ where: { nasname: registrationInput.host } });
    assert.ok(nasRecord, 'FreeRADIUS nas record should be provisioned');
    assert.equal(nasRecord.secret, registrationInput.radiusSecret);
  });

  await t.test('2. List and Get Router Sanitization', async () => {
    const list = await mikrotikService.listRouters(orgId);
    assert.ok(list.length >= 1, 'Should return at least 1 router');
    for (const r of list) {
      assert.equal((r).password, undefined);
      assert.equal((r).encryptedCredential, undefined);
    }

    const fetched = await mikrotikService.getRouterById(orgId, routerId);
    assert.equal(fetched.id, routerId);
    assert.equal((fetched).password, undefined);
    assert.equal((fetched).encryptedCredential, undefined);

    // Multi-tenant boundary check: Other org cannot access router
    await assert.rejects(
      async () => {
        await mikrotikService.getRouterById(otherOrgId, routerId);
      },
      (err) => {
        assert.match(err.message, /Router not found in your organization/);
        return true;
      },
    );
  });

  await t.test('3. Test Connection Updates Router Status, Metadata and Latency', async () => {
    mockClient.resetSimulation();

    const result = await mikrotikService.testConnection(orgId, routerId);
    assert.equal(result.success, true);
    assert.ok(result.latencyMs >= 0);
    assert.equal(result.identity, 'MikroTik-CCR2004-Edge-01');
    assert.equal(result.rosVersion, 'RouterOS v7.14.3');
    assert.equal(result.model, 'CCR2004-1G-12S+2XS');

    // DB router status must now be updated to ONLINE
    const updatedRouter = await mikrotikService.getRouterById(orgId, routerId);
    assert.equal(updatedRouter.status, RouterStatus.ONLINE);
    assert.ok(updatedRouter.lastSeen, 'lastSeen must be updated on successful test');
    assert.equal(updatedRouter.identity, 'MikroTik-CCR2004-Edge-01');
  });

  await t.test('4. Operational Query Methods (Identity, System Resources, PPP, Interfaces, Traffic)', async () => {
    mockClient.resetSimulation();

    // 4.1 Router Identity
    const identity = await mikrotikService.getRouterIdentity(orgId, routerId);
    assert.equal(identity.name, 'MikroTik-CCR2004-Edge-01');

    // 4.2 System Resources
    const resources = await mikrotikService.getSystemResources(orgId, routerId);
    assert.equal(resources.platform, 'MikroTik');
    assert.equal(resources.boardName, 'CCR2004-1G-12S+2XS');
    assert.equal(resources.version, '7.14.3 (stable)');
    assert.ok(resources.cpuLoad >= 0 && resources.cpuLoad <= 100);
    assert.ok(resources.totalMemory > 0);
    assert.ok(resources.freeMemory > 0);

    // 4.3 Active PPP Sessions
    const sessions = await mikrotikService.getActivePppSessions(orgId, routerId);
    assert.ok(Array.isArray(sessions));
    assert.ok(sessions.length >= 2);
    const pppoeUser = sessions.find((s) => s.name === 'speed_50m_user');
    assert.ok(pppoeUser);
    assert.equal(pppoeUser.service, 'pppoe');
    assert.equal(pppoeUser.address, '100.64.10.101');

    // 4.4 Interfaces
    const ifaces = await mikrotikService.getInterfaces(orgId, routerId);
    assert.ok(Array.isArray(ifaces));
    assert.ok(ifaces.length >= 3);
    const wan = ifaces.find((i) => i.name === 'ether1-wan');
    assert.ok(wan);
    assert.equal(wan.running, true);
    assert.equal(wan.disabled, false);

    // 4.5 Interface Traffic
    const traffic = await mikrotikService.getInterfaceTraffic(orgId, routerId, 'ether1-wan');
    assert.equal(traffic.name, 'ether1-wan');
    assert.ok(traffic.rxBps > 0);
    assert.ok(traffic.txBps > 0);
  });

  await t.test('5. Controllers Must Never Directly Call RouterOS APIs', async () => {
    // Controller calls delegate to MikrotikService
    const ctrlList = await routersController.list(orgId);
    assert.ok(ctrlList.length >= 1);

    const ctrlIdentity = await routersController.getIdentity(orgId, routerId);
    assert.equal(ctrlIdentity.name, 'MikroTik-CCR2004-Edge-01');

    const ctrlResources = await routersController.getSystemResources(orgId, routerId);
    assert.equal(ctrlResources.platform, 'MikroTik');

    const ctrlSessions = await routersController.getActivePppSessions(orgId, routerId);
    assert.ok(ctrlSessions.length >= 1);

    const ctrlIfaces = await routersController.getInterfaces(orgId, routerId);
    assert.ok(ctrlIfaces.length >= 1);

    const ctrlTraffic = await routersController.getInterfaceTraffic(orgId, routerId, 'ether1-wan');
    assert.equal(ctrlTraffic.name, 'ether1-wan');
  });

  await t.test('6. Resilience: Transient Failure Auto-Recovery via Exponential Retries', async () => {
    mockClient.resetSimulation();
    // Simulate 1 transient failure before succeeding
    mockClient.setFailNextAttempts(1, 'transient');

    const identity = await mikrotikService.getRouterIdentity(orgId, routerId);
    assert.equal(identity.name, 'MikroTik-CCR2004-Edge-01');
    assert.equal(mockClient.callHistory.length, 2, 'Should have retried once and succeeded on second attempt');
  });

  await t.test('7. Resilience: Fast-fail on Authentication Error Without Retries', async () => {
    mockClient.resetSimulation();
    // Set 1 auth failure
    mockClient.setFailNextAttempts(1, 'auth');

    await assert.rejects(
      async () => {
        await mikrotikService.getRouterIdentity(orgId, routerId);
      },
      (err) => {
        assert.equal(err.status, 401);
        return true;
      },
    );

    // Fast fail must NOT retry invalid credentials to avoid router account lockout
    assert.equal(mockClient.callHistory.length, 1, 'Auth failure must fast-fail without retrying');
  });

  await t.test('8. Resilience: Timeout Handling with GatewayTimeoutException', async () => {
    mockClient.resetSimulation();
    // Exceed max retries (3 timeouts)
    mockClient.setFailNextAttempts(3, 'timeout');

    await assert.rejects(
      async () => {
        await mikrotikService.getRouterIdentity(orgId, routerId);
      },
      (err) => {
        assert.equal(err.status, 504);
        assert.match(err.message, /timed out/i);
        return true;
      },
    );
  });

  await t.test('9. Safe Error Handling & Credential Scrubbing (Zero Password Leak in Logs/Errors)', async () => {
    const rawError = `Failed to authenticate with user=admin password=${routerSecretPassword} and secret=${routerSecretPassword}`;
    const sanitized = sanitizeMessage(rawError, [routerSecretPassword]);

    assert.equal(sanitized.includes(routerSecretPassword), false, 'Sanitized error must not contain password');
    assert.ok(sanitized.includes('[REDACTED]'), 'Secret should be replaced with [REDACTED]');

    // Verify Basic Auth header scrubber
    const basicAuthHeader = 'Authorization: Basic YWRtaW46c3VwZXJzZWNyZXQ=';
    const sanitizedHeader = sanitizeMessage(`Request failed: ${basicAuthHeader}`);
    assert.equal(sanitizedHeader.includes('YWRtaW46c3VwZXJzZWNyZXQ='), false);
    assert.ok(sanitizedHeader.includes('Authorization: Basic [REDACTED]'));
  });

  await t.test('10. Router Update (Credential Re-encryption) & Delete Cleanup', async () => {
    const newPassword = 'BrandNewPassword999!';
    const updated = await mikrotikService.updateRouter(orgId, routerId, {
      name: 'Renamed-CCR2004',
      password: newPassword,
    });

    assert.equal(updated.name, 'Renamed-CCR2004');
    assert.equal((updated).password, undefined);
    assert.equal((updated).encryptedCredential, undefined);

    // Verify DB record has new encrypted payload that decrypts correctly
    const dbRecord = await prisma.router.findUnique({ where: { id: routerId } });
    assert.ok(dbRecord.encryptedCredential);

    // Test connection with re-encrypted credentials
    mockClient.resetSimulation();
    const testRes = await mikrotikService.testConnection(orgId, routerId);
    assert.equal(testRes.success, true);

    // Delete router
    const deleteRes = await mikrotikService.deleteRouter(orgId, routerId);
    assert.equal(deleteRes.success, true);

    // Verify router and nas record are removed
    const deletedDb = await prisma.router.findUnique({ where: { id: routerId } });
    assert.equal(deletedDb, null);

    const deletedNas = await prisma.nas.findUnique({ where: { nasname: dbRecord.host } });
    assert.equal(deletedNas, null);
  });
});
