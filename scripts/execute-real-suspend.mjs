import jwt from 'jsonwebtoken';
import http from 'node:http';
import { prisma } from './packages/database/dist/index.js';

const JWT_SECRET = 'super-secret-jwt-key-change-in-production';
const ORG_ID = '0447e609-d80b-4499-adc7-69c6a4fa25d8';
const CUSTOMER_ID = '9d98e0e4-842a-4938-9fe5-bb5991a64e74';
const SUB_ID = 'ed682c6d-04dd-4e96-8353-0a2c69789363';

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

async function run() {
  console.log('--- 1. VERIFYING PRE-ACTION DATABASE STATE ---');
  const customer = await prisma.customer.findUnique({
    where: { id: CUSTOMER_ID },
  });
  const sub = await prisma.subscription.findUnique({
    where: { id: SUB_ID },
  });
  const activeSession = await prisma.radAcct.findFirst({
    where: { username: { in: ['dipak@ispcrm', 'dipak'] }, acctstoptime: null },
    orderBy: { acctstarttime: 'desc' },
  });

  console.log('Customer:', { id: customer?.id, username: customer?.username, status: customer?.status });
  console.log('Subscription:', { id: sub?.id, status: sub?.status });
  console.log('Active radacct session:', activeSession ? {
    username: activeSession.username,
    sessionId: activeSession.acctsessionid,
    framedIp: activeSession.framedipaddress,
    nasIp: activeSession.nasipaddress,
    startTime: activeSession.acctstarttime,
  } : 'NONE');

  if (!activeSession) {
    throw new Error('Pre-check failed: No active radacct session found for test subscriber!');
  }

  // 2. Mint admin token
  const admin = await prisma.adminUser.findFirst({
    where: { organizationId: ORG_ID },
  });
  if (!admin) throw new Error('Admin user not found for organization');

  const token = jwt.sign(
    {
      sub: admin.id,
      organizationId: ORG_ID,
      email: admin.email,
      role: admin.role,
      orgSlug: 'test-org',
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  console.log('\n--- 2. TRIGGERING REAL SUSPEND VIA API ---');
  console.log(`Calling POST /api/subscriptions/${SUB_ID}/suspend...`);
  const apiRes = await makePostRequest(`/api/subscriptions/${SUB_ID}/suspend`, token, {
    reason: 'Phase 9E validation real physical suspend test',
  });
  console.log('API Response Status:', apiRes.statusCode);
  console.log('API Response Body:', JSON.stringify(apiRes.data || apiRes.raw, null, 2));

  // 3. Give 3 seconds for BullMQ worker to process and MikroTik to ACK and send Accounting-Stop
  console.log('\n--- 3. AWAITING WORKER & RADIUS PROCESSING (3000ms) ---');
  await new Promise((r) => setTimeout(r, 3000));

  console.log('\n--- 4. POST-ACTION DATABASE STATE ---');
  const updatedCustomer = await prisma.customer.findUnique({ where: { id: CUSTOMER_ID } });
  const updatedSub = await prisma.subscription.findUnique({ where: { id: SUB_ID } });
  const radcheck = await prisma.radCheck.findMany({ where: { username: { in: ['dipak@ispcrm', 'dipak'] } } });
  const radreply = await prisma.radReply.findMany({ where: { username: { in: ['dipak@ispcrm', 'dipak'] } } });
  const postSession = await prisma.radAcct.findUnique({ where: { radacctid: activeSession.radacctid } });

  console.log('Customer Status:', updatedCustomer?.status);
  console.log('Subscription Status:', updatedSub?.status);
  console.log('RadCheck entries:', radcheck.map(r => ({ username: r.username, attr: r.attribute, op: r.op, val: r.value })));
  console.log('RadReply entries:', radreply.map(r => ({ username: r.username, attr: r.attribute, op: r.op, val: r.value })));
  console.log('RadAcct Session State:', {
    username: postSession?.username,
    sessionId: postSession?.acctsessionid,
    stopTime: postSession?.acctstoptime,
    terminateCause: postSession?.acctterminatecause,
  });
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
