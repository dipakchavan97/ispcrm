import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { prisma } from '@isp-crm/database';
import { seedRadiusTestUsers } from '../scripts/seed-radius-test-users.mjs';

// FreeRADIUS Server connection settings
const RADIUS_HOST = process.env.RADIUS_HOST || '127.0.0.1';
const AUTH_PORT = 1812;
const ACCT_PORT = 1813;
const RADIUS_SECRET = 'testing123';

/**
 * RADIUS Packet Codes
 */
const RADIUS_CODE = {
  ACCESS_REQUEST: 1,
  ACCESS_ACCEPT: 2,
  ACCESS_REJECT: 3,
  ACCOUNTING_REQUEST: 4,
  ACCOUNTING_RESPONSE: 5,
};

/**
 * Standard RADIUS Attribute Types
 */
const ATTR_TYPE = {
  USER_NAME: 1,
  USER_PASSWORD: 2,
  NAS_IP_ADDRESS: 4,
  NAS_PORT: 5,
  SERVICE_TYPE: 6,
  FRAMED_PROTOCOL: 7,
  FRAMED_IP_ADDRESS: 8,
  VENDOR_SPECIFIC: 26,
  ACCT_STATUS_TYPE: 40,
  ACCT_DELAY_TIME: 41,
  ACCT_INPUT_OCTETS: 42,
  ACCT_OUTPUT_OCTETS: 43,
  ACCT_SESSION_ID: 44,
  ACCT_AUTHENTIC: 45,
  ACCT_SESSION_TIME: 46,
  ACCT_TERMINATE_CAUSE: 49,
};

const MIKROTIK_VENDOR_ID = 14988;
const MIKROTIK_ATTR = {
  RATE_LIMIT: 8,
};

/**
 * Encrypt password using RFC 2865 standard MD5 stream cipher
 */
function encryptPassword(password, secret, authenticator) {
  const passBuffer = Buffer.from(password, 'utf8');
  // Pad with zeroes to a multiple of 16 bytes (min 16)
  const padLength = (16 - (passBuffer.length % 16)) % 16;
  const padded = Buffer.concat([passBuffer, Buffer.alloc(padLength, 0)]);

  const encryptedChunks = [];
  let prevCipher = authenticator;

  for (let i = 0; i < padded.length; i += 16) {
    const chunk = padded.subarray(i, i + 16);
    const hash = crypto.createHash('md5').update(Buffer.from(secret, 'utf8')).update(prevCipher).digest();
    const cipherChunk = Buffer.alloc(16);
    for (let j = 0; j < 16; j++) {
      cipherChunk[j] = chunk[j] ^ hash[j];
    }
    encryptedChunks.push(cipherChunk);
    prevCipher = cipherChunk;
  }

  return Buffer.concat(encryptedChunks);
}

/**
 * Encode attributes buffer
 */
function encodeAttribute(type, value) {
  let valBuf;
  if (Buffer.isBuffer(value)) {
    valBuf = value;
  } else if (typeof value === 'string') {
    valBuf = Buffer.from(value, 'utf8');
  } else if (typeof value === 'number') {
    valBuf = Buffer.alloc(4);
    valBuf.writeUInt32BE(value, 0);
  } else {
    throw new Error('Unsupported attribute value type');
  }

  const length = 2 + valBuf.length;
  const attrBuf = Buffer.alloc(length);
  attrBuf[0] = type;
  attrBuf[1] = length;
  valBuf.copy(attrBuf, 2);
  return attrBuf;
}

/**
 * Encode IPv4 address attribute
 */
function encodeIpAttribute(type, ipStr) {
  const parts = ipStr.split('.').map(Number);
  const valBuf = Buffer.from(parts);
  const length = 2 + valBuf.length;
  const attrBuf = Buffer.alloc(length);
  attrBuf[0] = type;
  attrBuf[1] = length;
  valBuf.copy(attrBuf, 2);
  return attrBuf;
}

/**
 * Build RFC 2865 Access-Request packet
 */
function buildAccessRequest(id, username, password, secret) {
  const authenticator = crypto.randomBytes(16);
  const encPass = encryptPassword(password, secret, authenticator);

  const attrs = Buffer.concat([
    encodeAttribute(ATTR_TYPE.USER_NAME, username),
    encodeAttribute(ATTR_TYPE.USER_PASSWORD, encPass),
    encodeIpAttribute(ATTR_TYPE.NAS_IP_ADDRESS, '127.0.0.1'),
    encodeAttribute(ATTR_TYPE.NAS_PORT, 1),
    encodeAttribute(ATTR_TYPE.SERVICE_TYPE, 2), // Framed-User
    encodeAttribute(ATTR_TYPE.FRAMED_PROTOCOL, 1), // PPP
  ]);

  const length = 20 + attrs.length;
  const packet = Buffer.alloc(length);
  packet[0] = RADIUS_CODE.ACCESS_REQUEST;
  packet[1] = id;
  packet.writeUInt16BE(length, 2);
  authenticator.copy(packet, 4);
  attrs.copy(packet, 20);

  return { packet, authenticator };
}

