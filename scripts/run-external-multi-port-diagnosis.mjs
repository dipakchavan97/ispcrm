import https from 'node:https';
import http from 'node:http';
import { execSync } from 'node:child_process';

const TARGET_HOST = '103.170.1.125';
const PORTS = [443, 8443, 8080, 2001, 50000];

function getPassiveOpens() {
  try {
    const out = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_PerfRawData_Tcpip_TCPv4).ConnectionsPassive"', { encoding: 'utf8' });
    return Number(out.trim());
  } catch (e) {
    return null;
  }
}

function getListenerConnections() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:55555/', (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ connections: [] }); }
      });
    }).on('error', () => resolve({ connections: [] }));
  });
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function probePort(port) {
  console.log(`\n======================================================`);
  console.log(`🔍 TESTING EXTERNAL INGRESS ON TCP PORT ${port}`);
  console.log(`======================================================`);

  const initialPassive = getPassiveOpens();
  const initialListenerState = await getListenerConnections();
  const initialListenerCount = initialListenerState.connections?.length || 0;

  console.log(`[Baseline] Windows TCP Passive Opens: ${initialPassive}`);
  console.log(`[Baseline] Listener Connections count: ${initialListenerCount}`);

  // Initiate probe via check-host.net
  const probeInit = await httpsGetJson(`https://check-host.net/check-tcp?host=${TARGET_HOST}:${port}&max_nodes=4`);
  const requestId = probeInit.request_id;
  const nodes = Object.keys(probeInit.nodes || {});
  console.log(`[check-host.net] Request ID: ${requestId} | Nodes: ${nodes.join(', ')}`);

  // Wait 7 seconds for external nodes to complete TCP connect attempts
  await new Promise(r => setTimeout(r, 7000));

  const postPassive = getPassiveOpens();
  const postListenerState = await getListenerConnections();
  const postListenerCount = postListenerState.connections?.length || 0;
  const newConnections = postListenerState.connections?.slice(initialListenerCount) || [];

  const probeResults = await httpsGetJson(`https://check-host.net/check-result/${requestId}`);

  console.log(`\n[Results for Port ${port}]:`);
  for (const node of nodes) {
    const r = probeResults[node];
    const statusStr = JSON.stringify(r);
    console.log(`  - Node ${node}: ${statusStr}`);
  }

  console.log(`\n[Host Observation for Port ${port}]:`);
  console.log(`  - Windows TCP Passive Opens Delta: ${postPassive !== null && initialPassive !== null ? postPassive - initialPassive : 'N/A'}`);
  console.log(`  - Listener Received Connections: ${newConnections.length}`);
  if (newConnections.length > 0) {
    for (const c of newConnections) {
      console.log(`    * From: ${c.remoteAddress}:${c.remotePort} at ${c.timestamp}`);
    }
  }

  return {
    port,
    nodes,
    results: probeResults,
    passiveDelta: postPassive !== null && initialPassive !== null ? postPassive - initialPassive : 0,
    receivedConnections: newConnections,
  };
}

async function main() {
  console.log('######################################################');
  console.log('UPSTREAM TCP INGRESS & PORT FILTERING DIAGNOSTIC');
  console.log(`Target: ${TARGET_HOST} across ports ${PORTS.join(', ')}`);
  console.log('######################################################');

  const summary = [];
  for (const port of PORTS) {
    const res = await probePort(port);
    summary.push(res);
  }

  console.log('\n\n######################################################');
  console.log('FINAL EXTERNAL INGRESS SUMMARY TABLE');
  console.log('######################################################');
  console.log('Port   | External Result        | Passive Delta | Host Listener Received');
  console.log('-------+------------------------+---------------+-----------------------');
  for (const s of summary) {
    let allTimeout = true;
    let anySuccess = false;
    for (const [node, r] of Object.entries(s.results || {})) {
      if (Array.isArray(r) && r[0]?.time) anySuccess = true;
      if (Array.isArray(r) && !r[0]?.error) allTimeout = false;
    }
    const extVerdict = anySuccess ? 'OPEN / CONNECTED' : (allTimeout ? 'ALL TIMEOUT' : 'MIXED / FILTERED');
    console.log(`${s.port.toString().padEnd(6)} | ${extVerdict.padEnd(22)} | ${(s.passiveDelta.toString()).padEnd(13)} | ${s.receivedConnections.length > 0 ? `YES (${s.receivedConnections.length})` : 'NO (0)'}`);
  }
}

main().catch(console.error);
