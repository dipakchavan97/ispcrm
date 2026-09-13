import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMacAddress,
  isValidMacAddress,
  InvalidMacAddressError,
  CreateCustomerSchema,
  UpdateCustomerSchema,
} from '../dist/index.js';

test('1. uppercase colon format is normalized to canonical format', () => {
  const input = '00:1A:2B:3C:4D:5E';
  const expected = '00:1A:2B:3C:4D:5E';
  assert.equal(normalizeMacAddress(input), expected);
  assert.equal(isValidMacAddress(input), true);
});

test('2. lowercase colon format is normalized to canonical uppercase format', () => {
  const input = '00:1a:2b:3c:4d:5e';
  const expected = '00:1A:2B:3C:4D:5E';
  assert.equal(normalizeMacAddress(input), expected);
  assert.equal(isValidMacAddress(input), true);
});

test('3. hyphen format (both upper and lower case) is normalized to canonical format', () => {
  assert.equal(normalizeMacAddress('00-1A-2B-3C-4D-5E'), '00:1A:2B:3C:4D:5E');
  assert.equal(normalizeMacAddress('00-1a-2b-3c-4d-5e'), '00:1A:2B:3C:4D:5E');
  assert.equal(isValidMacAddress('AA-BB-CC-DD-EE-FF'), true);
});

test('4. plain 12-character format (both upper and lower case) is normalized to canonical format', () => {
  assert.equal(normalizeMacAddress('001A2B3C4D5E'), '00:1A:2B:3C:4D:5E');
  assert.equal(normalizeMacAddress('001a2b3c4d5e'), '00:1A:2B:3C:4D:5E');
  assert.equal(isValidMacAddress('AABBCCDDEEFF'), true);
});

test('5. Cisco dot notation is normalized to canonical format', () => {
  assert.equal(normalizeMacAddress('001a.2b3c.4d5e'), '00:1A:2B:3C:4D:5E');
  assert.equal(normalizeMacAddress('001A.2B3C.4D5E'), '00:1A:2B:3C:4D:5E');
  assert.equal(isValidMacAddress('aabb.ccdd.eeff'), true);
});

test('6. null input returns null', () => {
  assert.equal(normalizeMacAddress(null), null);
  assert.equal(isValidMacAddress(null), false);
});

test('7. undefined input returns null', () => {
  assert.equal(normalizeMacAddress(undefined), null);
  assert.equal(isValidMacAddress(undefined), false);
});

test('8. empty string and whitespace-only returns null', () => {
  assert.equal(normalizeMacAddress(''), null);
  assert.equal(normalizeMacAddress('   '), null);
  assert.equal(normalizeMacAddress('\t\n'), null);
  assert.equal(isValidMacAddress(''), false);
  assert.equal(isValidMacAddress('   '), false);
});

test('9. invalid length throws BadRequestException / InvalidMacAddressError', () => {
  // Too short (10 hex characters)
  assert.throws(
    () => normalizeMacAddress('00:1A:2B:3C:4D'),
    (err) => err.name === 'BadRequestException' && err.message.includes('Invalid MAC address length')
  );
  assert.throws(
    () => normalizeMacAddress('001A2B3C4D'),
    (err) => err.name === 'BadRequestException' && err.message.includes('Invalid MAC address length')
  );
  // Too long (14 hex characters)
  assert.throws(
    () => normalizeMacAddress('00:1A:2B:3C:4D:5E:6F'),
    (err) => err.name === 'BadRequestException' && err.message.includes('Invalid MAC address length')
  );
  assert.throws(
    () => normalizeMacAddress('001A2B3C4D5E6F'),
    (err) => err.name === 'BadRequestException' && err.message.includes('Invalid MAC address length')
  );
  assert.equal(isValidMacAddress('00:1A:2B:3C:4D'), false);
  assert.equal(isValidMacAddress('00:1A:2B:3C:4D:5E:6F'), false);
});

