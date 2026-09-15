import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { prisma } from '@isp-crm/database';
import { decryptCredential } from '../dist/common/utils/crypto.util.js';
import { RouterOsBinaryClient } from '../dist/modules/routers/clients/routeros-binary.client.js';
import { RadiusCoaClient, RADIUS_COA_CODE } from '@isp-crm/shared';

const RADIUS_HOST = process.env.RADIUS_HOST || 'ispcrm-freeradius';
const AUTH_PORT = 1812;
const ACCT_PORT = 1813;
const RADIUS_SECRET = 'testing123';

const POOL_MIN_IP = '172.18.23.2';
const POOL_MAX_IP = '172.18.23.254';

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isIpInPppoePool(ip) {
  if (!ip) return false;
  const cleanIp = ip.replace(/\/32$/, '');
  const ipLong = ipToLong(cleanIp);
  const minLong = ipToLong(POOL_MIN_IP);
  const maxLong = ipToLong(POOL_MAX_IP);
  return ipLong >= minLong && ipLong <= maxLong;
}

const RADIUS_CODE = {
  ACCESS_REQUEST: 1,
  ACCESS_ACCEPT: 2,
  ACCESS_REJECT: 3,
  ACCOUNTING_REQUEST: 4,
  ACCOUNTING_RESPONSE: 5,
};

const ATTR_TYPE = {
  USER_NAME: 1,
  USER_PASSWORD: 2,
  NAS_IP_ADDRESS: 4,
  NAS_PORT: 5,
  SERVICE_TYPE: 6,
  FRAMED_PROTOCOL: 7,
  FRAMED_IP_ADDRESS: 8,
  CALLING_STATION_ID: 31,
  VENDOR_SPECIFIC: 26,
  ACCT_STATUS_TYPE: 40,
  ACCT_DELAY_TIME: 41,
  ACCT_INPUT_OCTETS: 42,
  ACCT_OUTPUT_OCTETS: 43,
  ACCT_SESSION_ID: 44,
  ACCT_AUTHENTIC: 45,
  ACCT_SESSION_TIME: 46,
  ACCT_TERMINATE_CAUSE: 49,
  FRAMED_POOL: 88,
};

const MIKROTIK_VENDOR_ID = 14988;
const MIKROTIK_ATTR = {
  RATE_LIMIT: 8,
};

