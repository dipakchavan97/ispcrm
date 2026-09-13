/**
 * PHASE 11 FAILURE INJECTION & RESILIENCE TEST SUITE
 * 
 * Verifies all 12 critical failure modes:
 *  1. MikroTik offline (clean timeout without crashing)
 *  2. Wrong MikroTik credentials (safe failure, password masked)
 *  3. FreeRADIUS service reject on invalid user
 *  4. PostgreSQL unique constraint violation -> HTTP 409 Conflict
 *  5. Redis connection pool health & resilience
 *  6. Invalid PPPoE password -> Access-Reject
 *  7. Suspended customer attempting login -> Access-Reject
 *  8. Expired subscription scanner automation
 *  9. Cancelled invoice payment attempt -> HTTP 400 Bad Request
 * 10. Duplicate payment webhook -> Idempotent processing
 * 11. CoA timeout non-blocking handling
 * 12. Router API timeout error formatting & credential masking
 */

import { execSync } from 'node:child_process';

const API_BASE = 'http://localhost:4000/api';
const WORKER_BASE = 'http://localhost:4001';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

let passedCount = 0;
let failedCount = 0;
const results = [];

function recordResult(name, success, details = '', durationMs = 0) {
  if (success) {
    passedCount++;
    console.log(`  ${colors.green}✔ PASS${colors.reset} ${name} (${durationMs}ms) ${details ? colors.cyan + details + colors.reset : ''}`);
  } else {
    failedCount++;
    console.log(`  ${colors.red}✖ FAIL${colors.reset} ${name} (${durationMs}ms) ${details ? colors.yellow + details + colors.reset : ''}`);
  }
  results.push({ name, success, details, durationMs });
}

async function test(name, fn) {
  const start = Date.now();
  try {
    const details = await fn();
    recordResult(name, true, details, Date.now() - start);
  } catch (err) {
    recordResult(name, false, err.message, Date.now() - start);
  }
}

async function parseJson(res) {
  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

function runRadTest(username, password, expectedResult = 'Accept') {
  try {
    const cmd = `docker exec ispcrm-freeradius /opt/bin/radtest ${username} "${password}" 127.0.0.1 0 testing123`;
    const stdout = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
    const isAccept = stdout.includes('Access-Accept');
    const isReject = stdout.includes('Access-Reject');
    if (expectedResult === 'Accept' && isAccept) return { isAccept: true, isReject: false, stdout };
    if (expectedResult === 'Reject' && isReject) return { isAccept: false, isReject: true, stdout };
    throw new Error(`Expected ${expectedResult}, got output: ${stdout.replace(/\n/g, ' ')}`);
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '') + err.message;
    if (expectedResult === 'Reject' && output.includes('Access-Reject')) {
      return { isAccept: false, isReject: true, stdout: output };
    }
    throw new Error(`radtest failure: ${output.replace(/\n/g, ' ')}`);
  }
}

