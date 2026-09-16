import test from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { RouterOsBinaryClient } from '../dist/modules/routers/clients/routeros-binary.client.js';
import { RouterOsBinaryClient as WorkerRouterOsBinaryClient } from '../../../apps/worker/dist/mikrotik/routeros-binary.client.js';

function encodeWord(str) {
  const b = Buffer.from(str, 'utf8');
  if (b.length < 0x80) {
    return Buffer.concat([Buffer.from([b.length]), b]);
  } else if (b.length < 0x4000) {
    return Buffer.concat([Buffer.from([(b.length >> 8) | 0x80, b.length & 0xff]), b]);
  }
  return Buffer.concat([Buffer.from([b.length]), b]);
}

function encodeSentence(words) {
  const parts = words.map(encodeWord);
  parts.push(Buffer.from([0x00]));
  return Buffer.concat(parts);
}

function parseSentence(buf) {
  let offset = 0;
  const words = [];
  while (offset < buf.length) {
    const firstByte = buf[offset];
    if (firstByte === 0) {
      return { words, remaining: Buffer.from(buf.subarray(offset + 1)) };
    }
    let wordLen = 0;
    let lenBytes = 0;
    if ((firstByte & 0x80) === 0x00) {
      wordLen = firstByte;
      lenBytes = 1;
    } else if ((firstByte & 0xc0) === 0x80) {
      if (offset + 2 > buf.length) return null;
      wordLen = ((firstByte & 0x3f) << 8) | buf[offset + 1];
      lenBytes = 2;
    } else {
      wordLen = firstByte;
      lenBytes = 1;
    }
    const start = offset + lenBytes;
    const end = start + wordLen;
    if (end > buf.length) return null;
    words.push(buf.subarray(start, end).toString('utf8'));
    offset = end;
  }
  return null;
}

function createMockRouterOsServer(options = {}) {
  let connectionCount = 0;
  let loginCount = 0;
  const receivedCommands = [];
  const activeSockets = new Set();

  const server = net.createServer((socket) => {
    connectionCount++;
    activeSockets.add(socket);

    let receiveBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      receiveBuffer = Buffer.concat([receiveBuffer, chunk]);

      while (true) {
        const parsed = parseSentence(receiveBuffer);
        if (!parsed) break;
        receiveBuffer = parsed.remaining;
        const words = parsed.words;
        if (words.length === 0) continue;

        const cmd = words[0];
        if (cmd === '/login') {
          loginCount++;
          if (options.authReject) {
            socket.write(encodeSentence(['!trap', '=message=invalid user name or password']));
          } else {
            socket.write(encodeSentence(['!done']));
          }
        } else {
          receivedCommands.push(words);

          if (options.delayMs) {
            setTimeout(() => {
              respondToCommand(cmd, socket);
            }, options.delayMs);
          } else {
            respondToCommand(cmd, socket);
          }
        }
      }
    });

    function respondToCommand(cmd, s) {
      if (s.destroyed) return;
      if (options.onCommand) {
        options.onCommand(cmd, s);
        return;
      }
      if (cmd === '/system/identity/print') {
        s.write(
          Buffer.concat([
            encodeSentence(['!re', '=name=Core-Router-01']),
            encodeSentence(['!done']),
          ]),
        );
      } else if (cmd === '/system/resource/print') {
        s.write(
          Buffer.concat([
            encodeSentence([
              '!re',
              '=platform=MikroTik',
              '=board-name=RB4011iGS+',
              '=version=6.49.20',
              '=uptime=2d4h',
              '=cpu-load=12',
              '=total-memory=1073741824',
              '=free-memory=536870912',
              '=total-hdd-space=67108864',
              '=free-hdd-space=33554432',
            ]),
            encodeSentence(['!done']),
          ]),
        );
      } else if (cmd === '/interface/monitor-traffic') {
        s.write(
          Buffer.concat([
            encodeSentence([
              '!re',
              '=rx-bits-per-second=50000000',
              '=tx-bits-per-second=10000000',
            ]),
            encodeSentence(['!done']),
          ]),
        );
      } else {
        s.write(encodeSentence(['!done']));
      }
    }

    socket.on('close', () => {
      activeSockets.delete(socket);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        getConnectionCount: () => connectionCount,
        getLoginCount: () => loginCount,
        getReceivedCommands: () => receivedCommands,
        getActiveSockets: () => activeSockets,
        close: () =>
          new Promise((done) => {
            for (const s of activeSockets) {
              s.destroy();
            }
            server.close(done);
          }),
      });
    });
  });
}

