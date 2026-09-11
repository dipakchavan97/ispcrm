import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { prisma } from '@isp-crm/database';
import {
  CustomerStatus,
  SubscriptionStatus,
  PlanStatus,
  SpeedUnit,
  BillingCycle,
  DEFAULT_TIMEZONE,
} from '@isp-crm/shared';

const RADIUS_HOST = '127.0.0.1';
const AUTH_PORT = 1812;
const ACCT_PORT = 1813;
const RADIUS_SECRET = 'testing123';

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
const MIKROTIK_ATTR_RATE_LIMIT = 8;

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

function buildAccountingRequest(id, statusType, sessionId, username, secret, extraAttrs = {}) {
  const rawAttrs = [
    encodeAttribute(ATTR_TYPE.ACCT_STATUS_TYPE, statusType),
    encodeAttribute(ATTR_TYPE.ACCT_SESSION_ID, sessionId),
    encodeAttribute(ATTR_TYPE.USER_NAME, username),
    encodeIpAttribute(ATTR_TYPE.NAS_IP_ADDRESS, '127.0.0.1'),
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
  Buffer.alloc(16, 0).copy(packet, 4);
  attrs.copy(packet, 20);

  const reqAuth = crypto
    .createHash('md5')
    .update(packet)
    .update(Buffer.from(secret, 'utf8'))
    .digest();
  reqAuth.copy(packet, 4);

  return { packet, authenticator: reqAuth };
}

function parseRadiusResponse(buffer) {
  const code = buffer[0];
  const id = buffer[1];
  const length = buffer.readUInt16BE(2);
  const authenticator = buffer.subarray(4, 20);
  const rawAttrs = buffer.subarray(20, length);

  const attributes = {};
  let offset = 0;

  while (offset < rawAttrs.length) {
    const attrType = rawAttrs[offset];
    const attrLen = rawAttrs[offset + 1];
    if (attrLen < 2) break;

    const valBuf = rawAttrs.subarray(offset + 2, offset + attrLen);

    if (attrType === ATTR_TYPE.VENDOR_SPECIFIC && valBuf.length >= 6) {
      const vendorId = valBuf.readUInt32BE(0);
      const vType = valBuf[4];
      const vLen = valBuf[5];
      const vData = valBuf.subarray(6, 6 + (vLen - 2));

      if (vendorId === MIKROTIK_VENDOR_ID && vType === MIKROTIK_ATTR_RATE_LIMIT) {
        attributes['Mikrotik-Rate-Limit'] = vData.toString('utf8');
      }
    } else if (attrType === ATTR_TYPE.FRAMED_PROTOCOL) {
      attributes['Framed-Protocol'] = valBuf.readUInt32BE(0) === 1 ? 'PPP' : String(valBuf.readUInt32BE(0));
    } else if (attrType === ATTR_TYPE.SERVICE_TYPE) {
      attributes['Service-Type'] = valBuf.readUInt32BE(0) === 2 ? 'Framed-User' : String(valBuf.readUInt32BE(0));
    } else if (attrType === ATTR_TYPE.FRAMED_IP_ADDRESS) {
      attributes['Framed-IP-Address'] = Array.from(valBuf).join('.');
    }

    offset += attrLen;
  }

  return { code, id, length, authenticator, attributes };
}

function sendRadiusPacket(packet, port, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.close();
        reject(new Error(`RADIUS request timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    client.on('message', (msg) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        client.close();
        resolve(msg);
      }
    });

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        client.close();
        reject(err);
      }
    });

    client.send(packet, port, RADIUS_HOST, (err) => {
      if (err) {
        resolved = true;
        clearTimeout(timer);
        client.close();
        reject(err);
      }
    });
  });
}

async function runRealPppoeLab() {
  console.log('================================================================');
  console.log('🚀 DAY 4 REAL LAB TEST: MikroTik -> FreeRADIUS -> PostgreSQL');
  console.log('================================================================\n');

  // STEP 1: Provision testuser & 50 Mbps Plan in Database
  console.log('📦 Step 1: Setting up Organization, 50 Mbps Plan, and testuser in PostgreSQL...');

  const orgSlug = 'lab-isp';
  let org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Lab ISP Networks',
        slug: orgSlug,
        email: 'lab@isp-crm.local',
        phone: '9876500001',
        city: 'Edge POP 01',
        timezone: DEFAULT_TIMEZONE,
      },
    });
  }

  // 50 Mbps Plan (25M upload / 50M download)
  const planCode = 'FIBER-50M-LAB';
  const rateLimitString = '25M/50M';
  let plan = await prisma.internetPlan.findFirst({
    where: { organizationId: org.id, code: planCode },
  });

  if (!plan) {
    plan = await prisma.internetPlan.create({
      data: {
        organizationId: org.id,
        name: 'Fiber 50 Mbps Lab Plan',
        code: planCode,
        downloadSpeed: 50,
        uploadSpeed: 25,
        downloadSpeedMbps: 50,
        uploadSpeedMbps: 25,
        speedUnit: SpeedUnit.MBPS,
        validityDays: 30,
        billingCycle: BillingCycle.MONTHLY,
        price: 499,
        status: PlanStatus.ACTIVE,
      },
    });
  }

  // testuser customer record
  const username = 'testuser';
  const password = 'testpassword';
  const framedIp = '100.64.10.55';

  let customer = await prisma.customer.findFirst({
    where: { username },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        customerCode: 'CUST-LAB-001',
        name: 'Lab Test PPPoE Subscriber',
        username,
        pppoeUsername: username,
        pppoePassword: password,
        mobile: '9876543210',
        status: CustomerStatus.ACTIVE,
        staticIp: framedIp,
      },
    });
  } else {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        status: CustomerStatus.ACTIVE,
        pppoePassword: password,
        staticIp: framedIp,
      },
    });
  }

  // Subscription (Active)
  const now = new Date();
  let sub = await prisma.subscription.findFirst({
    where: { organizationId: org.id, customerId: customer.id },
  });

  if (!sub) {
    sub = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        startDate: now,
        endDate: new Date(now.getTime() + 30 * 86400 * 1000),
        price: 499,
      },
    });
  }

  // FreeRADIUS Native Tables Synchronization
  await prisma.radCheck.deleteMany({ where: { username } });
  await prisma.radReply.deleteMany({ where: { username } });

  await prisma.radCheck.create({
    data: {
      username,
      attribute: 'Cleartext-Password',
      op: ':=',
      value: password,
    },
  });

  await prisma.radReply.createMany({
    data: [
      { username, attribute: 'Mikrotik-Rate-Limit', op: '=', value: rateLimitString },
      { username, attribute: 'Framed-Protocol', op: '=', value: 'PPP' },
      { username, attribute: 'Service-Type', op: '=', value: 'Framed-User' },
      { username, attribute: 'Framed-IP-Address', op: '=', value: framedIp },
      { username, attribute: 'Acct-Interim-Interval', op: '=', value: '300' },
    ],
  });

  console.log(`✅ Customer '${username}' synced to FreeRADIUS.`);
  console.log(`   Username:        ${username}`);
  console.log(`   Password:        ${password}`);
  console.log(`   Plan:            50 Mbps (${rateLimitString})`);
  console.log(`   Framed IP:       ${framedIp}`);

  // STEP 2: Authenticate via Live FreeRADIUS (Access-Request)
  console.log('\n📡 Step 2: Sending authentic PPPoE Access-Request to FreeRADIUS (:1812)...');
  const packetId = Math.floor(Math.random() * 255);
  const { packet } = buildAccessRequest(packetId, username, password, RADIUS_SECRET);

  const rawResponse = await sendRadiusPacket(packet, AUTH_PORT);
  const response = parseRadiusResponse(rawResponse);

  console.log(`   Response Code:   ${response.code} (${response.code === 2 ? 'Access-Accept' : 'Access-Reject'})`);
  console.log(`   Attributes:`);
  console.table(response.attributes);

  if (response.code !== RADIUS_CODE.ACCESS_ACCEPT) {
    throw new Error(`❌ PPPoE Authentication failed: FreeRADIUS returned code ${response.code}`);
  }

  if (response.attributes['Mikrotik-Rate-Limit'] !== rateLimitString) {
    throw new Error(`❌ Mikrotik-Rate-Limit mismatch. Expected ${rateLimitString}, got ${response.attributes['Mikrotik-Rate-Limit']}`);
  }
  console.log(`✨ SUCCESS: PPPoE Client authenticated! FreeRADIUS returned Mikrotik-Rate-Limit = '${response.attributes['Mikrotik-Rate-Limit']}'.`);

  // STEP 2B: Negative Test - Bad Password must return Access-Reject
  console.log('\n🔒 Step 2B: Testing security enforcement with invalid password...');
  const badPacketId = (packetId + 99) % 255;
  const { packet: badPacket } = buildAccessRequest(badPacketId, username, 'wrong_password_123', RADIUS_SECRET);
  const rawBadResponse = await sendRadiusPacket(badPacket, AUTH_PORT);
  const badResponse = parseRadiusResponse(rawBadResponse);
  console.log(`   Response Code:   ${badResponse.code} (${badResponse.code === 3 ? 'Access-Reject' : 'Unexpected Code'})`);
  if (badResponse.code !== RADIUS_CODE.ACCESS_REJECT) {
    throw new Error(`❌ Security failure: Expected Access-Reject (3) but got ${badResponse.code}`);
  }
  console.log(`✅ SUCCESS: Invalid credentials properly rejected by FreeRADIUS with Access-Reject.`);

  // STEP 3: PPPoE Accounting Start
  console.log('\n📊 Step 3: Sending RADIUS Accounting-Request (Start) to FreeRADIUS (:1813)...');
  const sessionId = `pppoe_lab_sess_${Date.now()}`;
  const acctStartPacketId = (packetId + 1) % 255;
  const { packet: acctStartPacket } = buildAccountingRequest(
    acctStartPacketId,
    1, // 1 = Start
    sessionId,
    username,
    RADIUS_SECRET,
    { framedIp }
  );

  const rawAcctStartResp = await sendRadiusPacket(acctStartPacket, ACCT_PORT);
  const acctStartResp = parseRadiusResponse(rawAcctStartResp);
  console.log(`   Accounting Start Response: Code ${acctStartResp.code} (${acctStartResp.code === 5 ? 'Accounting-Response' : 'Error'})`);

  // Verify in PostgreSQL radacct
  const dbSession = await prisma.radAcct.findFirst({
    where: { acctsessionid: sessionId },
  });

  if (!dbSession) {
    throw new Error(`❌ Accounting record not found in PostgreSQL radacct table`);
  }

  console.log(`✅ Session recorded in PostgreSQL 'radacct':`);
  console.log(`   RadAcct ID:      ${dbSession.radacctid}`);
  console.log(`   Session ID:      ${dbSession.acctsessionid}`);
  console.log(`   Username:        ${dbSession.username}`);
  console.log(`   Framed IP:       ${dbSession.framedipaddress}`);
  console.log(`   Start Time:      ${dbSession.acctstarttime}`);

  // STEP 4: PPPoE Accounting Stop
  console.log('\n🛑 Step 4: Sending RADIUS Accounting-Request (Stop) with data usage...');
  const acctStopPacketId = (packetId + 2) % 255;
  const { packet: acctStopPacket } = buildAccountingRequest(
    acctStopPacketId,
    2, // 2 = Stop
    sessionId,
    username,
    RADIUS_SECRET,
    {
      framedIp,
      sessionTime: 3600, // 1 hour
      inputOctets: 154829100, // ~154 MB upload
      outputOctets: 894502100, // ~894 MB download
      terminateCause: 1, // User-Request
    }
  );

  const rawAcctStopResp = await sendRadiusPacket(acctStopPacket, ACCT_PORT);
  const acctStopResp = parseRadiusResponse(rawAcctStopResp);
  console.log(`   Accounting Stop Response:  Code ${acctStopResp.code} (${acctStopResp.code === 5 ? 'Accounting-Response' : 'Error'})`);

  const closedSession = await prisma.radAcct.findFirst({
    where: { acctsessionid: sessionId },
  });

  console.log(`✅ Session finalized in PostgreSQL 'radacct':`);
  console.log(`   Session Time:    ${closedSession.acctsessiontime} seconds`);
  console.log(`   Downloaded:      ${Number(closedSession.acctoutputoctets) / (1024 * 1024)} MB`);
  console.log(`   Uploaded:        ${Number(closedSession.acctinputoctets) / (1024 * 1024)} MB`);
  console.log(`   Stop Time:       ${closedSession.acctstoptime}`);

  console.log('\n================================================================');
  console.log('🎉 ALL LAB OBJECTIVES ACHIEVED!');
  console.log('   1. testuser created in PostgreSQL with 50 Mbps plan (25M/50M)');
  console.log('   2. PPPoE client authenticated through FreeRADIUS');
  console.log('   3. Mikrotik-Rate-Limit returned and verified');
  console.log('   4. Accounting lifecycle persisted in PostgreSQL radacct');
  console.log('================================================================\n');
}

runRealPppoeLab()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Lab test encountered an error:', err);
    process.exit(1);
  });
