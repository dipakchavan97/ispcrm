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
  console.log('=== 1. Logging in as owner of Physical MikroTik ===');
  const loginRes = await request('https://app.cloudsetup.in/api/auth/login', { method: 'POST' }, JSON.stringify({
    email: 'operator.409408@ispnet.in',
    password: 'SecureOperatorPassword123!'
  }));

  const token = loginRes.data?.data?.accessToken || loginRes.data?.accessToken;
  console.log('Login Status:', loginRes.status, 'Token acquired:', !!token);

  if (!token) {
    console.error('Failed to log in:', loginRes);
    return;
  }

  const routerId = '76075d82-fa61-409c-888a-e7e1fe2fb22a';
  console.log(`\n=== 2. Fetching router details for ${routerId} ===`);
  const routerRes = await request(`https://app.cloudsetup.in/api/routers/${routerId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const router = routerRes.data?.data || routerRes.data;
  console.log('Router Name:', router.name);
  console.log('Connection Method:', router.connectionMethod);
  console.log('Host:', router.host);
  console.log('Port:', router.port);
  console.log('Assigned VPN IP:', router.vpnIp);
  console.log('Assigned VPN User:', router.vpnUsername);

  console.log(`\n=== 3. Executing Test Connection on ${router.name} ===`);
  const testRes = await request(`https://app.cloudsetup.in/api/routers/${routerId}/test-connection`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  console.log('Test Connection HTTP Status:', testRes.status);
  console.log('Test Connection Response Data:');
  console.log(JSON.stringify(testRes.data, null, 2));
}

main().catch(console.error);