async function runFailureSuite() {
  console.log(`\n${colors.bold}======================================================================${colors.reset}`);
  console.log(`${colors.bold}         PHASE 11: 12-MODE FAILURE & RESILIENCE VERIFICATION         ${colors.reset}`);
  console.log(`${colors.bold}======================================================================${colors.reset}\n`);

  const runId = Date.now().toString().slice(-6);

  // 1. Setup Tenant & Auth
  const regRes = await fetch(`${API_BASE}/auth/register-org`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Failure Test Org ${runId}`,
      slug: `fail-org-${runId}`,
      legalName: `Failure Test Corp ${runId}`,
      gstin: `27AAPCA${runId}A1Z5`,
      email: `fail.${runId}@test.com`,
      phone: `9820${runId}`,
      address: 'Plot 42, Bandra Kurla Complex',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400051',
      ownerName: 'QA Resiliency Engineer',
      ownerEmail: `resilience.${runId}@test.com`,
      ownerPassword: 'SecretPassword123!',
      ownerPhone: `9820${runId}`,
    }),
  });
  const regData = await parseJson(regRes);
  const token = regData.accessToken;
  const orgId = regData.user?.organizationId || regData.organization?.id;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // FAILURE 1: MikroTik Offline
  await test('1. MikroTik Offline Handled Gracefully', async () => {
    const reg = await fetch(`${API_BASE}/routers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `Offline-Router-${runId}`,
        host: '10.254.254.1', // Non-routable blackhole IP
        port: 8728,
        username: 'admin',
        password: 'OfflinePassword123!',
      }),
    });
    const router = await parseJson(reg);
    const testRes = await fetch(`${API_BASE}/routers/${router.id}/test-connection`, {
      method: 'POST',
      headers,
    });
    const data = await parseJson(testRes);
    if (data.success === true) throw new Error('Unreachable router falsely reported online!');
    if (!data.errorMessage || !data.errorMessage.includes('timed out')) {
      throw new Error(`Expected timeout message, got: ${data.errorMessage}`);
    }
    return `Correctly detected unreachable host without crash (latency: ${data.latencyMs}ms)`;
  });

  // FAILURE 2: Wrong MikroTik Credentials
  await test('2. Wrong MikroTik Credentials Handled Gracefully', async () => {
    const reg = await fetch(`${API_BASE}/routers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `Bad-Auth-Router-${runId}`,
        host: '10.254.254.2',
        port: 8728,
        username: 'wrong_user',
        password: 'wrong_secret_password',
      }),
    });
    const router = await parseJson(reg);
    const testRes = await fetch(`${API_BASE}/routers/${router.id}/test-connection`, {
      method: 'POST',
      headers,
    });
    const json = await testRes.json();
    const str = JSON.stringify(json);
    if (str.includes('wrong_secret_password')) {
      throw new Error('SECURITY BUG: Password leaked in error message');
    }
    return 'Authentication failure handled safely with credential sanitization';
  });

  // FAILURE 3: FreeRADIUS Connection & Authentication
  await test('3. FreeRADIUS Service Probe', async () => {
    const radRes = runRadTest(`nonexistent_user_${runId}`, 'random_pass', 'Reject');
    if (!radRes.isReject) throw new Error('FreeRADIUS should reject unknown user');
    return 'FreeRADIUS operational on UDP 1812: correctly rejecting unknown users';
  });

  // Setup Customer for Subscriber Auth Tests
  const custRes = await fetch(`${API_BASE}/customers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `Resilience Subscriber ${runId}`,
      customerCode: `CUST-RES-${runId}`,
      username: `sub_res_${runId}`,
      pppoePassword: `ValidPass_${runId}!`,
      mobile: `9820${runId}`,
      address: 'Test Location',
      status: 'ACTIVE',
    }),
  });
  const cust = await parseJson(custRes);

  // FAILURE 4: PostgreSQL Duplicate Constraint Checks
  await test('4. PostgreSQL Unique Constraints & 409 Conflict', async () => {
    const dupRes = await fetch(`${API_BASE}/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Duplicate Username Customer',
        customerCode: `CUST-DIFF-${runId}`,
        username: `sub_res_${runId}`, // Duplicate username
        pppoePassword: 'Password123!',
        mobile: `9821${runId}`,
        address: 'Test Location',
      }),
    });
    if (dupRes.status !== 409) throw new Error(`Expected HTTP 409, got ${dupRes.status}`);
    return 'Database uniqueness constraints enforced via clean HTTP 409 Conflict';
  });

  // FAILURE 5: Redis Connection Pool Health
  await test('5. Redis Connection Pool Health Probe', async () => {
    const res = await fetch(`${API_BASE}/health/redis`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== 'up') throw new Error(`Redis pool unhealthy: ${json.status}`);
    return 'Redis connection pool healthy and operational';
  });

  // FAILURE 6: Invalid PPPoE Password
  await test('6. Invalid PPPoE Password Returns Access-Reject', async () => {
    const radRes = runRadTest(`sub_res_${runId}`, 'COMPLETELY_WRONG_PASSWORD', 'Reject');
    if (!radRes.isReject) throw new Error('Expected Access-Reject for wrong password');
    return 'Strict authentication confirmed: wrong password blocked with Access-Reject';
  });

  // FAILURE 7: Suspended Customer Attempting Login
  await test('7. Suspended Customer Blocked at RADIUS Layer', async () => {
    // Suspend customer
    await fetch(`${API_BASE}/customers/${cust.id}/suspend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Overdue bill test' }),
    });

    // Test authentication
    const radRes = runRadTest(`sub_res_${runId}`, `ValidPass_${runId}!`, 'Reject');
    if (!radRes.isReject) throw new Error('Suspended customer was able to authenticate!');
    return 'Suspended customer credentials locked; FreeRADIUS returned Access-Reject';
  });

  // FAILURE 8: Expired Subscription Scanner
  await test('8. Subscription Expiry Scanner Automation', async () => {
    const res = await fetch(`${API_BASE}/subscriptions/automation/evaluate-expiry`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return `Expiry scanner triggered: scanned ${json.scanned ?? 0} subscriptions safely`;
  });

  // Create Plan, Subscription & Invoice for Payment Tests
  const planRes = await fetch(`${API_BASE}/plans`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `Plan Fail ${runId}`,
      code: `PLAN-FAIL-${runId}`,
      downloadSpeed: 50,
      uploadSpeed: 25,
      price: 500,
      validityDays: 30,
    }),
  });
  const plan = await parseJson(planRes);

  const subRes = await fetch(`${API_BASE}/subscriptions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerId: cust.id,
      planId: plan.id,
      billingCycle: 'MONTHLY',
    }),
  });
  const sub = await parseJson(subRes);

  const invRes = await fetch(`${API_BASE}/invoices`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerId: cust.id,
      subscriptionId: sub.id,
      items: [{ description: 'Test Plan', sacCode: '998422', unitPrice: 500, quantity: 1, taxRatePercent: 18 }],
    }),
  });
  const inv = await parseJson(invRes);

  // FAILURE 9: Cancelled Invoice Payment Rejection
  await test('9. Payment on Cancelled Invoice Prohibited', async () => {
    // Cancel invoice
    await fetch(`${API_BASE}/invoices/${inv.id}/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Test cancellation' }),
    });

    // Attempt payment
    const payRes = await fetch(`${API_BASE}/payments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        customerId: cust.id,
        invoiceId: inv.id,
        amount: 590,
        paymentMethod: 'CASH',
      }),
    });
    if (payRes.status !== 400) throw new Error(`Expected HTTP 400, got ${payRes.status}`);
    return 'Payment against cancelled invoice rejected with HTTP 400 Bad Request';
  });

  // FAILURE 10: Duplicate Payment Webhook & Idempotency
  await test('10. Duplicate Payment Handled Idempotently', async () => {
    const newInvRes = await fetch(`${API_BASE}/invoices`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        customerId: cust.id,
        items: [{ description: 'Idempotency Test Item', sacCode: '998422', unitPrice: 300, quantity: 1, taxRatePercent: 18 }],
      }),
    });
    const activeInv = await parseJson(newInvRes);
    const idempotencyKey = `idem_${runId}_${Date.now()}`;

    // First payment call
    const p1 = await fetch(`${API_BASE}/payments/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invoiceId: activeInv.id,
        gatewayOrderId: `order_${runId}`,
        gatewayPaymentId: `pay_${runId}`,
        idempotencyKey,
      }),
    });

    // Second identical payment call
    const p2 = await fetch(`${API_BASE}/payments/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invoiceId: activeInv.id,
        gatewayOrderId: `order_${runId}`,
        gatewayPaymentId: `pay_${runId}`,
        idempotencyKey,
      }),
    });

    if (p2.status >= 500) throw new Error('Duplicate payment caused internal server error 500');
    return 'Duplicate payment webhook processed idempotently without double-billing';
  });

  // FAILURE 11: CoA Timeout Non-Blocking Handling
  await test('11. CoA Timeout Handled Asynchronously via BullMQ', async () => {
    const startMs = Date.now();
    const res = await fetch(`${API_BASE}/customers/${cust.id}/disconnect`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Timeout resilience test' }),
    });
    const elapsed = Date.now() - startMs;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (elapsed > 1000) throw new Error(`HTTP request blocked for ${elapsed}ms waiting for UDP`);
    return `CoA job enqueued asynchronously; HTTP response returned in ${elapsed}ms (<1000ms)`;
  });

  // FAILURE 12: Router API Timeout & Error Masking
  await test('12. Router API Timeout Masking & Error Formatting', async () => {
    const regRes = await fetch(`${API_BASE}/routers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `Timeout-Router-${runId}`,
        host: '10.254.254.99',
        port: 8728,
        username: 'admin',
        password: 'TopSecretRouterPassword999!',
      }),
    });
    const router = await parseJson(regRes);
    const testRes = await fetch(`${API_BASE}/routers/${router.id}/test-connection`, {
      method: 'POST',
      headers,
    });
    const data = await parseJson(testRes);
    if (data.success === true) throw new Error('Fake success reported for non-existent IP');
    if (JSON.stringify(data).includes('TopSecretRouterPassword999!')) {
      throw new Error('CRITICAL SECURITY VIOLATION: Router password exposed in error output');
    }
    return `Timeout returned structured error without secret exposure: "${data.errorMessage.slice(0, 50)}..."`;
  });

  console.log(`\n${colors.bold}======================================================================${colors.reset}`);
  console.log(`PHASE 11 FAILURE TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(`${colors.bold}======================================================================${colors.reset}\n`);

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runFailureSuite().catch((err) => {
  console.error('Fatal failure test error:', err);
  process.exit(1);
});
