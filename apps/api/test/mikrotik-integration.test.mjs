import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { RoutersService } from '../dist/modules/routers/routers.service.js';
import { MockMikrotikClient } from '../dist/modules/routers/clients/mock-mikrotik.client.js';
import {
  encryptCredential,
  decryptCredential,
  sanitizeMessage,
} from '../dist/common/utils/crypto.util.js';
import { RouterStatus } from '@isp-crm/shared';
import { prisma } from '@isp-crm/database';

const authService = new AuthService();
const mockClient = new MockMikrotikClient();
const routersService = new RoutersService(mockClient);

test('MikroTik Integration Module: Client Abstraction, Service Layer, AES Encryption & Resiliency', async (t) => {
  const ts = Date.now();
  let orgId;
  let testRouterId;
  const rawSecretPassword = `P@ssw0rd_${ts}_SuperSecret!`;

  t.before(async () => {
    // Setup test organization
    const org = await authService.registerOrganization({
      name: `MikroTik Org ${ts}`,
      slug: `mikrotik-org-${ts}`,
      email: `netadmin_${ts}@mikrotik.test`,
      phone: '9876543210',
      ownerName: 'Network Admin',
      ownerEmail: `netadmin_${ts}@mikrotik.test`,
      ownerPassword: 'Password123!',
    });
    orgId = org.user.organizationId;
  });

  t.after(async () => {
    mockClient.resetSimulation();
    await prisma.router.deleteMany({ where: { organizationId: orgId } });
  });

  await t.test('1. AES-256-GCM Credential Encryption & Decryption Utility', async () => {
    const plain = 'RouterSecretKey!987654';
    const encrypted = encryptCredential(plain);

    assert.ok(encrypted.includes(':'), 'Encrypted string must be formatted as iv:authTag:ciphertext');
    const parts = encrypted.split(':');
    assert.equal(parts.length, 3, 'Must contain IV, AuthTag, and CipherText');
    assert.ok(!encrypted.includes(plain), 'Encrypted payload must NEVER contain plaintext');

    const decrypted = decryptCredential(encrypted);
    assert.equal(decrypted, plain, 'Decrypted credential must exactly match original plaintext');

    // Tampered payload verification
    const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -2)}00`;
    assert.throws(() => decryptCredential(tampered), /Authentication tag mismatch/);
  });

  await t.test('2. Register Router: Encrypts Password at Rest, Syncs NAS & Sanitizes Output', async () => {
    const input = {
      name: 'Main BNG CCR2004',
      host: `192.168.88.${ts % 200 + 1}`,
      port: 8728,
      username: 'api_user',
      password: rawSecretPassword,
      radiusSecret: 'radius_secret_123',
      testOnRegister: true,
    };

    const registered = await routersService.registerRouter(orgId, input);
    testRouterId = registered.id;

    assert.ok(registered.id);
    assert.equal(registered.organizationId, orgId);
    assert.equal(registered.name, input.name);
    assert.equal(registered.host, input.host);
    assert.equal(registered.port, 8728);
    assert.equal(registered.username, input.username);
    assert.equal(registered.status, RouterStatus.ONLINE);
    assert.ok(registered.lastSeen);

    // CRITICAL SECURITY: Ensure encryptedCredential and raw password are NEVER returned
    assert.equal(registered.encryptedCredential, undefined, 'CRITICAL: encryptedCredential must not be returned');
    assert.equal(registered.password, undefined, 'CRITICAL: password must not be returned');
    assert.equal(registered.apiPassword, undefined, 'CRITICAL: apiPassword must not be returned');

    // Verify database record has ciphertext
    const inDb = await prisma.router.findUnique({ where: { id: testRouterId } });
    assert.ok(inDb);
    assert.ok(inDb.encryptedCredential);
    assert.ok(!inDb.encryptedCredential.includes(rawSecretPassword));
    assert.equal(decryptCredential(inDb.encryptedCredential), rawSecretPassword);

    // Verify FreeRADIUS nas synchronization
    const nasEntry = await prisma.nas.findUnique({ where: { nasname: input.host } });
    assert.ok(nasEntry);
    assert.equal(nasEntry.secret, 'radius_secret_123');
    assert.equal(nasEntry.type, 'mikrotik');
  });

  await t.test('3. Duplicate Router Registration: Enforces Unique Host per Organization', async () => {
    const existing = await routersService.getRouterById(orgId, testRouterId);
    await assert.rejects(
      async () => {
        await routersService.registerRouter(orgId, {
          name: 'Duplicate Router',
          host: existing.host,
          username: 'api_user2',
          password: 'AnotherPassword123!',
        });
      },
      /already exists in your organization/,
    );
  });

  await t.test('4. Tenant Isolation: Org B Cannot Access Org A Router', async () => {
    const otherOrg = await authService.registerOrganization({
      name: `Other Org ${ts}`,
      slug: `other-org-${ts}`,
      email: `other_${ts}@tenant.test`,
      phone: '9876543211',
      ownerName: 'Other Admin',
      ownerEmail: `other_${ts}@tenant.test`,
      ownerPassword: 'Password123!',
    });

    await assert.rejects(
      async () => {
        await routersService.getRouterById(otherOrg.user.organizationId, testRouterId);
      },
      /Router not found in your organization/,
    );

    await assert.rejects(
      async () => {
        await routersService.testConnection(otherOrg.user.organizationId, testRouterId);
      },
      /Router not found in your organization/,
    );
  });

  await t.test('5. Test Connection: Queries MikrotikClient & Updates Live Router State', async () => {
    const testResult = await routersService.testConnection(orgId, testRouterId);

    assert.equal(testResult.success, true);
    assert.equal(testResult.identity, 'MikroTik-CCR2004-Edge-01');
    assert.equal(testResult.rosVersion, 'RouterOS v7.14.3');
    assert.equal(testResult.model, 'CCR2004-1G-12S+2XS');
    assert.ok(testResult.latencyMs >= 0);

    const updated = await routersService.getRouterById(orgId, testRouterId);
    assert.equal(updated.status, RouterStatus.ONLINE);
    assert.equal(updated.identity, 'MikroTik-CCR2004-Edge-01');
    assert.equal(updated.rosVersion, 'RouterOS v7.14.3');
    assert.equal(updated.model, 'CCR2004-1G-12S+2XS');
    assert.ok(updated.lastSeen);
  });

  await t.test('6. Router Identity: Retrieves Name from RouterOS', async () => {
    const identity = await routersService.getRouterIdentity(orgId, testRouterId);
    assert.equal(identity.name, 'MikroTik-CCR2004-Edge-01');
  });

  await t.test('7. System Resources: Retrieves CPU, Memory, Disk & Uptime', async () => {
    const resources = await routersService.getSystemResources(orgId, testRouterId);

    assert.equal(resources.platform, 'MikroTik');
    assert.equal(resources.boardName, 'CCR2004-1G-12S+2XS');
    assert.equal(resources.version, '7.14.3 (stable)');
    assert.equal(resources.cpuCount, 4);
    assert.equal(resources.cpuLoad, 18);
    assert.ok(resources.totalMemory > 0);
    assert.ok(resources.freeMemory > 0);
    assert.ok(resources.uptime);
  });

  await t.test('8. Active PPP Sessions: Retrieves Real-time Connected Subscribers', async () => {
    const sessions = await routersService.getActivePppSessions(orgId, testRouterId);

    assert.ok(Array.isArray(sessions));
    assert.equal(sessions.length, 3);
    assert.equal(sessions[0].name, 'speed_50m_user');
    assert.equal(sessions[0].service, 'pppoe');
    assert.equal(sessions[0].address, '100.64.10.101');
    assert.ok(sessions[0].uptime);
    assert.ok(sessions[0].bytesIn > 0);
  });

  await t.test('9. Interfaces & Interface Traffic: Retrieves List & Live Bandwidth Counters', async () => {
    const ifaces = await routersService.getInterfaces(orgId, testRouterId);

    assert.ok(Array.isArray(ifaces));
    assert.equal(ifaces.length, 4);
    assert.equal(ifaces[0].name, 'ether1-wan');
    assert.equal(ifaces[0].running, true);
    assert.equal(ifaces[1].name, 'ether2-lan');

    const traffic = await routersService.getInterfaceTraffic(orgId, testRouterId, 'ether1-wan');
    assert.equal(traffic.name, 'ether1-wan');
    assert.ok(traffic.rxBps > 0);
    assert.ok(traffic.txBps > 0);
    assert.ok(traffic.rxPacketsPerSecond > 0);
  });

  await t.test('10. Timeout Handling: Catches ETIMEDOUT & Throws GatewayTimeoutException Without Secrets', async () => {
    const timeoutRouter = await routersService.registerRouter(orgId, {
      name: 'Timeout Router',
      host: 'timeout.mock',
      username: 'admin',
      password: 'SecretTimeoutPassword123!',
      testOnRegister: false,
    });

    await assert.rejects(
      async () => {
        await routersService.getSystemResources(orgId, timeoutRouter.id);
      },
      (err) => {
        assert.ok(err.message.includes('timed out') || err.message.includes('timeout'));
        // CRITICAL SECURITY: Secret password must never be in error message
        assert.ok(!err.message.includes('SecretTimeoutPassword123!'));
        return true;
      },
    );
  });

  await t.test('11. Retry Handling: Retries Transient Failures with Backoff and Succeeds on Subsequent Attempt', async () => {
    mockClient.resetSimulation();
    // Simulate 2 transient network failures, then succeeding on the 3rd attempt
    mockClient.setFailNextAttempts(2, 'transient');

    const resources = await routersService.getSystemResources(orgId, testRouterId);
    assert.equal(resources.cpuCount, 4);
    assert.equal(mockClient.failNextAttempts, 0, 'All 2 failures should have been consumed by retries');
  });

  await t.test('12. Fast-Fail on Authentication Error: Never Loops Retries on Bad Credentials', async () => {
    const badAuthRouter = await routersService.registerRouter(orgId, {
      name: 'Bad Auth Router',
      host: `192.168.99.${ts % 200 + 1}`,
      username: 'admin',
      password: 'bad_password',
      testOnRegister: false,
    });

    mockClient.resetSimulation();
    await assert.rejects(
      async () => {
        await routersService.getSystemResources(orgId, badAuthRouter.id);
      },
      (err) => {
        assert.ok(err.message.includes('authentication failed') || err.message.includes('401'));
        assert.ok(!err.message.includes('bad_password'));
        return true;
      },
    );

    // Verify it only attempted once (fast-fail, no retry loops on 401)
    const callCount = mockClient.callHistory.filter((c) => c.host === badAuthRouter.host).length;
    assert.equal(callCount, 1, 'Must NOT retry on 401 Unauthorized');
  });

  await t.test('13. Safe Error Masking: Strips Secrets and Basic Auth from Messages', async () => {
    const sampleError = `Error connecting with Authorization: Basic YWRtaW46U3VwZXJTZWNyZXRQYXNzIQ== and password="TopSecretPass"`;
    const masked = sanitizeMessage(sampleError, ['TopSecretPass', 'SuperSecretPass']);

    assert.ok(!masked.includes('TopSecretPass'));
    assert.ok(!masked.includes('YWRtaW46U3VwZXJTZWNyZXRQYXNzIQ=='));
    assert.ok(masked.includes('[REDACTED]'));
  });
});
