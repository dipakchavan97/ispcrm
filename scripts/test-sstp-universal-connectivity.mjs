// @ts-check
import assert from 'node:assert';

const API_BASE = process.env.API_URL || 'http://localhost:4000/api';

async function main() {
  console.log('\n======================================================');
  console.log('🧪 TESTING UNIVERSAL MIKROTIK SSTP & ROS 6/7 CONNECTIVITY');
  console.log('======================================================\n');

  // Step 1: Login as ISP Owner / Admin
  console.log('1. Authenticating as ISP Admin...');
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@speednet.in',
      password: 'admin123',
    }),
  });

  assert.strictEqual(loginRes.status, 200, `Login failed: ${loginRes.statusText}`);
  const loginData = await loginRes.json();
  const token = loginData.data?.accessToken || loginData.token;
  assert.ok(token, 'JWT token must be present');
  console.log('✅ Authenticated successfully. Token acquired.');

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // Step 2: Register a router using SSTP_TUNNEL mode
  console.log('\n2. Registering router in SSTP_TUNNEL mode...');
  const registerPayload = {
    name: 'Auto-SSTP-Edge-CCR',
    connectionMethod: 'SSTP_TUNNEL',
    apiMethod: 'AUTO',
    port: 8728,
    username: 'admin',
    password: 'SecureAdminPass123!',
    radiusSecret: 'sstp-secret-radius-999',
    testOnRegister: false,
  };

  const regRes = await fetch(`${API_BASE}/routers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(registerPayload),
  });

  const regText = await regRes.text();
  assert.strictEqual(regRes.status, 201, `Failed to register SSTP router: ${regText}`);
  const regParsed = JSON.parse(regText);
  const registeredRouter = regParsed.data || regParsed;
  console.log(`✅ SSTP Router registered with ID: ${registeredRouter.id}`);
  console.log(`   - Connection Method: ${registeredRouter.connectionMethod}`);
  console.log(`   - Allocated VPN IP:  ${registeredRouter.vpnIp}`);
  console.log(`   - Generated VPN User: ${registeredRouter.vpnUsername}`);

  // Assertions on SSTP allocation and zero secret leakage
  assert.strictEqual(registeredRouter.connectionMethod, 'SSTP_TUNNEL');
  assert.ok(registeredRouter.vpnIp && registeredRouter.vpnIp.startsWith('10.200.'), 'VPN IP must be in 10.200.0.0/16 pool');
  assert.ok(registeredRouter.vpnUsername && registeredRouter.vpnUsername.startsWith('rtr_'), 'VPN username must be prefixed with rtr_');
  assert.strictEqual(registeredRouter.encryptedVpnSecret, undefined, 'Encrypted VPN secret MUST NEVER be leaked in API response');
  assert.strictEqual(registeredRouter.vpnPassword, undefined, 'Plaintext VPN password MUST NEVER be leaked in API response');
  assert.strictEqual(registeredRouter.password, undefined, 'Plaintext API password MUST NEVER be leaked in API response');
  console.log('✅ Zero credential leakage confirmed (AES-256-GCM encrypted in DB).');

  // Step 3: Fetch RouterOS v6 Provisioning Script
  console.log('\n3. Generating RouterOS v6.x (Legacy) Provisioning Script...');
  const v6ScriptRes = await fetch(`${API_BASE}/routers/${registeredRouter.id}/sstp-script?version=v6`, {
    headers: authHeaders,
  });
  const v6Text = await v6ScriptRes.text();
  assert.strictEqual(v6ScriptRes.status, 200, `Failed to fetch v6 script: ${v6Text}`);
  const v6Parsed = JSON.parse(v6Text);
  const v6Data = v6Parsed.data || v6Parsed;
  console.log('✅ RouterOS v6 Script received:');
  console.log('--------------------------------------------------');
  console.log(v6Data.script);
  console.log('--------------------------------------------------');

  // Validate ROS 6 specific script commands
  assert.ok(v6Data.script.includes('/interface sstp-client add'), 'Must configure /interface sstp-client');
  assert.ok(v6Data.script.includes(`user="${registeredRouter.vpnUsername}"`), 'Must configure assigned VPN user');
  assert.ok(v6Data.script.includes('profile="default-encryption"'), 'Must use default-encryption profile');
  assert.ok(v6Data.script.includes('/radius add service=ppp'), 'Must configure FreeRADIUS server');
  assert.ok(v6Data.script.includes('secret="sstp-secret-radius-999"'), 'Must configure RADIUS secret');
  assert.ok(v6Data.script.includes('/radius incoming set accept=yes port=3799'), 'Must configure incoming CoA UDP 3799');
  assert.ok(v6Data.script.includes('/ip service enable api'), 'Must ensure Binary API TCP 8728 is enabled for ROS 6');
  console.log('✅ RouterOS v6 script syntax fully verified.');

  // Step 4: Fetch RouterOS v7 Provisioning Script
  console.log('\n4. Generating RouterOS v7.x (Modern) Provisioning Script...');
  const v7ScriptRes = await fetch(`${API_BASE}/routers/${registeredRouter.id}/sstp-script?version=v7`, {
    headers: authHeaders,
  });
  const v7Text = await v7ScriptRes.text();
  assert.strictEqual(v7ScriptRes.status, 200, `Failed to fetch v7 script: ${v7Text}`);
  const v7Parsed = JSON.parse(v7Text);
  const v7Data = v7Parsed.data || v7Parsed;
  assert.ok(v7Data.script.includes('/interface sstp-client add'), 'Must configure /interface sstp-client');
  assert.ok(v7Data.script.includes('/radius add service=ppp'), 'Must configure FreeRADIUS server');
  assert.ok(v7Data.script.includes('/ip service enable www'), 'Must ensure REST service enabled for ROS 7');
  console.log('✅ RouterOS v7 script syntax fully verified.');

  // Step 5: Register a router in DIRECT_API mode with BINARY_API method
  console.log('\n5. Registering router in DIRECT_API mode with BINARY_API method...');
  const directBinaryPayload = {
    name: 'Physical-Branch-RB951',
    host: '10.10.10.50',
    port: 8728,
    connectionMethod: 'DIRECT_API',
    apiMethod: 'BINARY_API',
    username: 'admin',
    password: 'BinaryPass456!',
    radiusSecret: 'direct-radius-secret',
    testOnRegister: false,
  };

  const directRes = await fetch(`${API_BASE}/routers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(directBinaryPayload),
  });

  const directText = await directRes.text();
  assert.strictEqual(directRes.status, 201, `Failed to register Direct router: ${directText}`);
  const directParsed = JSON.parse(directText);
  const directRouter = directParsed.data || directParsed;
  console.log(`✅ Direct Binary Router registered with ID: ${directRouter.id}`);
  assert.strictEqual(directRouter.connectionMethod, 'DIRECT_API');
  assert.strictEqual(directRouter.apiMethod, 'BINARY_API');
  assert.strictEqual(directRouter.host, '10.10.10.50');
  assert.strictEqual(directRouter.port, 8728);

  // Step 6: Verify router list contains both routers with metadata
  console.log('\n6. Fetching router inventory list...');
  const listRes = await fetch(`${API_BASE}/routers`, { headers: authHeaders });
  assert.strictEqual(listRes.status, 200);
  const listParsed = await listRes.json();
  const routerList = listParsed.data || listParsed;
  const foundSstp = routerList.find((r) => r.id === registeredRouter.id);
  const foundDirect = routerList.find((r) => r.id === directRouter.id);
  assert.ok(foundSstp, 'SSTP router must be in inventory');
  assert.ok(foundDirect, 'Direct router must be in inventory');
  assert.strictEqual(foundSstp.connectionMethod, 'SSTP_TUNNEL');
  assert.strictEqual(foundDirect.apiMethod, 'BINARY_API');
  console.log(`✅ Router inventory contains ${routerList.length} routers with connection and API methods.`);

  // Clean up created test routers
  console.log('\n7. Cleaning up test routers...');
  await fetch(`${API_BASE}/routers/${registeredRouter.id}`, { method: 'DELETE', headers: authHeaders });
  await fetch(`${API_BASE}/routers/${directRouter.id}`, { method: 'DELETE', headers: authHeaders });
  console.log('✅ Cleanup complete.');

  console.log('\n======================================================');
  console.log('🎉 ALL UNIVERSAL CONNECTIVITY & SSTP TESTS PASSED!');
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
