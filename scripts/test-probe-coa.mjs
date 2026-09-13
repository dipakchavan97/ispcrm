import { RadiusCoaClient } from '@isp-crm/shared';

async function main() {
  console.log('Sending UDP 3799 Disconnect-Request probe for dummy/non-existent subscriber...');
  const startTime = Date.now();
  const res = await RadiusCoaClient.sendDisconnectRequest({
    nasIp: '10.200.0.6',
    nasPort: 3799,
    secret: 'de7703b89034d1f500f2642a7d0230fc',
    username: 'nonexistent-probe-check@ispcrm',
    timeoutMs: 3000,
    maxRetries: 1,
  });

  console.log('--- RADIUS DYNAMIC AUTH PROBE RESULT ---');
  console.log('Success:', res.success);
  console.log('Code:', res.code, `(${res.codeName})`);
  console.log('NAS Destination:', `${res.nasIp}:${res.nasPort}`);
  console.log('Latency:', `${res.latencyMs}ms`);
  console.log('Attempts:', res.attemptsMade);
  console.log('Error-Cause / Details:', res.errorCause);
}

main().catch(console.error);