function encryptPassword(password, secret, authenticator) {
  const passBuffer = Buffer.from(password, 'utf8');
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

function buildAccessRequest(id, username, password, secret, extraAttrs = {}) {
  const authenticator = crypto.randomBytes(16);
  const encPass = encryptPassword(password, secret, authenticator);

  const rawAttrs = [
    encodeAttribute(ATTR_TYPE.USER_NAME, username),
    encodeAttribute(ATTR_TYPE.USER_PASSWORD, encPass),
    encodeIpAttribute(ATTR_TYPE.NAS_IP_ADDRESS, extraAttrs.nasIp || '10.200.0.6'),
    encodeAttribute(ATTR_TYPE.NAS_PORT, 1),
    encodeAttribute(ATTR_TYPE.SERVICE_TYPE, 2), // Framed-User
    encodeAttribute(ATTR_TYPE.FRAMED_PROTOCOL, 1), // PPP
  ];

  if (extraAttrs.callingStationId) {
    rawAttrs.push(encodeAttribute(ATTR_TYPE.CALLING_STATION_ID, extraAttrs.callingStationId));
  }

  const attrs = Buffer.concat(rawAttrs);
  const length = 20 + attrs.length;
  const packet = Buffer.alloc(length);
  packet[0] = RADIUS_CODE.ACCESS_REQUEST;
  packet[1] = id;
  packet.writeUInt16BE(length, 2);
  authenticator.copy(packet, 4);
  attrs.copy(packet, 20);

  return { packet, authenticator };
}

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
    } else if (attrType === 85) {
      attributes['Acct-Interim-Interval'] = attrVal.readUInt32BE(0);
    } else if (attrType === ATTR_TYPE.FRAMED_POOL) {
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

function buildAccountingRequest(id, statusType, sessionId, username, secret, extraAttrs = {}) {
  const rawAttrs = [
    encodeAttribute(ATTR_TYPE.ACCT_STATUS_TYPE, statusType),
    encodeAttribute(ATTR_TYPE.ACCT_SESSION_ID, sessionId),
    encodeAttribute(ATTR_TYPE.USER_NAME, username),
    encodeIpAttribute(ATTR_TYPE.NAS_IP_ADDRESS, extraAttrs.nasIp || '10.200.0.6'),
    encodeAttribute(ATTR_TYPE.NAS_PORT, 1),
    encodeAttribute(ATTR_TYPE.SERVICE_TYPE, 2),
    encodeAttribute(ATTR_TYPE.FRAMED_PROTOCOL, 1),
    encodeAttribute(ATTR_TYPE.ACCT_AUTHENTIC, 1),
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
  packet.fill(0, 4, 20);
  attrs.copy(packet, 20);

  const authDigest = crypto
    .createHash('md5')
    .update(packet)
    .update(Buffer.from(secret, 'utf8'))
    .digest();
  authDigest.copy(packet, 4);

  return packet;
}

test('CORE REGRESSION GATE: End-to-End ISPCRM RADIUS, PPPoE Pool, Accounting & MikroTik Lifecycle', async (t) => {
  // Fetch physical test subscriber credentials from PostgreSQL
  const checkRows = await prisma.radCheck.findMany({
    where: { username: 'dipak@ispcrm' },
  });

  const passRow = checkRows.find((r) => r.attribute === 'Cleartext-Password');
  const macRow = checkRows.find((r) => r.attribute === 'Calling-Station-Id');
  assert.ok(passRow, 'Subscriber dipak@ispcrm must have Cleartext-Password in radcheck');

  const subscriberPassword = passRow.value;
  const subscriberCallingStationId = macRow?.value;

  // Fetch physical router details
  const router = await prisma.router.findFirst({
    where: { vpnIp: '10.200.0.6' },
  });
  assert.ok(router, 'Physical router with vpnIp 10.200.0.6 must exist in database');

  const routerPassword = decryptCredential(router.encryptedCredential);
  const routerConfig = {
    host: router.vpnIp || router.host,
    port: router.port || 8728,
    username: router.username,
    password: routerPassword,
    timeoutMs: 8000,
  };
  const routerClient = new RouterOsBinaryClient();

  // 1. RADIUS Access-Accept contains Framed-Pool=pppoe
  await t.test('1. RADIUS Access-Accept contains Framed-Pool=pppoe', async () => {
    const { packet } = buildAccessRequest(51, 'dipak@ispcrm', subscriberPassword, RADIUS_SECRET, {
      callingStationId: subscriberCallingStationId,
    });
    const response = await sendRadiusPacket(packet, AUTH_PORT);

    assert.equal(response.code, RADIUS_CODE.ACCESS_ACCEPT, 'Expected Access-Accept for dipak@ispcrm');
    assert.equal(
      response.attributes['Framed-Pool'],
      'pppoe',
      'Expected Framed-Pool attribute to equal "pppoe"',
    );
  });

  // 2. No unintended Framed-IP-Address is returned
  await t.test('2. No unintended Framed-IP-Address is returned', async () => {
    const { packet } = buildAccessRequest(52, 'dipak@ispcrm', subscriberPassword, RADIUS_SECRET, {
      callingStationId: subscriberCallingStationId,
    });
    const response = await sendRadiusPacket(packet, AUTH_PORT);

    assert.equal(response.code, RADIUS_CODE.ACCESS_ACCEPT);
    assert.equal(
      response.attributes['Framed-IP-Address'],
      undefined,
      'Pool-allocated subscriber MUST NOT receive Framed-IP-Address in RADIUS reply',
    );
  });

  // 3. PPPoE pool allocation behavior & pool enforcement check
  await t.test('3. PPPoE pool allocation behavior & strict boundary verification', async () => {
    // 3a. Verify pool boundary assertion fails on unexpected alien addresses
    const rogueIp = '10.255.142.165';
    assert.equal(
      isIpInPppoePool(rogueIp),
      false,
      'Alien address 10.255.142.165 MUST be detected as outside ISPCRM pool',
    );

    // 3b. Verify boundary check passes on legitimate pool addresses
    assert.equal(isIpInPppoePool('172.18.23.2'), true);
    assert.equal(isIpInPppoePool('172.18.23.154'), true);
    assert.equal(isIpInPppoePool('172.18.23.254'), true);
    assert.equal(isIpInPppoePool('172.18.23.1'), false); // Gateway
    assert.equal(isIpInPppoePool('172.18.23.255'), false); // Broadcast

    // 3c. Inspect physical MikroTik active session address
    const [activeSessions] = await routerClient['executeCommands'](routerConfig, [
      ['/ppp/active/print', '?name=dipak@ispcrm'],
    ]);

    let sessionAddress = null;
    for (const item of activeSessions) {
      if (item.type === '!re') {
        sessionAddress = item.attributes.address;
        break;
      }
    }

    assert.ok(sessionAddress, 'Active physical PPPoE session must be present on MikroTik');
    assert.ok(
      isIpInPppoePool(sessionAddress),
      `CRITICAL REGRESSION: Subscriber IP ${sessionAddress} is outside configured pool [172.18.23.2-172.18.23.254]!`,
    );
  });

  // 4. Rate limiting verification
  await t.test('4. Rate limiting verification (RADIUS reply & MikroTik dynamic queue)', async () => {
    const { packet } = buildAccessRequest(53, 'dipak@ispcrm', subscriberPassword, RADIUS_SECRET, {
      callingStationId: subscriberCallingStationId,
    });
    const response = await sendRadiusPacket(packet, AUTH_PORT);

    assert.equal(response.code, RADIUS_CODE.ACCESS_ACCEPT);
    assert.equal(
      response.attributes['Mikrotik-Rate-Limit'],
      '100M/200M',
      'Expected 100M upload / 200M download rate limit',
    );

    // Verify dynamic queue in MikroTik
    const [queues] = await routerClient['executeCommands'](routerConfig, [
      ['/queue/simple/print', '?name=<pppoe-dipak@ispcrm>'],
    ]);

    let queueFound = false;
    for (const q of queues) {
      if (q.type === '!re') {
        queueFound = true;
        assert.ok(
          q.attributes['max-limit'] === '100M/200M' || q.attributes['max-limit'] === '100000000/200000000',
          `Expected max-limit to be 100M/200M or 100000000/200000000, got ${q.attributes['max-limit']}`,
        );
        assert.equal(q.attributes['dynamic'], 'true');
        break;
      }
    }
    assert.ok(queueFound, 'Dynamic simple queue <pppoe-dipak@ispcrm> must exist on router');
  });

  // 5. Accounting lifecycle
  await t.test('5. Accounting lifecycle (Start ➔ Interim ➔ Stop)', async () => {
    const sessionId = `reg_sess_${Date.now()}`;
    const testUsername = 'dipak@ispcrm';
    const testFramedIp = '172.18.23.154';

    // 5.1 Accounting Start
    const startPacket = buildAccountingRequest(61, 1, sessionId, testUsername, RADIUS_SECRET, {
      framedIp: testFramedIp,
      nasIp: '10.200.0.6',
    });
    const startResp = await sendRadiusPacket(startPacket, ACCT_PORT);
    assert.equal(startResp.code, RADIUS_CODE.ACCOUNTING_RESPONSE, 'Expected Accounting-Response for Start');

    let acctRow = await prisma.radAcct.findFirst({
      where: { acctsessionid: sessionId, username: testUsername },
    });
    assert.ok(acctRow, 'Session record must be created in radacct on Accounting-Start');
    assert.equal(acctRow.nasipaddress, '10.200.0.6');
    assert.ok(acctRow.acctstarttime !== null, 'acctstarttime must be set');
    assert.equal(acctRow.acctstoptime, null, 'acctstoptime must be null for active session');

    // 5.2 Accounting Interim
    const interimPacket = buildAccountingRequest(62, 3, sessionId, testUsername, RADIUS_SECRET, {
      framedIp: testFramedIp,
      nasIp: '10.200.0.6',
      sessionTime: 60,
      inputOctets: 1048576,
      outputOctets: 5242880,
    });
    const interimResp = await sendRadiusPacket(interimPacket, ACCT_PORT);
    assert.equal(interimResp.code, RADIUS_CODE.ACCOUNTING_RESPONSE, 'Expected Accounting-Response for Interim');

    acctRow = await prisma.radAcct.findFirst({
      where: { acctsessionid: sessionId, username: testUsername },
    });
    assert.ok(acctRow);
    assert.equal(Number(acctRow.acctsessiontime), 60);
    assert.equal(Number(acctRow.acctinputoctets), 1048576);
    assert.equal(Number(acctRow.acctoutputoctets), 5242880);
    assert.equal(acctRow.acctstoptime, null);

    // 5.3 Accounting Stop
    const stopPacket = buildAccountingRequest(63, 2, sessionId, testUsername, RADIUS_SECRET, {
      framedIp: testFramedIp,
      nasIp: '10.200.0.6',
      sessionTime: 120,
      inputOctets: 2097152,
      outputOctets: 10485760,
      terminateCause: 1, // User-Request
    });
    const stopResp = await sendRadiusPacket(stopPacket, ACCT_PORT);
    assert.equal(stopResp.code, RADIUS_CODE.ACCOUNTING_RESPONSE, 'Expected Accounting-Response for Stop');

    acctRow = await prisma.radAcct.findFirst({
      where: { acctsessionid: sessionId, username: testUsername },
    });
    assert.ok(acctRow);
    assert.ok(acctRow.acctstoptime !== null, 'acctstoptime must be set upon Accounting-Stop');
    assert.equal(Number(acctRow.acctsessiontime), 120);
    assert.equal(Number(acctRow.acctinputoctets), 2097152);
    assert.equal(Number(acctRow.acctoutputoctets), 10485760);
  });

  // 6. RFC 3576 Disconnect
  await t.test('6. RFC 3576 Disconnect / PoD on Physical Router', async () => {
    const disconnRes = await RadiusCoaClient.sendDisconnectRequest({
      nasIp: '10.200.0.6',
      nasPort: 3799,
      secret: router.radiusSecret,
      username: 'dipak@ispcrm',
      timeoutMs: 3000,
      maxRetries: 1,
    });

    assert.equal(disconnRes.success, true, `Disconnect failed: ${disconnRes.error}`);
    assert.equal(disconnRes.codeName, 'DISCONNECT_ACK');
    assert.equal(disconnRes.code, RADIUS_COA_CODE.DISCONNECT_ACK);

    // Allow RouterOS to teardown session
    await new Promise((r) => setTimeout(r, 1500));
  });

  // 7. Reconnect verification
  await t.test('7. Subscriber Reconnect and Session Resumption in Configured Pool', async () => {
    let reconnectedSession = null;
    for (let attempt = 1; attempt <= 15; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const [check] = await routerClient['executeCommands'](routerConfig, [
        ['/ppp/active/print', '?name=dipak@ispcrm'],
      ]);

      for (const s of check) {
        if (s.type === '!re') {
          reconnectedSession = s.attributes;
          break;
        }
      }
      if (reconnectedSession) break;
    }

    assert.ok(reconnectedSession, 'Subscriber dipak@ispcrm must reconnect to physical MikroTik');
    assert.equal(reconnectedSession.radius, 'true', 'Reconnected session must have RADIUS flag');
    assert.equal(reconnectedSession.service, 'pppoe', 'Service must be pppoe');
    assert.ok(
      isIpInPppoePool(reconnectedSession.address),
      `CRITICAL REGRESSION: Reconnected IP ${reconnectedSession.address} is outside configured pool [172.18.23.2-172.18.23.254]!`,
    );

    // Verify dynamic queue restored
    const [queues] = await routerClient['executeCommands'](routerConfig, [
      ['/queue/simple/print', '?name=<pppoe-dipak@ispcrm>'],
    ]);

    let queueFound = false;
    for (const q of queues) {
      if (q.type === '!re') {
        queueFound = true;
        assert.ok(
          q.attributes['max-limit'] === '100M/200M' || q.attributes['max-limit'] === '100000000/200000000',
          `Expected max-limit to be 100M/200M or 100000000/200000000, got ${q.attributes['max-limit']}`,
        );
        break;
      }
    }
    assert.ok(queueFound, 'Dynamic queue must be re-established upon reconnect');
  });

  // 8. Tenant isolation
  await t.test('8. Tenant isolation & Realm Security Verification', async () => {
    // 8a. Request with unknown realm
    const { packet: alienPacket } = buildAccessRequest(
      71,
      'dipak@unknownrealm',
      'somepassword',
      RADIUS_SECRET,
    );
    const alienResp = await sendRadiusPacket(alienPacket, AUTH_PORT);
    assert.equal(
      alienResp.code,
      RADIUS_CODE.ACCESS_REJECT,
      'Subscribers from unknown realms MUST receive Access-Reject',
    );

    // 8b. Request with invalid password for valid tenant
    const { packet: invalidPassPacket } = buildAccessRequest(
      72,
      'dipak@ispcrm',
      'WRONG_PASSWORD_FAIL',
      RADIUS_SECRET,
    );
    const invalidPassResp = await sendRadiusPacket(invalidPassPacket, AUTH_PORT);
    assert.equal(
      invalidPassResp.code,
      RADIUS_CODE.ACCESS_REJECT,
      'Invalid credentials MUST receive Access-Reject',
    );

    // 8c. Physical router non-ISPCRM session isolation: verify other sessions are preserved
    const [allSessions] = await routerClient['executeCommands'](routerConfig, [
      ['/ppp/active/print'],
    ]);

    const totalSessions = allSessions.filter((s) => s.type === '!re').length;
    assert.ok(
      totalSessions > 50,
      `Expected production sessions to remain untouched (> 50 sessions), found ${totalSessions}`,
    );
  });
});
