import net from 'node:net';
import crypto from 'node:crypto';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();

const JWT_SECRET = 'super-secret-jwt-key-change-in-production';
const ORG_ID = '0447e609-d80b-4499-adc7-69c6a4fa25d8';
const CUSTOMER_ID = '9d98e0e4-842a-4938-9fe5-bb5991a64e74';
const SUB_ID = 'ed682c6d-04dd-4e96-8353-0a2c69789363';

class RouterOsBinaryClient {
  encodeWord(word) {
    const buf = Buffer.from(word, 'utf8');
    let lenBuf;
    const len = buf.length;
    if (len < 0x80) {
      lenBuf = Buffer.from([len]);
    } else if (len < 0x4000) {
      lenBuf = Buffer.from([(len >> 8) | 0x80, len & 0xff]);
    } else if (len < 0x200000) {
      lenBuf = Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
    } else if (len < 0x10000000) {
      lenBuf = Buffer.from([(len >> 24) | 0xe0, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    } else {
      lenBuf = Buffer.from([0xf0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    }
    return Buffer.concat([lenBuf, buf]);
  }

  encodeSentence(words) {
    const bufs = words.map((w) => this.encodeWord(w));
    bufs.push(Buffer.from([0x00]));
    return Buffer.concat(bufs);
  }

  async executeCommands(config, commands, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let isSettled = false;
      const port = config.port || 8728;
      const socket = net.createConnection({ host: config.host, port });

      const finishError = (err) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        try { socket.destroy(); } catch {}
        reject(err);
      };

      const finishSuccess = (results) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        try { socket.end(); } catch {}
        resolve(results);
      };

      const timer = setTimeout(() => finishError(new Error('Timeout')), timeoutMs);

      let buffer = Buffer.alloc(0);
      let currentSentence = [];
      const results = [];
      let commandIndex = -1;

      const sendNextCommand = () => {
        commandIndex++;
        if (commandIndex >= commands.length) {
          finishSuccess(results);
          return;
        }
        const cmd = commands[commandIndex];
        socket.write(this.encodeSentence(cmd));
      };

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length > 0) {
          let b = buffer[0];
          let len = 0;
          let offset = 0;
          if ((b & 0x80) === 0) { len = b; offset = 1; }
          else if ((b & 0xc0) === 0x80) {
            if (buffer.length < 2) break;
            len = ((b & 0x3f) << 8) | buffer[1]; offset = 2;
          } else if ((b & 0xe0) === 0xc0) {
            if (buffer.length < 3) break;
            len = ((b & 0x1f) << 16) | (buffer[1] << 8) | buffer[2]; offset = 3;
          } else if ((b & 0xf0) === 0xe0) {
            if (buffer.length < 4) break;
            len = ((b & 0x0f) << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3]; offset = 4;
          } else {
            if (buffer.length < 5) break;
            len = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4]; offset = 5;
          }

          if (buffer.length < offset + len) break;

          const word = buffer.subarray(offset, offset + len).toString('utf8');
          buffer = buffer.subarray(offset + len);

          if (word.length === 0) {
            if (currentSentence.length > 0) {
              const sentenceType = currentSentence[0];
              if (sentenceType === '!re') {
                const row = {};
                for (let i = 1; i < currentSentence.length; i++) {
                  const part = currentSentence[i];
                  if (part.startsWith('=')) {
                    const eqIdx = part.indexOf('=', 1);
                    if (eqIdx !== -1) {
                      row[part.substring(1, eqIdx)] = part.substring(eqIdx + 1);
                    } else {
                      row[part.substring(1)] = '';
                    }
                  }
                }
                if (!results[commandIndex]) results[commandIndex] = [];
                results[commandIndex].push(row);
              } else if (sentenceType === '!done') {
                if (!results[commandIndex]) results[commandIndex] = [];
                sendNextCommand();
              } else if (sentenceType === '!trap') {
                finishError(new Error('RouterOS Trap: ' + JSON.stringify(currentSentence)));
                return;
              }
            }
            currentSentence = [];
            continue;
          }
          currentSentence.push(word);
        }
      });

      socket.on('error', finishError);
      socket.on('connect', () => {
        socket.write(this.encodeSentence(['/login', `=name=${config.username}`, `=password=${config.password}`]));
      });
    });
  }
}

function getDecryptedPassword() {
  const payload = 'd0f4a6ff8cb5c77860a863ff3b9f7332:4284d40c210e4ab3aa1bfbff5a317c0e:9c73c2572a5722081ac5ed24';
  const parts = payload.split(':');
  const secret = 'super-secret-jwt-key-change-in-production';
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()]).toString('utf8');
}