test('10. invalid characters throw BadRequestException / InvalidMacAddressError', () => {
  // Contains non-hex characters 'G'
  assert.throws(
    () => normalizeMacAddress('00:1A:2B:3C:4D:5G'),
    (err) => err.name === 'BadRequestException' && err.message.includes('invalid characters')
  );
  // Contains 'Z'
  assert.throws(
    () => normalizeMacAddress('01:23:45:67:89:ZZ'),
    (err) => err.name === 'BadRequestException' && err.message.includes('invalid characters')
  );
  // Contains special characters
  assert.throws(
    () => normalizeMacAddress('00:1A:2B:3C:4D:5E!'),
    (err) => err.name === 'BadRequestException' && err.message.includes('invalid characters')
  );
  assert.throws(
    () => normalizeMacAddress('NOT-A-MAC-ADDR'),
    (err) => err.name === 'BadRequestException' && err.message.includes('invalid characters')
  );
  assert.equal(isValidMacAddress('00:1A:2B:3C:4D:5G'), false);
  assert.equal(isValidMacAddress('NOT-A-MAC-ADDR'), false);
});

test('11. malformed MAC formats throw BadRequestException / InvalidMacAddressError', () => {
  // Odd length / broken segment
  assert.throws(
    () => normalizeMacAddress('00:1A:2B:3C:4D:5'),
    (err) => err.name === 'BadRequestException'
  );
  // Mixed delimiters
  assert.throws(
    () => normalizeMacAddress('00:1A-2B.3C:4D:5E'),
    (err) => err.name === 'BadRequestException' && err.message.includes('Malformed MAC address format')
  );
  // Double delimiters
  assert.throws(
    () => normalizeMacAddress('00::1A::2B::3C::4D::5E'),
    (err) => err.name === 'BadRequestException'
  );
  // Broken dot notation
  assert.throws(
    () => normalizeMacAddress('001a.2b3c.4d'),
    (err) => err.name === 'BadRequestException'
  );
  assert.equal(isValidMacAddress('00:1A-2B.3C:4D:5E'), false);
  assert.equal(isValidMacAddress('00:1A:2B:3C:4D:5'), false);
});

test('12. CreateCustomerSchema and UpdateCustomerSchema validate macAddress field', () => {
  const baseValidCustomer = {
    name: 'Test Subscriber',
    customerCode: 'SUB-100',
    mobile: '9876543210',
    address: '123 Main Street',
    username: 'test.subscriber',
  };

  // Valid with colon MAC
  const res1 = CreateCustomerSchema.safeParse({
    ...baseValidCustomer,
    macAddress: '00:1a:2b:3c:4d:5e',
  });
  assert.equal(res1.success, true);

  // Valid with Cisco dot MAC
  const res2 = CreateCustomerSchema.safeParse({
    ...baseValidCustomer,
    macAddress: '001a.2b3c.4d5e',
  });
  assert.equal(res2.success, true);

  // Valid with plain hex MAC
  const res3 = CreateCustomerSchema.safeParse({
    ...baseValidCustomer,
    macAddress: 'AABBCCDDEEFF',
  });
  assert.equal(res3.success, true);

  // Valid with null macAddress
  const res4 = CreateCustomerSchema.safeParse({
    ...baseValidCustomer,
    macAddress: null,
  });
  assert.equal(res4.success, true);

  // Valid with empty macAddress
  const res5 = CreateCustomerSchema.safeParse({
    ...baseValidCustomer,
    macAddress: '',
  });
  assert.equal(res5.success, true);

  // Valid with omitted macAddress
  const res6 = CreateCustomerSchema.safeParse(baseValidCustomer);
  assert.equal(res6.success, true);

  // REJECTED with invalid MAC
  const resInvalid = CreateCustomerSchema.safeParse({
    ...baseValidCustomer,
    macAddress: 'invalid-mac',
  });
  assert.equal(resInvalid.success, false);

  // UpdateCustomerSchema validation
  const updateValid = UpdateCustomerSchema.safeParse({
    macAddress: 'AA-BB-CC-DD-EE-FF',
  });
  assert.equal(updateValid.success, true);

  const updateInvalid = UpdateCustomerSchema.safeParse({
    macAddress: '00:11:22:33:44:GG',
  });
  assert.equal(updateInvalid.success, false);
});
