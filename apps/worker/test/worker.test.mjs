import test from 'node:test';
import assert from 'node:assert/strict';
import { processBillingJob } from '../dist/processors/billing.processor.js';
import { processRadiusCoaJob } from '../dist/processors/radius-coa.processor.js';

test('Billing processor executes and returns processed confirmation', async () => {
  const mockJob = { id: 'test-1', data: { type: 'EXPIRY_CHECK' } };
  const res = await processBillingJob(mockJob);
  assert.equal(res.processed, true);
});

test('Radius CoA processor executes and returns success', async () => {
  const mockJob = {
    id: 'test-2',
    data: {
      routerIp: '192.168.88.1',
      coaPort: 3799,
      radiusSecret: 'testing123',
      username: 'user_rajesh',
      action: 'DISCONNECT',
    },
  };
  const res = await processRadiusCoaJob(mockJob);
  assert.equal(res.success, true);
  assert.equal(res.username, 'user_rajesh');
});
