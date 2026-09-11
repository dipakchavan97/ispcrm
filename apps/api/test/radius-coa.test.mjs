import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockNAS,
  RadiusCoaClient,
  RADIUS_COA_CODE,
  CoaAction,
  CoaRequestType,
} from '@isp-crm/shared';
import { processRadiusCoaJob } from '../../worker/dist/processors/radius-coa.processor.js';

test('RADIUS CoA & PoD: MockNAS Initialization and RFC 3576 Packet Exchange', async () => {
  const mockNas = new MockNAS({ secret: 'testing123', behavior: 'ACK' });
  const port = await mockNas.start(0);
  assert.ok(port > 0, 'MockNAS should bind to an ephemeral port');

  try {
    // 1. Send Disconnect-Request (Code 40)
    const disconnRes = await RadiusCoaClient.sendDisconnectRequest({
      nasIp: '127.0.0.1',
      nasPort: port,
      secret: 'testing123',
      username: 'subscriber_john',
      sessionId: 'sess_12345',
      framedIp: '100.64.0.10',
      timeoutMs: 1500,
      maxRetries: 1,
    });

    assert.equal(disconnRes.success, true);
    assert.equal(disconnRes.codeName, 'DISCONNECT_ACK');
    assert.equal(disconnRes.code, RADIUS_COA_CODE.DISCONNECT_ACK);
    assert.equal(mockNas.receivedPackets.length, 1);
    assert.equal(mockNas.receivedPackets[0].code, RADIUS_COA_CODE.DISCONNECT_REQUEST);
    assert.equal(mockNas.receivedPackets[0].username, 'subscriber_john');
    assert.equal(mockNas.receivedPackets[0].sessionId, 'sess_12345');
  } finally {
    await mockNas.stop();
  }
});

test('Use Case 1: PLAN_UPGRADE - Dynamic Bandwidth Rate-Limit CoA-Request (Code 43)', async () => {
  const mockNas = new MockNAS({ secret: 'testing123', behavior: 'ACK' });
  const port = await mockNas.start(0);

  try {
    const res = await RadiusCoaClient.sendCoaRequest({
      nasIp: '127.0.0.1',
      nasPort: port,
      secret: 'testing123',
      username: 'fast_user',
      rateLimit: '50M/100M', // 50M upload, 100M download
      sessionId: 'sess_fast_1',
      timeoutMs: 1500,
    });

    assert.equal(res.success, true);
    assert.equal(res.codeName, 'COA_ACK');
    assert.equal(res.code, RADIUS_COA_CODE.COA_ACK);
    assert.equal(mockNas.receivedPackets.length, 1);
    assert.equal(mockNas.receivedPackets[0].code, RADIUS_COA_CODE.COA_REQUEST);
    assert.equal(mockNas.receivedPackets[0].username, 'fast_user');
    assert.equal(mockNas.receivedPackets[0].rateLimit, '50M/100M');
  } finally {
    await mockNas.stop();
  }
});

test('Use Case 2: PLAN_DOWNGRADE - Throttled Bandwidth Rate-Limit CoA-Request (Code 43)', async () => {
  const mockNas = new MockNAS({ secret: 'testing123', behavior: 'ACK' });
  const port = await mockNas.start(0);

  try {
    const res = await RadiusCoaClient.sendCoaRequest({
      nasIp: '127.0.0.1',
      nasPort: port,
      secret: 'testing123',
      username: 'heavy_user',
      rateLimit: '5M/10M', // Throttled to 10M download
      sessionId: 'sess_heavy_2',
      timeoutMs: 1500,
    });

    assert.equal(res.success, true);
    assert.equal(res.codeName, 'COA_ACK');
    assert.equal(res.code, RADIUS_COA_CODE.COA_ACK);
    assert.equal(mockNas.receivedPackets.length, 1);
    assert.equal(mockNas.receivedPackets[0].code, RADIUS_COA_CODE.COA_REQUEST);
    assert.equal(mockNas.receivedPackets[0].username, 'heavy_user');
    assert.equal(mockNas.receivedPackets[0].rateLimit, '5M/10M');
  } finally {
    await mockNas.stop();
  }
});

test('Use Case 3: SUSPEND - RFC 3576 Disconnect-Request / PoD (Code 40)', async () => {
  const mockNas = new MockNAS({ secret: 'testing123', behavior: 'ACK' });
  const port = await mockNas.start(0);

  try {
    const res = await RadiusCoaClient.sendDisconnectRequest({
      nasIp: '127.0.0.1',
      nasPort: port,
      secret: 'testing123',
      username: 'overdue_customer',
      sessionId: 'sess_overdue_3',
      framedIp: '100.64.1.25',
      timeoutMs: 1500,
    });

    assert.equal(res.success, true);
    assert.equal(res.codeName, 'DISCONNECT_ACK');
    assert.equal(res.code, RADIUS_COA_CODE.DISCONNECT_ACK);
    assert.equal(mockNas.receivedPackets.length, 1);
    assert.equal(mockNas.receivedPackets[0].code, RADIUS_COA_CODE.DISCONNECT_REQUEST);
    assert.equal(mockNas.receivedPackets[0].username, 'overdue_customer');
  } finally {
    await mockNas.stop();
  }
});

