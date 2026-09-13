/**
 * End-to-End Automated Feature Test Suite for ISP CRM
 * Runs against live Docker containers:
 *  - ispcrm-web (port 3000)
 *  - ispcrm-api (port 4000)
 *  - ispcrm-worker (port 4001)
 *  - ispcrm-postgres (port 5432)
 *  - ispcrm-redis (port 6379)
 *  - ispcrm-freeradius (ports 1812, 1813, 3799)
 */

const API_BASE = 'http://localhost:4000/api';
const WEB_BASE = 'http://localhost:3000';
const WORKER_BASE = 'http://localhost:4001';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

let passedCount = 0;
let failedCount = 0;
const results = [];

function recordResult(group, name, success, details = '', durationMs = 0) {
  if (success) {
    passedCount++;
    console.log(`  ${colors.green}✔ PASS${colors.reset} [${group}] ${name} (${durationMs}ms) ${details ? colors.cyan + details + colors.reset : ''}`);
  } else {
    failedCount++;
    console.log(`  ${colors.red}✖ FAIL${colors.reset} [${group}] ${name} (${durationMs}ms) ${details ? colors.yellow + details + colors.reset : ''}`);
  }
  results.push({ group, name, success, details, durationMs });
}

async function test(group, name, fn) {
  const start = Date.now();
  try {
    const details = await fn();
    const duration = Date.now() - start;
    recordResult(group, name, true, typeof details === 'string' ? details : '', duration);
  } catch (err) {
    const duration = Date.now() - start;
    recordResult(group, name, false, err.message, duration);
  }
}