/**
 * Build RFC 2866 Accounting-Request packet
 */
function buildAccountingRequest(id, statusType, sessionId, username, secret, extraAttrs = {}) {
  const rawAttrs = [
    encodeAttribute(ATTR_TYPE.ACCT_STATUS_TYPE, statusType), // 1=Start, 2=Stop, 3=Interim
    encodeAttribute(ATTR_TYPE.ACCT_SESSION_ID, sessionId),
    encodeAttribute(ATTR_TYPE.USER_NAME, username),
    encodeIpAttribute(ATTR_TYPE.NAS_IP_ADDRESS, '127.0.0.1'),
    encodeAttribute(ATTR_TYPE.NAS_PORT, 1),
    encodeAttribute(ATTR_TYPE.SERVICE_TYPE, 2), // Framed-User
    encodeAttribute(ATTR_TYPE.FRAMED_PROTOCOL, 1), // PPP
    encodeAttribute(ATTR_TYPE.ACCT_AUTHENTIC, 1), // RADIUS
    encodeAttribute(ATTR_TYPE.ACCT_DELAY_TIME, 0),
  ];

  if (extraAttrs.framedIp) {
    rawAttrs.push(encodeIpAttribute(ATTR_TYPE.FRAMED_IP_ADDRESS, extraAttrs.framedIp));
  }
  if (extraAttrs.sessionTime !== undefined) {
    rawAttrs.push(encodeAttribute(ATTR_TYPE.ACCT_SESSION_TIME, extraAttrs.sessionTime));
  }
  if (extraAttrs.inputOctets !== undefined) {
    rawAttrs.push(encodeAttribute(ATTR_TYPE.ACCT_INPUT_OCTETS, extraAttrs.inputOctets));
  }
  if (extraAttrs.outputOctets !== undefined) {
    rawAttrs.push(encodeAttribute(ATTR_TYPE.ACCT_OUTPUT_OCTETS, extraAttrs.outputOctets));
  }
  if (extraAttrs.terminateCause !== undefined) {
    rawAttrs.push(encodeAttribute(ATTR_TYPE.ACCT_TERMINATE_CAUSE, extraAttrs.terminateCause));
  }

  const attrs = Buffer.concat(rawAttrs);
  const length = 20 + attrs.length;

  const packet = Buffer.alloc(length);
  packet[0] = RADIUS_CODE.ACCOUNTING_REQUEST;
  packet[1] = id;
  packet.writeUInt16BE(length, 2);
  // Zero Authenticator for calculation
  packet.fill(0, 4, 20);
  attrs.copy(packet, 20);

  // Authenticator = MD5(Code + Identifier + Length + 16-Zeroes + Request Attributes + Secret)
  const authDigest = crypto
    .createHash('md5')
    .update(packet)
    .update(Buffer.from(secret, 'utf8'))
    .digest();
  authDigest.copy(packet, 4);

  return packet;
}

/**
 * Parse RADIUS packet response
 */
function parseRadiusResponse(buf) {
  if (buf.length < 20) throw new Error('Packet too short');
  const code = buf[0];
  const identifier = buf[1];
  const length = buf.readUInt16BE(2);
  const authenticator = buf.subarray(4, 20);

  const attributes = {};
  let offset = 20;

  while (offset < length) {
    const attrType = buf[offset];
    const attrLen = buf[offset + 1];
    if (attrLen < 2) break;
    const attrVal = buf.subarray(offset + 2, offset + attrLen);

    if (attrType === ATTR_TYPE.VENDOR_SPECIFIC && attrVal.length >= 6) {
      const vendorId = attrVal.readUInt32BE(0);
      const vType = attrVal[4];
      const vLen = attrVal[5];
      const vVal = attrVal.subarray(6, 6 + (vLen - 2));
      if (vendorId === MIKROTIK_VENDOR_ID && vType === MIKROTIK_ATTR.RATE_LIMIT) {
        attributes['Mikrotik-Rate-Limit'] = vVal.toString('utf8');
      }
    } else if (attrType === ATTR_TYPE.FRAMED_IP_ADDRESS && attrVal.length === 4) {
      attributes['Framed-IP-Address'] = Array.from(attrVal).join('.');
    } else if (attrType === ATTR_TYPE.FRAMED_PROTOCOL) {
      attributes['Framed-Protocol'] = attrVal.readUInt32BE(0);
    } else if (attrType === ATTR_TYPE.SERVICE_TYPE) {
      attributes['Service-Type'] = attrVal.readUInt32BE(0);
    } else if (attrType === 27) { // Session-Timeout
      attributes['Session-Timeout'] = attrVal.readUInt32BE(0);
    } else if (attrType === 85) { // Acct-Interim-Interval
      attributes['Acct-Interim-Interval'] = attrVal.readUInt32BE(0);
    } else if (attrType === 88) { // Framed-Pool
      attributes['Framed-Pool'] = attrVal.toString('utf8');
    }

    offset += attrLen;
  }

  return {
    code,
    identifier,
    length,
    authenticator,
    attributes,
  };
}