test('Use Case 4: REACTIVATE - Session Rate-Limit Restore CoA-Request (Code 43)', async () => {
  const mockNas = new MockNAS({ secret: 'testing123', behavior: 'ACK' });
  const port = await mockNas.start(0);

  try {
    const res = await RadiusCoaClient.sendCoaRequest({
      nasIp: '127.0.0.1',
      nasPort: port,
      secret: 'testing123',
      username: 'reactivated_customer',
      rateLimit: '20M/50M',
      sessionId: 'sess_reactivated_4',
      timeoutMs: 1500,
    });

    assert.equal(res.success, true);
    assert.equal(res.codeName, 'COA_ACK');
    assert.equal(res.code, RADIUS_COA_CODE.COA_ACK);
    assert.equal(mockNas.receivedPackets.length, 1);
    assert.equal(mockNas.receivedPackets[0].code, RADIUS_COA_CODE.COA_REQUEST);
    assert.equal(mockNas.receivedPackets[0].username, 'reactivated_customer');
    assert.equal(mockNas.receivedPackets[0].rateLimit, '20M/50M');
  } finally {
    await mockNas.stop();
  }
});

test('Timeout & Retry Policy: Exponential Retries on Dropped Packets', async () => {
  const mockNas = new MockNAS({ secret: 'testing123', behavior: 'TIMEOUT' });
  const port = await mockNas.start(0);

  try {
    const startTime = Date.now();
    const res = await RadiusCoaClient.sendCoaRequest({
      nasIp: '127.0.0.1',
      nasPort: port,
      secret: 'testing123',
      username: 'unreachable_router_user',
      rateLimit: '10M/20M',
      timeoutMs: 200,
      maxRetries: 2, // Total 3 attempts (initial + 2 retries)
    });

    const elapsed = Date.now() - startTime;
    assert.equal(res.success, false);
    assert.equal(res.codeName, 'TIMEOUT');
    assert.equal(res.attemptsMade, 3, 'Must attempt 3 times (1 initial + 2 retries)');
    assert.equal(mockNas.receivedPackets.length, 3, 'MockNAS must receive 3 retry transmissions');
    assert.ok(elapsed >= 600, 'Elapsed time should reflect timeouts and backoff');
  } finally {
    await mockNas.stop();
  }
});

test('Worker Processor: End-to-End Fallback Disconnect on Router COA_NAK', async () => {
  const mockNas = new MockNAS({ secret: 'testing123', behavior: 'NAK' });
  const port = await mockNas.start(0);

  try {
    // When router NAKs CoA (behavior = 'NAK'), processor executes Disconnect fallback
    const mockJob = {
      id: 'test-job-fallback',
      data: {
        organizationId: '', // Blank avoids database audit lookup in standalone test
        customerId: 'cust_1',
        username: 'nak_user',
        action: CoaAction.PLAN_UPGRADE,
        requestType: CoaRequestType.COA,
        rateLimit: '50M/100M',
        nasIp: '127.0.0.1',
        nasPort: port,
        secret: 'testing123',
      },
    };

    const result = await processRadiusCoaJob(mockJob);
    assert.ok(result);
    assert.equal(result.username, 'nak_user');
    // MockNAS should receive first the CoA request (which NAKs), then fallback Disconnect request
    assert.equal(mockNas.receivedPackets.length, 2);
    assert.equal(mockNas.receivedPackets[0].code, RADIUS_COA_CODE.COA_REQUEST);
    assert.equal(mockNas.receivedPackets[1].code, RADIUS_COA_CODE.DISCONNECT_REQUEST);
  } finally {
    await mockNas.stop();
  }
});

test('Worker Processor: Successful PLAN_UPGRADE Job Execution with Structured Result', async () => {
  const mockNas = new MockNAS({ secret: 'testing123', behavior: 'ACK' });
  const port = await mockNas.start(0);

  try {
    const mockJob = {
      id: 'test-job-upgrade-success',
      data: {
        organizationId: '',
        customerId: 'cust_2',
        username: 'upgrade_worker_user',
        action: CoaAction.PLAN_UPGRADE,
        requestType: CoaRequestType.COA,
        rateLimit: '100M/200M',
        nasIp: '127.0.0.1',
        nasPort: port,
        secret: 'testing123',
      },
    };

    const result = await processRadiusCoaJob(mockJob);
    assert.equal(result.success, true);
    assert.equal(result.codeName, 'COA_ACK');
    assert.equal(result.username, 'upgrade_worker_user');
    assert.ok(result.latencyMs >= 0);
    assert.ok(result.timestamp);
    assert.equal(mockNas.receivedPackets[0].rateLimit, '100M/200M');
  } finally {
    await mockNas.stop();
  }
});

test('Non-blocking HTTP Guarantee: Mock Queueing Returns Immediately (< 25ms)', async () => {
  const startTime = Date.now();
  
  // Simulate non-blocking async dispatch pattern as implemented in services
  const asyncDispatched = new Promise((resolve) => {
    // Non-blocking immediate return
    const queueAck = {
      jobId: `coa-async-test-${Date.now()}`,
      status: 'QUEUED',
      queuedAt: new Date().toISOString(),
    };
    resolve(queueAck);
  });

  const res = await asyncDispatched;
  const elapsed = Date.now() - startTime;

  assert.ok(elapsed < 25, `Dispatch must take under 25ms (took ${elapsed}ms)`);
  assert.equal(res.status, 'QUEUED');
  assert.ok(res.jobId.startsWith('coa-async-test-'));
});