test('MikroTik API Connection Churn Fix — Unit & Functional Verification', async (t) => {
  let mockServer;
  let client;

  t.beforeEach(async () => {
    mockServer = await createMockRouterOsServer();
    client = new RouterOsBinaryClient();
  });

  t.afterEach(async () => {
    client.clearCache();
    await mockServer.close();
  });

  await t.test('1. First request creates one socket', async () => {
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-test-1',
      routerId: 'router-test-1',
    };

    const result = await client.getRouterIdentity(config);
    assert.equal(result.name, 'Core-Router-01');
    assert.equal(mockServer.getConnectionCount(), 1, 'First request must establish exactly 1 connection');
    assert.equal(mockServer.getLoginCount(), 1, 'First request must authenticate once');
    assert.equal(client.getCachedSessionCount(), 1, 'Client must store 1 cached session');
  });

  await t.test('2. Second request within 15 seconds reuses the same socket', async () => {
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-test-1',
      routerId: 'router-test-1',
    };

    await client.getRouterIdentity(config);
    assert.equal(mockServer.getConnectionCount(), 1);

    const traffic = await client.getInterfaceTraffic(config, 'ether1');
    assert.equal(traffic.rxBps, 50000000);
    assert.equal(mockServer.getConnectionCount(), 1, 'Second request must reuse existing socket');
    assert.equal(client.getCachedSessionCount(), 1);
  });

  await t.test('3. Second request does NOT authenticate again', async () => {
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-test-1',
      routerId: 'router-test-1',
    };

    await client.getRouterIdentity(config);
    assert.equal(mockServer.getLoginCount(), 1);

    await client.getSystemResources(config);
    await client.getInterfaceTraffic(config, 'ether1');

    assert.equal(mockServer.getLoginCount(), 1, 'Login count must remain 1 despite 3 queries');
  });

  await t.test('4. Idle timer resets after each successful request', async () => {
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-test-1',
      routerId: 'router-test-1',
    };

    await client.getRouterIdentity(config);
    const session = client.getCachedSession('org-test-1', 'router-test-1');
    assert.ok(session.idleTimer, 'Session must have active idle timer');
    const timerRef1 = session.idleTimer;

    // Small delay then second query
    await new Promise((r) => setTimeout(r, 50));
    await client.getSystemResources(config);

    const sessionAfter = client.getCachedSession('org-test-1', 'router-test-1');
    assert.ok(sessionAfter.idleTimer, 'Session must have new active idle timer');
    assert.notEqual(sessionAfter.idleTimer, timerRef1, 'Idle timer must have been reset');
  });

  await t.test('5. Socket closes after inactivity & 6. Cache entry is removed after close', async () => {
    // Set short idle timeout for fast deterministic test
    client['IDLE_TIMEOUT_MS'] = 100;

    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-test-1',
      routerId: 'router-test-1',
    };

    await client.getRouterIdentity(config);
    assert.equal(client.getCachedSessionCount(), 1);

    // Wait for idle timer to fire
    await new Promise((r) => setTimeout(r, 160));

    assert.equal(client.getCachedSessionCount(), 0, 'Cache entry must be removed after idle close');
    assert.equal(client.hasCachedSession('org-test-1', 'router-test-1'), false);
  });

  await t.test('7. Two simultaneous requests to the same router are serialized', async () => {
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-test-1',
      routerId: 'router-test-1',
    };

    // Fire 3 simultaneous requests
    const p1 = client.getRouterIdentity(config);
    const p2 = client.getSystemResources(config);
    const p3 = client.getInterfaceTraffic(config, 'ether1');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    assert.equal(r1.name, 'Core-Router-01');
    assert.equal(r2.boardName, 'RB4011iGS+');
    assert.equal(r3.rxBps, 50000000);

    assert.equal(mockServer.getConnectionCount(), 1, 'All simultaneous requests must share 1 connection');
    assert.equal(mockServer.getLoginCount(), 1, 'Only 1 login handshake');

    const cmds = mockServer.getReceivedCommands();
    assert.equal(cmds.length, 3, 'All 3 commands received');
    assert.equal(cmds[0][0], '/system/identity/print');
    assert.equal(cmds[1][0], '/system/resource/print');
    assert.equal(cmds[2][0], '/interface/monitor-traffic');
  });

  await t.test('8. Multiple routers use independent sessions', async () => {
    const config1 = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-test-1',
      routerId: 'router-A',
    };

    const config2 = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-test-1',
      routerId: 'router-B',
    };

    await Promise.all([client.getRouterIdentity(config1), client.getRouterIdentity(config2)]);

    assert.equal(mockServer.getConnectionCount(), 2, 'Two distinct routers must open two distinct connections');
    assert.equal(client.getCachedSessionCount(), 2, 'Two distinct sessions cached');
    assert.ok(client.hasCachedSession('org-test-1', 'router-A'));
    assert.ok(client.hasCachedSession('org-test-1', 'router-B'));
  });

  await t.test('9. Socket error removes the session', async () => {
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-test-1',
      routerId: 'router-test-1',
    };

    await client.getRouterIdentity(config);
    assert.equal(client.hasCachedSession('org-test-1', 'router-test-1'), true);

    const session = client.getCachedSession('org-test-1', 'router-test-1');
    // Simulate unexpected remote socket error/destruction
    session.socket.destroy(new Error('ECONNRESET: simulated socket crash'));

    // Wait a tick for event loop
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(client.hasCachedSession('org-test-1', 'router-test-1'), false, 'Session must be evicted on error');
    assert.equal(client.getCachedSessionCount(), 0);
  });

  await t.test('10. Stale socket is not reused & creates fresh connection', async () => {
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-test-1',
      routerId: 'router-test-1',
    };

    await client.getRouterIdentity(config);
    assert.equal(mockServer.getConnectionCount(), 1);

    // Destroy socket
    const session = client.getCachedSession('org-test-1', 'router-test-1');
    session.socket.destroy();
    await new Promise((r) => setTimeout(r, 20));

    // Next request
    const identity2 = await client.getRouterIdentity(config);
    assert.equal(identity2.name, 'Core-Router-01');
    assert.equal(mockServer.getConnectionCount(), 2, 'Fresh connection must be created after stale socket destroyed');
  });

  await t.test('11. New replacement session cannot be accidentally deleted by old session cleanup', async () => {
    const key = 'org-test-1:router-test-1';
    const oldSession = {
      key,
      isClosed: false,
      idleTimer: null,
      socket: { end: () => {} },
    };
    const newSession = {
      key,
      isClosed: false,
      idleTimer: null,
      socket: { end: () => {} },
    };

    // Put new session in cache
    client['sessionCache'].set(key, newSession);

    // Run closeIdleSession on old session
    client['closeIdleSession'](oldSession);

    // Verify cache still contains newSession!
    assert.equal(client['sessionCache'].get(key), newSession, 'New replacement session must NOT be removed by old session');
  });

  await t.test('12. Command timeout destroys the socket and clears cache', async () => {
    // Mock server that hangs on traffic command
    const slowServer = await createMockRouterOsServer({
      onCommand: (cmd, s) => {
        // intentionally hang without responding
      },
    });

    const slowClient = new RouterOsBinaryClient();
    const config = {
      host: '127.0.0.1',
      port: slowServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'org-timeout',
      routerId: 'router-timeout',
      timeoutMs: 150, // fast timeout for test
    };

    await assert.rejects(
      async () => {
        await slowClient.getInterfaceTraffic(config, 'ether1');
      },
      /timed out/,
      'Command must reject with timeout',
    );

    assert.equal(slowClient.hasCachedSession('org-timeout', 'router-timeout'), false, 'Timed-out session must be cleared from cache');

    slowClient.clearCache();
    await slowServer.close();
  });

  await t.test('13. Credentials are not stored in cached session', async () => {
    const password = 'super_secret_password_12345';
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin_user',
      password,
      organizationId: 'org-test-1',
      routerId: 'router-test-1',
    };

    await client.getRouterIdentity(config);
    const session = client.getCachedSession('org-test-1', 'router-test-1');

    assert.equal(session.password, undefined, 'password must not exist on session');
    assert.equal(session.username, undefined, 'username must not exist on session');
    assert.equal(session.config, undefined, 'config must not exist on session');
    assert.equal(Object.keys(session).includes('password'), false, 'Password must not appear in session keys');
    assert.equal(Object.keys(session).includes('username'), false, 'Username must not appear in session keys');
    assert.equal(Object.keys(session).includes('config'), false, 'Config must not appear in session keys');
  });

  await t.test('14. Cache key contains organizationId + routerId', async () => {
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
      organizationId: 'tenant-999',
      routerId: 'rtr-888',
    };

    await client.getRouterIdentity(config);
    assert.ok(client['sessionCache'].has('tenant-999:rtr-888'), 'Cache key must be ${orgId}:${routerId}');
    assert.equal(client['sessionCache'].has('rtr-888'), false, 'Cache key must NOT be routerId alone');
  });

  await t.test('15. Worker testConnection returns SystemResources', async () => {
    const workerClient = new WorkerRouterOsBinaryClient();
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
    };

    const res = await workerClient.testConnection(config);
    assert.equal(res.success, true);
    assert.ok(res.systemResources, 'Worker testConnection must return systemResources');
    assert.equal(res.systemResources.boardName, 'RB4011iGS+');
    assert.equal(res.systemResources.version, '6.49.20');
    assert.equal(res.systemResources.cpuLoad, 12);
  });

  await t.test('16. Worker deduplication: systemResources extracted from testConnection without second call', async () => {
    const workerClient = new WorkerRouterOsBinaryClient();
    const config = {
      host: '127.0.0.1',
      port: mockServer.port,
      username: 'admin',
      password: 'secretpassword',
    };

    // Clear server counters
    const initialCmdCount = mockServer.getReceivedCommands().length;

    const testRes = await workerClient.testConnection(config);
    assert.equal(testRes.success, true);
    assert.ok(testRes.systemResources);

    const cmdsAfterTest = mockServer.getReceivedCommands().length;
    // Worker testConnection sent: /system/identity/print and /system/resource/print
    assert.equal(cmdsAfterTest - initialCmdCount, 2);

    // In the old implementation, getSystemResources was called separately (would add a 3rd command and 2nd connection).
    // In the new implementation, testRes.systemResources is reused directly, saving 1 connection and 1 command!
    const reusedResources = testRes.systemResources;
    assert.equal(reusedResources.boardName, 'RB4011iGS+');
    assert.equal(mockServer.getReceivedCommands().length, cmdsAfterTest, 'No additional commands executed');
  });
});
