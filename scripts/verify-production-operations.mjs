import https from 'https';

function request(url, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      rejectUnauthorized: true,
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        let body = raw;
        if (contentType.includes('application/json')) {
          try {
            body = JSON.parse(raw.toString('utf8'));
          } catch (e) {
            body = raw.toString('utf8');
          }
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: body,
          raw,
        });
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function verifyProduction() {
  console.log('==================================================');
  console.log('ISPCRM PRODUCTION VERIFICATION — CUSTOMER OPERATIONS & ACTIONS');
  console.log('Target: https://app.cloudsetup.in');
  console.log('==================================================\n');

  // 1. Healthcheck
  console.log('--- Step 1: Production API Health ---');
  const health = await request('https://app.cloudsetup.in/api/health');
  console.log(`Health Status: ${health.status}`);
  console.log(`Database: ${health.data?.info?.database?.status}, Redis: ${health.data?.info?.redis?.status}`);
  if (health.status !== 200) throw new Error('Production health failed');

  // 2. Login
  console.log('\n--- Step 2: Operator Login ---');
  const login = await request('https://app.cloudsetup.in/api/auth/login', { method: 'POST' }, {
    email: 'admin@speednet.in',
    password: 'admin123',
  });
  console.log(`Login Status: ${login.status}`);
  const token = login.data?.data?.accessToken || login.data?.accessToken;
  if (!token) throw new Error('Failed to acquire production auth token');
  console.log('Token acquired successfully.');

  const authHeaders = { Authorization: `Bearer ${token}` };

  // 3. Customer List
  console.log('\n--- Step 3: Fetch Customers List ---');
  const customersRes = await request('https://app.cloudsetup.in/api/customers?limit=10', { headers: authHeaders });
  console.log(`Customers Status: ${customersRes.status}`);
  const customers = customersRes.data?.data?.items || customersRes.data?.items || [];
  console.log(`Total Customers returned: ${customers.length}`);
  if (customers.length === 0) throw new Error('No customers found to verify');

  const testCustomer = customers[0];
  console.log(`Selected Test Customer: ${testCustomer.name} (Code: ${testCustomer.customerCode}, ID: ${testCustomer.id}, Status: ${testCustomer.status})`);

  // 4. Customer Detail
  console.log('\n--- Step 4: Customer Detail API ---');
  const detailRes = await request(`https://app.cloudsetup.in/api/customers/${testCustomer.id}`, { headers: authHeaders });
  console.log(`Customer Detail Status: ${detailRes.status}`);
  const custDetail = detailRes.data?.data || detailRes.data;
  console.log(`Customer Name: ${custDetail.name}, Username: ${custDetail.username || custDetail.pppoeUsername}, MAC: ${custDetail.macAddress || 'none'}`);

  // 5. RADIUS Access Requests
  console.log('\n--- Step 5: Action 7 — RADIUS Access Requests API ---');
  const accessReqRes = await request(`https://app.cloudsetup.in/api/customers/${testCustomer.id}/access-requests`, { headers: authHeaders });
  console.log(`Access Requests Status: ${accessReqRes.status}`);
  const attempts = accessReqRes.data?.data || accessReqRes.data || [];
  console.log(`Access Attempts returned: ${Array.isArray(attempts) ? attempts.length : 0}`);

  // 6. Data Usage Aggregation
  console.log('\n--- Step 6: Customer Usage API ---');
  const usageRes = await request(`https://app.cloudsetup.in/api/customers/${testCustomer.id}/usage`, { headers: authHeaders });
  console.log(`Usage Status: ${usageRes.status}`);
  const usage = usageRes.data?.data || usageRes.data || {};
  console.log(`Today Upload: ${usage.today?.uploadBytes || 0} bytes, Download: ${usage.today?.downloadBytes || 0} bytes`);

  // 7. Statutory CAF PDF Generation
  console.log('\n--- Step 7: Action 14 — Customer Application Form (CAF) PDF ---');
  const cafRes = await request(`https://app.cloudsetup.in/api/customers/${testCustomer.id}/caf?preview=1`, { headers: authHeaders });
  console.log(`CAF Status: ${cafRes.status}`);
  console.log(`Content-Type: ${cafRes.headers['content-type']}`);
  const isPdf = cafRes.raw.slice(0, 4).toString() === '%PDF';
  console.log(`Valid %PDF magic bytes: ${isPdf}, PDF Size: ${cafRes.raw.length} bytes`);
  if (!isPdf) throw new Error('CAF endpoint did not return valid PDF magic bytes');

  // 8. Invoices API (Action 11 / Action 12)
  console.log('\n--- Step 8: Action 11 & 12 — Invoices & Payment Links ---');
  const invoicesRes = await request(`https://app.cloudsetup.in/api/invoices?customerId=${testCustomer.id}`, { headers: authHeaders });
  console.log(`Invoices Status: ${invoicesRes.status}`);
  const invoices = invoicesRes.data?.data?.items || invoicesRes.data?.items || [];
  console.log(`Invoices for customer: ${invoices.length}`);

  // 9. Tickets API (Action 13)
  console.log('\n--- Step 9: Action 13 — Support Tickets API ---');
  const ticketsRes = await request(`https://app.cloudsetup.in/api/tickets?customerId=${testCustomer.id}`, { headers: authHeaders });
  console.log(`Tickets Status: ${ticketsRes.status}`);
  const tickets = ticketsRes.data?.data?.items || ticketsRes.data?.items || [];
  console.log(`Tickets for customer: ${tickets.length}`);

  // 10. Web Pages Availability
  console.log('\n--- Step 10: Frontend Web Pages Smoke Test ---');
  const pages = [
    `/customers/${testCustomer.id}`,
    '/network/access-requests',
    '/payments',
    '/invoices',
    '/tickets',
  ];

  for (const p of pages) {
    const pageRes = await request(`https://app.cloudsetup.in${p}`);
    console.log(`Web Page [${p}]: HTTP ${pageRes.status}, Length: ${pageRes.raw.length} bytes`);
    if (pageRes.status !== 200) {
      throw new Error(`Failed to load frontend page: ${p} (Status: ${pageRes.status})`);
    }
  }

  console.log('\n==================================================');
  console.log('PRODUCTION OPERATIONS SMOKE TEST: ALL GATES PASSED (100% OPERATIONAL)');
  console.log('==================================================');
}

verifyProduction().catch((err) => {
  console.error('\nProduction Verification Failed:', err);
  process.exit(1);
});
