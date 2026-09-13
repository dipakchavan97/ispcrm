import https from 'node:https';

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + (u.search || ''),
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...options.headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== 1. Logging into https://app.cloudsetup.in ===');
  const loginRes = await request('https://app.cloudsetup.in/api/auth/login', { method: 'POST' }, JSON.stringify({
    email: 'admin@speednet.in',
    password: 'admin123'
  }));

  const token = loginRes.data?.data?.accessToken || loginRes.data?.accessToken;
  console.log('Login Status:', loginRes.status, 'Token acquired:', !!token);

  console.log('\n=== 2. Fetching routers inventory ===');
  const routersRes = await request('https://app.cloudsetup.in/api/routers', {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const routers = routersRes.data?.data || routersRes.data || [];
  console.log(`Total Routers in Org: ${routers.length}`);
  for (const r of routers) {
    console.log(`- ID: ${r.id} | Name: ${r.name} | Host: ${r.host} | ConnMethod: ${r.connectionMethod} | VpnIp: ${r.vpnIp} | VpnUser: ${r.vpnUsername}`);
  }

  // Find router with physical IP 103.170.1.22
  const physicalRouter = routers.find(r => r.host === '103.170.1.22' || r.name.includes('Physical'));
  if (physicalRouter) {
    console.log(`\n=== 3. Testing connection on physical router ${physicalRouter.name} (${physicalRouter.id}) ===`);
    const testRes = await request(`https://app.cloudsetup.in/api/routers/${physicalRouter.id}/test-connection`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Test Connection Status:', testRes.status);
    console.log('Test Connection Result:', JSON.stringify(testRes.data, null, 2));
  } else {
    console.log('\nPhysical router not found under admin@speednet.in. Searching across all orgs in DB...');
  }
}

main().catch(console.error);