/**
 * Send UDP packet and await response
 */
function sendRadiusPacket(packet, port, host = RADIUS_HOST, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      client.close();
      reject(new Error(`RADIUS timeout after ${timeoutMs}ms on port ${port}`));
    }, timeoutMs);

    client.on('message', (msg) => {
      clearTimeout(timer);
      client.close();
      try {
        const parsed = parseRadiusResponse(msg);
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      client.close();
      reject(err);
    });

    client.send(packet, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        client.close();
        reject(err);
      }
    });
  });
}

test('FreeRADIUS AAA Integration: MikroTik Rate-Limit Mapping & Full AAA Packet Support', async (t) => {
  // 1. Seed test users first
  await seedRadiusTestUsers();

  await t.test('1. Access-Request (50 Mbps Active Subscriber): Expects Access-Accept with 25M/50M Rate-Limit', async () => {
    const { packet } = buildAccessRequest(10, 'speed_50m_user', 'pass123', RADIUS_SECRET);
    const response = await sendRadiusPacket(packet, AUTH_PORT);

    assert.equal(response.code, RADIUS_CODE.ACCESS_ACCEPT, 'Expected Access-Accept');
    assert.equal(response.identifier, 10);
    assert.equal(
      response.attributes['Mikrotik-Rate-Limit'],
      '25M/50M',
      'Expected 25M upload / 50M download rate limit',
    );
    assert.equal(response.attributes['Framed-IP-Address'], '100.64.10.50');
    assert.equal(response.attributes['Framed-Protocol'], 1); // PPP
    assert.equal(response.attributes['Service-Type'], 2); // Framed-User
    assert.equal(response.attributes['Acct-Interim-Interval'], 300);
  });

  await t.test('2. Access-Request (100 Mbps Active Subscriber): Expects Access-Accept with 50M/100M Rate-Limit', async () => {
    const { packet } = buildAccessRequest(11, 'speed_100m_user', 'pass123', RADIUS_SECRET);
    const response = await sendRadiusPacket(packet, AUTH_PORT);

    assert.equal(response.code, RADIUS_CODE.ACCESS_ACCEPT, 'Expected Access-Accept');
    assert.equal(response.identifier, 11);
    assert.equal(
      response.attributes['Mikrotik-Rate-Limit'],
      '50M/100M',
      'Expected 50M upload / 100M download rate limit',
    );
    assert.equal(response.attributes['Framed-IP-Address'], '100.64.10.100');
  });

  await t.test('3. Access-Request (200 Mbps Active Subscriber): Expects Access-Accept with 100M/200M Rate-Limit', async () => {
    const { packet } = buildAccessRequest(12, 'speed_200m_user', 'pass123', RADIUS_SECRET);
    const response = await sendRadiusPacket(packet, AUTH_PORT);

    assert.equal(response.code, RADIUS_CODE.ACCESS_ACCEPT, 'Expected Access-Accept');
    assert.equal(response.identifier, 12);
    assert.equal(
      response.attributes['Mikrotik-Rate-Limit'],
      '100M/200M',
      'Expected 100M upload / 200M download rate limit',
    );
    assert.equal(response.attributes['Framed-IP-Address'], '100.64.10.200');
  });

  await t.test('4. Access-Request (Suspended Subscriber): Expects Access-Reject', async () => {
    const { packet } = buildAccessRequest(13, 'suspended_user', 'pass123', RADIUS_SECRET);
    const response = await sendRadiusPacket(packet, AUTH_PORT);

    assert.equal(response.code, RADIUS_CODE.ACCESS_REJECT, 'Suspended subscriber must receive Access-Reject');
    assert.equal(response.identifier, 13);
  });

  await t.test('5. Access-Request (Expired Subscriber): Expects Access-Reject', async () => {
    const { packet } = buildAccessRequest(14, 'expired_user', 'pass123', RADIUS_SECRET);
    const response = await sendRadiusPacket(packet, AUTH_PORT);

    assert.equal(response.code, RADIUS_CODE.ACCESS_REJECT, 'Expired subscriber must receive Access-Reject');
    assert.equal(response.identifier, 14);
  });

  await t.test('6. Access-Request (Wrong Password): Expects Access-Reject', async () => {
    const { packet } = buildAccessRequest(15, 'speed_100m_user', 'WRONG_PASSWORD_XYZ', RADIUS_SECRET);
    const response = await sendRadiusPacket(packet, AUTH_PORT);

    assert.equal(response.code, RADIUS_CODE.ACCESS_REJECT, 'Invalid password must receive Access-Reject');
    assert.equal(response.identifier, 15);
  });

  await t.test('7. Accounting Lifecycle (Start ➔ Interim ➔ Stop): Verifies PostgreSQL radacct Session Management', async () => {
    const sessionId = `mt_sess_${Date.now()}`;
    const username = 'speed_100m_user';
    const framedIp = '100.64.10.100';

    // 7.1 Accounting Start
    const startPacket = buildAccountingRequest(20, 1, sessionId, username, RADIUS_SECRET, {
      framedIp,
    });
    const startResp = await sendRadiusPacket(startPacket, ACCT_PORT);
    assert.equal(startResp.code, RADIUS_CODE.ACCOUNTING_RESPONSE, 'Expected Accounting-Response for Start');

    // Verify row in database radacct
    let acctRow = await prisma.radAcct.findFirst({
      where: { acctsessionid: sessionId, username },
    });
    assert.ok(acctRow, 'Session record must be created in radacct on Accounting-Start');
    assert.ok(
      acctRow.framedipaddress.startsWith(framedIp),
      `Expected framedipaddress to start with ${framedIp}, got ${acctRow.framedipaddress}`,
    );
    assert.ok(acctRow.acctstarttime !== null, 'acctstarttime must be set');
    assert.equal(acctRow.acctstoptime, null, 'acctstoptime must be null for active session');

    // 7.2 Accounting Interim-Update (after 300s, 10 MB downloaded, 2 MB uploaded)
    const interimPacket = buildAccountingRequest(21, 3, sessionId, username, RADIUS_SECRET, {
      framedIp,
      sessionTime: 300,
      inputOctets: 2097152, // 2 MB upload
      outputOctets: 10485760, // 10 MB download
    });
    const interimResp = await sendRadiusPacket(interimPacket, ACCT_PORT);
    assert.equal(interimResp.code, RADIUS_CODE.ACCOUNTING_RESPONSE, 'Expected Accounting-Response for Interim');

    // Verify updated row in database radacct
    acctRow = await prisma.radAcct.findFirst({
      where: { acctsessionid: sessionId, username },
    });
    assert.ok(acctRow);
    assert.equal(Number(acctRow.acctsessiontime), 300);
    assert.equal(Number(acctRow.acctinputoctets), 2097152);
    assert.equal(Number(acctRow.acctoutputoctets), 10485760);
    assert.equal(acctRow.acctstoptime, null);

    // 7.3 Accounting Stop (session ended by user, final 15 MB / 3 MB, session time 600s)
    const stopPacket = buildAccountingRequest(22, 2, sessionId, username, RADIUS_SECRET, {
      framedIp,
      sessionTime: 600,
      inputOctets: 3145728, // 3 MB upload
      outputOctets: 15728640, // 15 MB download
      terminateCause: 1, // User-Request
    });
    const stopResp = await sendRadiusPacket(stopPacket, ACCT_PORT);
    assert.equal(stopResp.code, RADIUS_CODE.ACCOUNTING_RESPONSE, 'Expected Accounting-Response for Stop');

    // Verify session closed in database radacct
    acctRow = await prisma.radAcct.findFirst({
      where: { acctsessionid: sessionId, username },
    });
    assert.ok(acctRow);
    assert.ok(acctRow.acctstoptime !== null, 'acctstoptime must be set upon Accounting-Stop');
    assert.equal(Number(acctRow.acctsessiontime), 600);
    assert.equal(Number(acctRow.acctinputoctets), 3145728);
    assert.equal(Number(acctRow.acctoutputoctets), 15728640);
  });
});
