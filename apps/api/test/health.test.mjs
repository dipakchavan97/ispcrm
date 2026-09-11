import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthService } from '../dist/modules/health/health.service.js';

test('HealthService instantiates and checks Redis/DB gracefully', async () => {
  const service = new HealthService();
  assert.ok(service, 'HealthService should instantiate');
  const result = await service.checkOverall();
  assert.ok(result.status, 'Health status should be defined');
  assert.ok(result.info.database, 'DB info should be present');
  assert.ok(result.info.redis, 'Redis info should be present');
});
