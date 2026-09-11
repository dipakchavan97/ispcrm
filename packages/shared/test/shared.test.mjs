import test from 'node:test';
import assert from 'node:assert/strict';
import { UserRole, CustomerStatus, DEFAULT_GST_RATE, TELECOM_SAC_CODE, LoginSchema } from '../dist/index.js';

test('shared constants and enums are defined properly', () => {
  assert.equal(UserRole.ISP_OWNER, 'ISP_OWNER');
  assert.equal(CustomerStatus.ACTIVE, 'ACTIVE');
  assert.equal(DEFAULT_GST_RATE, 18.0);
  assert.equal(TELECOM_SAC_CODE, '998422');
});

test('LoginSchema validates input', () => {
  const valid = LoginSchema.safeParse({ email: 'admin@isp.com', password: 'password123' });
  assert.equal(valid.success, true);

  const invalid = LoginSchema.safeParse({ email: 'not-an-email', password: '123' });
  assert.equal(invalid.success, false);
});