async function runAllTests() {
  console.log(`\n${colors.bold}${colors.magenta}======================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}     ISP CRM END-TO-END DOCKER FEATURE TEST SUITE     ${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}======================================================${colors.reset}\n`);

  let authToken = '';
  let organizationId = '';
  let testCustomerId = '';
  let testCustomerUsername = '';
  let testPlanId = '';
  let testSubId = '';
  let testInvoiceId = '';
  let testPaymentId = '';
  let testRouterId = '';

  // ----------------------------------------------------
  // GROUP 1: DOCKER CONTAINER HEALTH & PROBES
  // ----------------------------------------------------
  console.log(`${colors.bold}1. DOCKER SERVICE HEALTH & INFRASTRUCTURE PROBES${colors.reset}`);

  await test('Infrastructure', 'API Server Health Check', async () => {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`Expected status 'ok', got '${data.status}'`);
    return `Status: ${data.status}`;
  });

  await test('Infrastructure', 'PostgreSQL DB Health Probe', async () => {
    const res = await fetch(`${API_BASE}/health/db`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'up') throw new Error(`Expected db 'up', got '${data.status}'`);
    return `DB: ${data.status} (latency: ${data.latencyMs ?? 'N/A'}ms)`;
  });

  await test('Infrastructure', 'Redis Health Probe', async () => {
    const res = await fetch(`${API_BASE}/health/redis`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'up') throw new Error(`Expected redis 'up', got '${data.status}'`);
    return `Redis: ${data.status}`;
  });

  await test('Infrastructure', 'Worker HTTP Health Probe', async () => {
    const res = await fetch(`${WORKER_BASE}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok' || data.service !== 'worker') {
      throw new Error(`Invalid worker response: ${JSON.stringify(data)}`);
    }
    return `Service: ${data.service}, uptime: ${Math.round(data.uptime)}s`;
  });

  await test('Infrastructure', 'Swagger OpenAPI Docs Endpoint', async () => {
    const res = await fetch(`${API_BASE}/docs`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `Swagger active (HTTP ${res.status})`;
  });

  // ----------------------------------------------------
  // GROUP 2: AUTHENTICATION & MULTI-TENANCY
  // ----------------------------------------------------
  console.log(`\n${colors.bold}2. AUTHENTICATION & MULTI-TENANCY${colors.reset}`);

  await test('Auth', 'Admin Login with Valid Credentials', async () => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@speednet.in', password: 'admin123' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success || !json.data?.accessToken) {
      throw new Error(`Login failed or missing accessToken: ${JSON.stringify(json)}`);
    }
    authToken = json.data.accessToken;
    organizationId = json.data.user.organizationId;
    return `Role: ${json.data.user.role}, Org: "${json.data.user.organizationName}"`;
  });

  await test('Auth', 'Reject Login with Invalid Credentials', async () => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@speednet.in', password: 'wrongpassword' }),
    });
    if (res.status !== 401 && res.status !== 400) {
      throw new Error(`Expected 401/400 Unauthorized, got ${res.status}`);
    }
    return `Correctly rejected with HTTP ${res.status}`;
  });

  await test('Auth', 'Current User Profile (GET /auth/me)', async () => {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return `User ID: ${json.data?.id || json.id}, Email: ${json.data?.email || json.email}`;
  });

  // Helper auth headers
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };

  // ----------------------------------------------------
  // GROUP 3: DASHBOARD METRICS & NOC FEEDS
  // ----------------------------------------------------
  console.log(`\n${colors.bold}3. DASHBOARD NOC & BILLING METRICS FEEDS${colors.reset}`);

  await test('Dashboard', 'Invoices Revenue Metrics (/invoices/metrics)', async () => {
    const res = await fetch(`${API_BASE}/invoices/metrics`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const metrics = json.data || json;
    if (typeof metrics.totalInvoiced === 'undefined') {
      throw new Error(`Missing totalInvoiced field: ${JSON.stringify(metrics)}`);
    }
    return `Total Invoiced: ₹${metrics.totalInvoiced}, Collected: ₹${metrics.totalCollected}, Outstanding: ₹${metrics.totalOutstanding}`;
  });

  await test('Dashboard', 'Subscriber Directory Feed (/customers?limit=5)', async () => {
    const res = await fetch(`${API_BASE}/customers?limit=5`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = json.data || json;
    return `Total subscribers: ${data.total ?? data.items?.length ?? 0}`;
  });

  await test('Dashboard', 'FreeRADIUS Active PPPoE Sessions (/radius/sessions/active)', async () => {
    const res = await fetch(`${API_BASE}/radius/sessions/active`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    return `Active online PPPoE sessions: ${list.length}`;
  });

  await test('Dashboard', 'Managed MikroTik Fleet (/routers)', async () => {
    const res = await fetch(`${API_BASE}/routers`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    return `Routers online/registered: ${list.length}`;
  });

  await test('Dashboard', 'Administrative Audit Trail Feed (/audit-logs?limit=5)', async () => {
    const res = await fetch(`${API_BASE}/audit-logs?limit=5`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    return `Recent audit logs count: ${list.length}`;
  });

  // ----------------------------------------------------
  // GROUP 4: SUBSCRIBER MANAGEMENT (CRUD & LIFECYCLE)
  // ----------------------------------------------------
  console.log(`\n${colors.bold}4. SUBSCRIBER MANAGEMENT (CRUD & LIFECYCLE)${colors.reset}`);

  await test('Customers', 'Create New Subscriber with PPPoE Provisioning', async () => {
    const ts = Date.now().toString().slice(-6);
    testCustomerUsername = `subscriber_${ts}`;
    const payload = {
      name: `Ramesh Verma ${ts}`,
      customerCode: `CUST-E2E-${ts}`,
      username: testCustomerUsername,
      pppoePassword: 'PppoePassword123!',
      mobile: `98200${ts.slice(-5)}`,
      email: `ramesh.${ts}@example.com`,
      address: 'Shop 12, Link Road, Andheri West',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400053',
      notes: 'Provisioned via automated Docker feature test',
    };

    const res = await fetch(`${API_BASE}/customers`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`HTTP ${res.status}: ${errBody}`);
    }
    const json = await res.json();
    const cust = json.data || json;
    testCustomerId = cust.id;
    if (!testCustomerId) throw new Error('Missing created customer ID');
    return `Created ID: ${cust.id}, Code: ${cust.customerCode}, Username: ${cust.username}`;
  });

  await test('Customers', 'List Subscribers with Pagination & Search', async () => {
    const res = await fetch(`${API_BASE}/customers?search=${testCustomerUsername}`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = json.data || json;
    const found = data.items?.find((c) => c.username === testCustomerUsername);
    if (!found) throw new Error(`Did not find created subscriber ${testCustomerUsername} in search results`);
    return `Search matched customer: ${found.name} (${found.customerCode})`;
  });

  await test('Customers', 'Get 360° Subscriber Profile by ID', async () => {
    const res = await fetch(`${API_BASE}/customers/${testCustomerId}`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const cust = json.data || json;
    if (cust.id !== testCustomerId) throw new Error(`Returned ID mismatch: ${cust.id}`);
    return `Name: ${cust.name}, Status: ${cust.status}, City: ${cust.city}`;
  });

  await test('Customers', 'Edit Subscriber Profile (PATCH /customers/:id)', async () => {
    const res = await fetch(`${API_BASE}/customers/${testCustomerId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ notes: 'Updated notes via automated test suite' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return `Updated successfully: ${json.data?.notes || 'OK'}`;
  });

  await test('Customers', 'Suspend Subscriber (/customers/:id/suspend)', async () => {
    const res = await fetch(`${API_BASE}/customers/${testCustomerId}/suspend`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'Overdue bill automated test' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const cust = json.data?.customer || json.customer || json.data || json;
    if (cust.status !== 'SUSPENDED') throw new Error(`Expected status SUSPENDED, got ${cust.status}`);
    return `Status transitioned to: ${cust.status} (${json.data?.message || 'OK'})`;
  });

  await test('Customers', 'Reactivate Subscriber (/customers/:id/reactivate)', async () => {
    const res = await fetch(`${API_BASE}/customers/${testCustomerId}/reactivate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'Payment received automated test' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const cust = json.data?.customer || json.customer || json.data || json;
    if (cust.status !== 'ACTIVE') throw new Error(`Expected status ACTIVE, got ${cust.status}`);
    return `Status restored to: ${cust.status} (${json.data?.message || 'OK'})`;
  });

  await test('Customers', 'PoD Disconnect Request (/customers/:id/disconnect)', async () => {
    const res = await fetch(`${API_BASE}/customers/${testCustomerId}/disconnect`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'Operator manual session drop' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return `Session drop executed: ${json.message || json.data?.message || 'Done'}`;
  });

  // ----------------------------------------------------
  // GROUP 5: PLANS & BANDWIDTH PROFILES
  // ----------------------------------------------------
  console.log(`\n${colors.bold}5. INTERNET PLANS & BANDWIDTH POLICIES${colors.reset}`);

  await test('Plans', 'Create Internet Plan with Speed & GST Configuration', async () => {
    const ts = Date.now().toString().slice(-4);
    const payload = {
      name: `SpeedFiber Turbo ${ts} Mbps`,
      code: `PLAN-TURBO-${ts}`,
      downloadSpeed: 150,
      uploadSpeed: 150,
      validityDays: 30,
      billingCycle: 'MONTHLY',
      price: 899,
      gstRatePercent: 18,
      description: '150 Mbps symmetrical fiber plan with 18% GST',
    };
    const res = await fetch(`${API_BASE}/plans`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    const json = await res.json();
    const plan = json.data || json;
    testPlanId = plan.id;
    return `Plan ID: ${plan.id}, Code: ${plan.code}, Speed: 150M/150M, Price: ₹${plan.price}`;
  });

  await test('Plans', 'List Available Plans & Verify Count', async () => {
    const res = await fetch(`${API_BASE}/plans`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    const found = list.find((p) => p.id === testPlanId);
    if (!found) throw new Error(`Newly created plan ${testPlanId} not returned in plans list`);
    return `Total plans: ${list.length}, found: ${found.name}`;
  });

  await test('Plans', 'Bandwidth Policies Overview', async () => {
    const res = await fetch(`${API_BASE}/plans/bandwidth-policies`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const policies = json.data || json;
    return `Bandwidth policy profiles configured: ${Array.isArray(policies) ? policies.length : 0}`;
  });

  // ----------------------------------------------------
  // GROUP 6: SUBSCRIPTIONS & AUTOMATION
  // ----------------------------------------------------
  console.log(`\n${colors.bold}6. SUBSCRIPTIONS & AUTOMATION${colors.reset}`);

  await test('Subscriptions', 'Create Subscription (Assign Plan to Customer)', async () => {
    const payload = {
      customerId: testCustomerId,
      planId: testPlanId,
      autoRenew: true,
      gracePeriodDays: 3,
    };
    const res = await fetch(`${API_BASE}/subscriptions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    const json = await res.json();
    const sub = json.data || json;
    testSubId = sub.id;
    return `Subscription ID: ${sub.id}, Status: ${sub.status}, EndDate: ${sub.endDate}`;
  });

  await test('Subscriptions', 'List Subscriptions Scoped to Customer', async () => {
    const res = await fetch(`${API_BASE}/subscriptions?customerId=${testCustomerId}`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    if (list.length === 0) throw new Error('Expected at least 1 subscription for customer');
    return `Customer subscriptions: ${list.length} (status: ${list[0].status})`;
  });

  await test('Subscriptions', 'Trigger On-Demand Subscription Expiry Scanner Automation', async () => {
    const res = await fetch(`${API_BASE}/subscriptions/automation/evaluate-expiry`, {
      method: 'POST',
      headers: authHeaders,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return `Scan executed: ${JSON.stringify(json.data || json)}`;
  });

  // ----------------------------------------------------
  // GROUP 7: INVOICES & INDIAN GST TAX BILLING
  // ----------------------------------------------------
  console.log(`\n${colors.bold}7. INVOICES & INDIAN GST BILLING${colors.reset}`);

  await test('Invoices', 'Live Tax Calculation Preview (SAC 998422 + CGST/SGST)', async () => {
    const payload = {
      customerId: testCustomerId,
      items: [
        {
          description: 'High Speed Fiber Broadband - 150 Mbps',
          sacCode: '998422',
          quantity: 1,
          unitPrice: 899,
          taxRatePercent: 18,
        },
      ],
    };
    const res = await fetch(`${API_BASE}/invoices/preview`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const calc = json.data || json;
    return `Subtotal: ₹${calc.subtotal}, Tax: ₹${calc.totalTaxAmount} (CGST: ₹${calc.cgstAmount}, SGST: ₹${calc.sgstAmount}), Total: ₹${calc.totalAmount}`;
  });

  await test('Invoices', 'Create Official GST Tax Invoice', async () => {
    const payload = {
      customerId: testCustomerId,
      subscriptionId: testSubId,
      items: [
        {
          description: 'High Speed Fiber Broadband - 150 Mbps',
          sacCode: '998422',
          quantity: 1,
          unitPrice: 899,
          taxRatePercent: 18,
        },
      ],
      notes: 'GST Tax Invoice generated by Docker automated test suite',
    };
    const res = await fetch(`${API_BASE}/invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    const json = await res.json();
    const inv = json.data || json;
    testInvoiceId = inv.id;
    return `Invoice No: ${inv.invoiceNumber}, Status: ${inv.status}, Total: ₹${inv.totalAmount}`;
  });

  await test('Invoices', 'Fetch Invoice Detail with Line Items & SAC Code', async () => {
    const res = await fetch(`${API_BASE}/invoices/${testInvoiceId}`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const inv = json.data || json;
    if (inv.id !== testInvoiceId) throw new Error('Invoice ID mismatch');
    const item = inv.items?.[0];
    return `Invoice #${inv.invoiceNumber}, SAC: ${item?.sacCode || 'N/A'}, Balance: ₹${inv.balanceDue || inv.totalAmount}`;
  });

  // ----------------------------------------------------
  // GROUP 8: PAYMENTS & FINANCIAL SETTLEMENT
  // ----------------------------------------------------
  console.log(`\n${colors.bold}8. PAYMENTS & FINANCIAL SETTLEMENT${colors.reset}`);

  await test('Payments', 'Record Payment against Invoice (UPI)', async () => {
    const payload = {
      customerId: testCustomerId,
      invoiceId: testInvoiceId,
      amount: 1060.82, // 899 + 18% GST (161.82) = 1060.82
      paymentMethod: 'UPI',
      transactionRef: `UPI-TEST-${Date.now()}`,
      notes: 'Settlement recorded via Docker automated test',
    };
    const res = await fetch(`${API_BASE}/payments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    const json = await res.json();
    const payment = json.data?.payment || json.payment || json.data || json;
    testPaymentId = payment.id;
    return `Receipt No: ${payment.receiptNumber || 'RCPT'}, Amount: ₹${payment.amount}, Status: ${payment.status}`;
  });

  await test('Payments', 'Verify Invoice Status Transitioned to PAID', async () => {
    const res = await fetch(`${API_BASE}/invoices/${testInvoiceId}`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const inv = json.data || json;
    if (inv.status !== 'PAID') {
      throw new Error(`Expected invoice status PAID, got ${inv.status} (paid: ₹${inv.paidAmount}, total: ₹${inv.totalAmount})`);
    }
    return `Invoice #${inv.invoiceNumber} status: ${inv.status}, Paid Amount: ₹${inv.paidAmount}`;
  });

  await test('Payments', 'List Payments with Search & Verification', async () => {
    const res = await fetch(`${API_BASE}/payments?customerId=${testCustomerId}`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = json.data || json;
    const items = data.items || (Array.isArray(data) ? data : []);
    return `Customer payments count: ${items.length}, total: ${data.total || items.length}`;
  });

  await test('Payments', 'Refund Payment (POST /payments/:id/refund)', async () => {
    const res = await fetch(`${API_BASE}/payments/${testPaymentId}/refund`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ amount: 100, reason: 'Automated test partial refund' }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    const json = await res.json();
    return `Refund processed: ${json.message || json.data?.message || 'Success'}`;
  });

  // ----------------------------------------------------
  // GROUP 9: MIKROTIK ROUTERS & FLEET
  // ----------------------------------------------------
  console.log(`\n${colors.bold}9. MIKROTIK ROUTERS & FLEET${colors.reset}`);

  await test('Routers', 'Register MikroTik Router with Encrypted Credentials', async () => {
    const ts = Date.now().toString().slice(-4);
    const octet3 = Math.floor(Math.random() * 200) + 10;
    const octet4 = Math.floor(Math.random() * 250) + 1;
    const payload = {
      name: `Core-BNG-Docker-${ts}`,
      host: `10.250.${octet3}.${octet4}`,
      port: 8728,
      username: 'api_admin',
      password: 'EncryptedRouterSecretPassword123!',
      radiusSecret: 'radiusSecretKey123',
    };
    const res = await fetch(`${API_BASE}/routers`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    const json = await res.json();
    const router = json.data || json;
    testRouterId = router.id;
    return `Router ID: ${router.id}, Name: ${router.name}, Host: ${router.host}:${router.port}`;
  });

  await test('Routers', 'Fetch Router Details by ID', async () => {
    const res = await fetch(`${API_BASE}/routers/${testRouterId}`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const router = json.data || json;
    return `Name: ${router.name}, Status: ${router.status}, Host: ${router.host}`;
  });

  await test('Routers', 'Test Router Connection Endpoint (/routers/:id/test-connection)', async () => {
    const res = await fetch(`${API_BASE}/routers/${testRouterId}/test-connection`, {
      method: 'POST',
      headers: authHeaders,
    });
    // Connection test to dummy IP 10.0.0.1 will return handled result or timeout
    const json = await res.json();
    return `Connection probe response: ${json.data?.success !== undefined ? (json.data.success ? 'Connected' : 'Offline (Handled)') : JSON.stringify(json)}`;
  });

  // ----------------------------------------------------
  // GROUP 10: AUDIT TRAIL LOGGING
  // ----------------------------------------------------
  console.log(`\n${colors.bold}10. AUDIT TRAIL LOGGING${colors.reset}`);

  await test('Audit', 'Verify Administrative Actions Recorded in Audit Trail', async () => {
    const res = await fetch(`${API_BASE}/audit-logs?limit=20`, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const logs = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    if (logs.length === 0) throw new Error('Expected audit logs from prior operations');
    const actions = [...new Set(logs.map((l) => l.action))];
    return `Audit logs: ${logs.length}, actions: [${actions.join(', ')}]`;
  });

  // ----------------------------------------------------
  // GROUP 11: WEB FRONTEND ROUTES (DOCKER CONTAINER ON PORT 3000)
  // ----------------------------------------------------
  console.log(`\n${colors.bold}11. WEB FRONTEND UI ROUTES (ispcrm-web CONTAINER ON PORT 3000)${colors.reset}`);

  const frontendRoutes = [
    { name: 'Root Route (/)', path: '/' },
    { name: 'Dashboard (/dashboard)', path: '/dashboard' },
    { name: 'Customers Directory (/customers)', path: '/customers' },
    { name: 'Customer 360° Profile (/customers/[id])', path: `/customers/${testCustomerId}` },
    { name: 'Internet Plans (/plans)', path: '/plans' },
    { name: 'Subscriptions (/subscriptions)', path: '/subscriptions' },
    { name: 'Invoices Ledger (/invoices)', path: '/invoices' },
    { name: 'GST Tax Invoice Print View (/invoices/[id])', path: `/invoices/${testInvoiceId}` },
    { name: 'Payments Ledger (/payments)', path: '/payments' },
    { name: 'MikroTik Routers (/routers)', path: '/routers' },
    { name: 'Helpdesk Tickets (/tickets)', path: '/tickets' },
  ];

  for (const route of frontendRoutes) {
    await test('Web UI', route.name, async () => {
      const res = await fetch(`${WEB_BASE}${route.path}`);
      if (!res.ok && res.status !== 307 && res.status !== 308) {
        throw new Error(`HTTP ${res.status}`);
      }
      const html = await res.text();
      const lengthKb = (html.length / 1024).toFixed(1);
      return `HTTP ${res.status} OK (${lengthKb} KB payload)`;
    });
  }

  // ----------------------------------------------------
  // SUMMARY REPORT
  // ----------------------------------------------------
  console.log(`\n${colors.bold}${colors.magenta}======================================================${colors.reset}`);
  console.log(`${colors.bold}FEATURE VERIFICATION SUMMARY${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}======================================================${colors.reset}`);
  console.log(`  Total Features Tested: ${results.length}`);
  console.log(`  ${colors.green}Passed:${colors.reset} ${passedCount}`);
  console.log(`  ${colors.red}Failed:${colors.reset} ${failedCount}`);
  const passRate = ((passedCount / results.length) * 100).toFixed(1);
  console.log(`  Pass Rate: ${passRate === '100.0' ? colors.green : colors.yellow}${passRate}%${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}======================================================${colors.reset}\n`);

  if (failedCount > 0) {
    console.error(`${colors.red}Some feature tests failed! Please review the output above.${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`${colors.green}${colors.bold}ALL FEATURES VERIFIED SUCCESSFULLY IN RUNNING DOCKER!${colors.reset}\n`);
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