async function makePostRequest(path, token, bodyObj = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(bodyObj);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 4000,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let respData = '';
        res.on('data', (chunk) => (respData += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(respData) });
          } catch {
            resolve({ statusCode: res.statusCode, raw: respData });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('====================================================');
  console.log('PHASE 9H — REAL PHYSICAL DISCONNECT EXECUTION');
  console.log('====================================================\n');

  // --- 1. PRE-EXECUTION CHECKS ---
  console.log('--- STEP 1: PRE-EXECUTION STATE INSPECTION ---');
  const customer = await prisma.customer.findUnique({
    where: { id: CUSTOMER_ID },
    include: { subscriptions: true }
  });
  const sub = customer?.subscriptions[0];
  const activeRadacct = await prisma.radAcct.findFirst({
    where: { username: { in: ['dipak@ispcrm', 'dipak'] }, acctstoptime: null },
    orderBy: { acctstarttime: 'desc' }
  });

  console.log('Database Customer:', {
    id: customer?.id,
    username: customer?.username,
    status: customer?.status,
    orgId: customer?.organizationId
  });
  console.log('Database Subscription:', {
    id: sub?.id,
    status: sub?.status,
    planId: sub?.planId
  });
  console.log('Active radacct session:', activeRadacct ? {
    radacctid: activeRadacct.radacctid.toString(),
    username: activeRadacct.username,
    sessionId: activeRadacct.acctsessionid,
    nasIp: activeRadacct.nasipaddress,
    framedIp: activeRadacct.framedipaddress,
    startTime: activeRadacct.acctstarttime,
    stopTime: activeRadacct.acctstoptime
  } : 'NONE');

  if (!activeRadacct) {
    throw new Error('FATAL: No active radacct session found in DB for test subscriber!');
  }

  // Inspect physical MikroTik
  const client = new RouterOsBinaryClient();
  const config = { host: '10.200.0.6', port: 8728, username: 'dipak', password: getDecryptedPassword() };

  const [radiusListPre, activesPre] = await client.executeCommands(config, [
    ['/radius/print'],
    ['/ppp/active/print']
  ]);

  const ispcrmFirst = radiusListPre[0]?.domain === 'ispcrm' && radiusListPre[0]?.address === '10.200.0.1';
  const xceednetSecond = (radiusListPre[1]?.domain === '' || !radiusListPre[1]?.domain) && radiusListPre[1]?.address === '172.16.1.12';
  console.log('\nMikroTik RADIUS check:');
  console.log(`  Index 0: ${radiusListPre[0]?.address} (domain="${radiusListPre[0]?.domain}") [ISPCRM first: ${ispcrmFirst}]`);
  console.log(`  Index 1: ${radiusListPre[1]?.address} (domain="${radiusListPre[1]?.domain}") [XceedNet second: ${xceednetSecond}]`);

  const prodSessionsPre = activesPre.filter(a => !(a.name || '').includes('ispcrm'));
  const testSessionPre = activesPre.find(a => (a.name || '').includes('ispcrm'));
  console.log('\nMikroTik PPP active pre-state:');
  console.log(`  Total active sessions: ${activesPre.length}`);
  console.log(`  Production sessions count: ${prodSessionsPre.length}`);
  console.log(`  Test subscriber session:`, testSessionPre ? {
    name: testSessionPre.name,
    service: testSessionPre.service,
    address: testSessionPre.address,
    uptime: testSessionPre.uptime,
    sessionId: testSessionPre['session-id']
  } : 'NOT CONNECTED');

  if (!testSessionPre) {
    throw new Error('FATAL: Test subscriber dipak@ispcrm is not active on physical MikroTik!');
  }

  // --- 2. EXECUTE REAL SUSPEND VIA API ---
  console.log('\n--- STEP 2: EXECUTING REAL SUSPEND ACTION VIA API ---');
  const admin = await prisma.adminUser.findFirst({
    where: { organizationId: ORG_ID },
  });
  if (!admin) throw new Error('Admin user not found');

  const token = jwt.sign(
    {
      sub: admin.id,
      organizationId: ORG_ID,
      email: admin.email,
      role: admin.role,
      orgSlug: 'cloudsetup',
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const requestStartTime = new Date();
  console.log(`[${requestStartTime.toISOString()}] Calling POST /api/customers/${CUSTOMER_ID}/suspend...`);
  const apiRes = await makePostRequest(`/api/customers/${CUSTOMER_ID}/suspend`, token, {});
  console.log('A. API Response Status:', apiRes.statusCode);
  console.log('A. API Response Data:', JSON.stringify(apiRes.data || apiRes.raw, null, 2));

  // --- 3. AWAIT BULLMQ AND NETWORK PROCESSING ---
  console.log('\n--- STEP 3: AWAITING WORKER & NETWORK PROCESSING (4000ms) ---');
  await new Promise((r) => setTimeout(r, 4000));

  // --- 4. IMMEDIATE VERIFICATION ---
  console.log('\n--- STEP 4: IMMEDIATE POST-EXECUTION VERIFICATION ---');

  // B. Customer / Subscription state
  const updatedCustomer = await prisma.customer.findUnique({
    where: { id: CUSTOMER_ID },
    include: { subscriptions: true }
  });
  const updatedSub = updatedCustomer?.subscriptions[0];
  console.log('B. Customer/Subscription State:');
  console.log(`   Customer Status:     ${updatedCustomer?.status}`);
  console.log(`   Subscription Status: ${updatedSub?.status}`);

  // C. radcheck / radreply state
  const radcheck = await prisma.radCheck.findMany({
    where: { username: { in: ['dipak@ispcrm', 'dipak'] } }
  });
  const radreply = await prisma.radReply.findMany({
    where: { username: { in: ['dipak@ispcrm', 'dipak'] } }
  });
  console.log('C. radcheck entries:');
  radcheck.forEach(r => console.log(`   - ${r.username} | ${r.attribute} ${r.op} ${r.value}`));
  console.log('C. radreply entries:');
  radreply.forEach(r => console.log(`   - ${r.username} | ${r.attribute} ${r.op} ${r.value}`));

  // D. BullMQ job state from Redis
  try {
    const redis = new Redis({ host: process.env.REDIS_HOST || 'redis', port: 6379, lazyConnect: true });
    await redis.connect();
    const completedJobs = await redis.zrange('bull:radius-coa:completed', -3, -1);
    const failedJobs = await redis.zrange('bull:radius-coa:failed', -3, -1);
    console.log('D. BullMQ radius-coa queue:');
    console.log(`   Recent completed job IDs:`, completedJobs);
    console.log(`   Recent failed job IDs:`, failedJobs);
    if (completedJobs.length > 0) {
      const latestJobId = completedJobs[completedJobs.length - 1];
      const jobData = await redis.hgetall(`bull:radius-coa:${latestJobId}`);
      console.log(`   Latest completed job data:`, {
        id: latestJobId,
        name: jobData.name,
        returnvalue: jobData.returnvalue
      });
    }
    if (failedJobs.length > 0) {
      const latestFailId = failedJobs[failedJobs.length - 1];
      const failData = await redis.hgetall(`bull:radius-coa:${latestFailId}`);
      console.log(`   Latest failed job data:`, {
        id: latestFailId,
        failedReason: failData.failedReason
      });
    }
    await redis.quit();
  } catch (err) {
    console.log('D. BullMQ Redis query note:', err.message);
  }

  // F. Physical MikroTik verification
  const [activesPost] = await client.executeCommands(config, [
    ['/ppp/active/print']
  ]);

  const prodSessionsPost = activesPost.filter(a => !(a.name || '').includes('ispcrm'));
  const testSessionPost = activesPost.find(a => (a.name || '').includes('ispcrm'));
  const testDisappeared = !testSessionPost;

  console.log('\nF. Physical MikroTik Active Sessions:');
  console.log(`   Total active PPP sessions after: ${activesPost.length} (was ${activesPre.length})`);
  console.log(`   Production sessions count after: ${prodSessionsPost.length} (was ${prodSessionsPre.length})`);
  console.log(`   dipak@ispcrm disappeared from /ppp active: ${testDisappeared}`);
  if (testSessionPost) {
    console.log(`   TEST SESSION STILL ACTIVE:`, {
      name: testSessionPost.name,
      address: testSessionPost.address,
      uptime: testSessionPost.uptime,
      sessionId: testSessionPost['session-id']
    });
  } else {
    console.log(`   [CONFIRMED] Test subscriber PPP session was disconnected from physical router!`);
  }

  // G. radacct verification
  const postRadacct = await prisma.radAcct.findUnique({
    where: { radacctid: activeRadacct.radacctid }
  });
  console.log('\nG. radacct session state (radacctid: ' + activeRadacct.radacctid.toString() + '):');
  console.log(`   acctstoptime:       ${postRadacct?.acctstoptime ? postRadacct.acctstoptime.toISOString() : 'NULL'}`);
  console.log(`   acctterminatecause: ${postRadacct?.acctterminatecause || 'NULL'}`);
  console.log(`   acctsessiontime:    ${postRadacct?.acctsessiontime} seconds`);
  console.log(`   acctinputoctets:    ${postRadacct?.acctinputoctets}`);
  console.log(`   acctoutputoctets:   ${postRadacct?.acctoutputoctets}`);

  // H. Production Safety
  console.log('\nH. Production Safety Verification:');
  console.log(`   Total PPP sessions: before=${activesPre.length}, after=${activesPost.length}`);
  console.log(`   XceedNet production sessions: before=${prodSessionsPre.length}, after=${prodSessionsPost.length}`);
  const noProdDisconnected = prodSessionsPre.length === prodSessionsPost.length;
  console.log(`   No production user disconnected: ${noProdDisconnected}`);

  // CONCLUSION
  console.log('\n====================================================');
  if (testDisappeared && noProdDisconnected) {
    console.log('PHYSICAL DISCONNECT: PASS');
  } else {
    console.log('PHYSICAL DISCONNECT: FAIL');
  }
  console.log('====================================================');
}

main()
  .catch((err) => {
    console.error('Fatal error in Phase 9H:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
