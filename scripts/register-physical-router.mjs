import http from 'node:http';

async function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('--- REGISTERING PHYSICAL MIKROTIK (ROUTEROS 6.45.1) FOR SSTP ---');

  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  const orgEmail = `operator.${randomSuffix}@ispnet.in`;
  const orgPassword = 'SecureOperatorPassword123!';

  // 1. Register Org or Login
  console.log(`1. Creating tenant with ownerEmail: ${orgEmail}...`);
  let token = '';

  const regOrgRes = await request(
    {
      hostname: 'localhost',
      port: 4000,
      path: '/api/auth/register-org',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    {
      name: `ISP Production Net ${randomSuffix}`,
      slug: `ispnet-${randomSuffix}`,
      email: orgEmail,
      phone: '9876543210',
      ownerName: 'Dipak Operator',
      ownerEmail: orgEmail,
      ownerPassword: orgPassword,
    },
  );

  if (regOrgRes.status === 201 || regOrgRes.status === 200) {
    token = regOrgRes.body.data?.accessToken || regOrgRes.body.accessToken || regOrgRes.body.token;
  } else {
    // Fallback login
    const loginRes = await request(
      {
        hostname: 'localhost',
        port: 4000,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      { email: orgEmail, password: orgPassword },
    );
    token = loginRes.body.data?.accessToken || loginRes.body.accessToken || loginRes.body.token;
  }

  if (!token) {
    console.error('Failed to acquire token:', regOrgRes.body);
    process.exit(1);
  }
  console.log('Token acquired successfully.');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // 2. Register Physical Router
  console.log('\n2. Registering physical router 103.170.1.22 in SSTP_TUNNEL mode...');
  const regPayload = {
    name: 'Physical-MikroTik-ROS6-45-1',
    host: '103.170.1.22',
    port: 8728,
    username: 'dipak',
    password: process.env.ROUTER_PASSWORD || 'RouterPassword123!',
    connectionMethod: 'SSTP_TUNNEL',
    apiMethod: 'BINARY_API',
  };

  const regRes = await request(
    {
      hostname: 'localhost',
      port: 4000,
      path: '/api/routers',
      method: 'POST',
      headers,
    },
    regPayload,
  );

  console.log('Registration HTTP Status:', regRes.status);
  let routerId = '';
  const routerData = regRes.body.data || regRes.body;
  if (regRes.status === 200 || regRes.status === 201) {
    routerId = routerData.id;
    console.log('Registered Router ID:', routerId);
    console.log('Assigned VPN IP:', routerData.vpnIp);
    console.log('Assigned VPN User:', routerData.vpnUsername);
  } else {
    console.error('Registration failed:', regRes.body);
    process.exit(1);
  }

  // 3. Fetch Generated Provisioning Script for v6
  console.log('\n3. Fetching generated RouterOS v6.45.1 configuration script...');
  const scriptRes = await request(
    {
      hostname: 'localhost',
      port: 4000,
      path: `/api/routers/${routerId}/sstp-script?version=v6`,
      method: 'GET',
      headers,
    },
  );

  const scriptData = scriptRes.body.data || scriptRes.body;

  console.log('\n======================================================');
  console.log('GENERATED ROUTEROS 6.45.1 SSTP PROVISIONING SCRIPT:');
  console.log('======================================================');
  console.log(scriptData.script);
  console.log('======================================================\n');
}

main().catch(console.error);
