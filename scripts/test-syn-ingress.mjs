import https from 'node:https';
import { execSync } from 'node:child_process';

function getTcpStats() {
  const cmd = 'powershell -NoProfile -Command "(Get-CimInstance Win32_PerfRawData_Tcpip_TCPv4).ConnectionsPassive"';
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  return Number(out);
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== 1. Reading Windows TCP Stack Passive Opens (Incoming SYN handshakes) ===');
  const beforePassive = getTcpStats();
  console.log('Current Passive Opens (total historical inbound connections):', beforePassive);

  console.log('\n=== 2. Dispatching External TCP 443 Probes (5 global nodes via check-host.net) ===');
  const init = await get('https://check-host.net/check-tcp?host=103.170.1.125:443&max_nodes=5');
  console.log('Request ID:', init.request_id);
  console.log('Target Nodes:', Object.keys(init.nodes || {}));

  console.log('\n=== 3. Waiting 8 seconds for external nodes to transmit TCP SYN packets... ===');
  await new Promise(r => setTimeout(r, 8000));

  const afterPassive = getTcpStats();
  console.log('\n=== 4. Post-Probe Windows TCP Passive Opens ===');
  console.log('Post-Probe Passive Opens:', afterPassive);
  console.log('DELTA (Inbound SYNs processed by Windows):', afterPassive - beforePassive);

  console.log('\n=== 5. External Probe Results from Public Nodes ===');
  const results = await get(`https://check-host.net/check-result/${init.request_id}`);
  for (const [node, r] of Object.entries(results)) {
    console.log(` - ${node}:`, JSON.stringify(r));
  }
}

main().catch(console.error);
