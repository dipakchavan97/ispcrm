import net from 'node:net';
import crypto from 'node:crypto';
import { prisma } from './packages/database/dist/index.js';

class RouterOsBinaryClient {
  encodeWord(word) {
    const buf = Buffer.from(word, 'utf8');
    let lenBuf;
    const len = buf.length;
    if (len < 0x80) lenBuf = Buffer.from([len]);
    else if (len < 0x4000) lenBuf = Buffer.from([(len >> 8) | 0x80, len & 0xff]);
    else lenBuf = Buffer.from([0xf0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    return Buffer.concat([lenBuf, buf]);
  }

  encodeSentence(words) {
    return Buffer.concat([...words.map(w => this.encodeWord(w)), Buffer.from([0x00])]);
  }

  async executeCommands(config, commands, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      let isSettled = false;
      const socket = net.createConnection({ host: config.host, port: config.port || 8728 });
      const timer = setTimeout(() => {
        if (!isSettled) { isSettled = true; socket.destroy(); reject(new Error('timeout')); }
      }, timeoutMs);

      let receiveBuffer = Buffer.alloc(0);
      const allCommandResults = [];
      let currentCommandIndex = -1;

      const parseWordsFromBuffer = () => {
        const sentences = [];
        let curWords = [];
        let offset = 0;
        while (offset < receiveBuffer.length) {
          const firstByte = receiveBuffer[offset];
          let len = 0, lenBytes = 0;
          if ((firstByte & 0x80) === 0x00) { len = firstByte; lenBytes = 1; }
          else if ((firstByte & 0xc0) === 0x80) { len = ((firstByte & 0x3f) << 8) | receiveBuffer[offset + 1]; lenBytes = 2; }
          if (len === 0 && lenBytes === 1) { sentences.push(curWords); curWords = []; offset += 1; continue; }
          if (offset + lenBytes + len > receiveBuffer.length) break;
          curWords.push(receiveBuffer.toString('utf8', offset + lenBytes, offset + lenBytes + len));
          offset += lenBytes + len;
        }
        receiveBuffer = receiveBuffer.subarray(offset);
        return sentences;
      };

      const sendNextCommand = () => {
        currentCommandIndex++;
        if (currentCommandIndex >= commands.length) {
          if (!isSettled) { isSettled = true; clearTimeout(timer); socket.end(); resolve(allCommandResults); }
          return;
        }
        allCommandResults.push([]);
        socket.write(this.encodeSentence(commands[currentCommandIndex]));
      };

      socket.on('data', (chunk) => {
        receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
        const sentences = parseWordsFromBuffer();
        for (const sentence of sentences) {
          if (sentence.length === 0) continue;
          const replyType = sentence[0];
          if (currentCommandIndex === -1) {
            if (replyType === '!done') {
              sendNextCommand();
            } else if (replyType === '!trap') {
              if (!isSettled) { isSettled = true; clearTimeout(timer); socket.destroy(); reject(new Error(`Login failed: ${sentence.join(' ')}`)); return; }
            }
          } else {
            const currentRes = allCommandResults[currentCommandIndex];
            if (replyType === '!re') {
              const row = {};
              for (let i = 1; i < sentence.length; i++) {
                const line = sentence[i];
                if (line.startsWith('=')) {
                  const eqIdx = line.indexOf('=', 1);
                  if (eqIdx !== -1) {
                    row[line.substring(1, eqIdx)] = line.substring(eqIdx + 1);
                  }
                }
              }
              currentRes.push(row);
            } else if (replyType === '!done') {
              sendNextCommand();
            }
          }
        }
      });

      socket.on('connect', () => {
        socket.write(this.encodeSentence(['/login', `=name=${config.username}`, `=password=${config.password}`]));
      });
      socket.on('error', (e) => {
        if (!isSettled) { isSettled = true; clearTimeout(timer); reject(e); }
      });
    });
  }
}

function getDecryptedPassword() {
  const payload = 'd0f4a6ff8cb5c77860a863ff3b9f7332:4284d40c210e4ab3aa1bfbff5a317c0e:9c73c2572a5722081ac5ed24';
  const parts = payload.split(':');
  const secret = 'super-secret-jwt-key-change-in-production';
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()]).toString('utf8');
}

async function main() {
  console.log('=== PHASE 9F READ-ONLY DIAGNOSIS ===\n');

  // 1. Physical MikroTik Queries
  const client = new RouterOsBinaryClient();
  const config = { host: '10.200.0.6', port: 8728, username: 'dipak', password: getDecryptedPassword() };

  const [radiusEntries, radiusIncoming, firewallFilters, firewallRaw, logs] = await client.executeCommands(config, [
    ['/radius/print', '=detail='],
    ['/radius/incoming/print'],
    ['/ip/firewall/filter/print'],
    ['/ip/firewall/raw/print'],
    ['/log/print', '?topics=radius']
  ]);

  // 2. Identify ISPCRM entry on MikroTik
  const ispcrmEntry = (radiusEntries || []).find(e => e.address === '10.200.0.1' || e.domain === 'ispcrm');
  const ispcrmSecretMikrotik = ispcrmEntry ? ispcrmEntry.secret : null;

  // Sanitized MikroTik entry (NEVER print secret)
  const sanitizedMikrotikEntry = ispcrmEntry ? {
    id: ispcrmEntry['.id'],
    service: ispcrmEntry.service,
    domain: ispcrmEntry.domain,
    address: ispcrmEntry.address,
    authPort: ispcrmEntry['authentication-port'],
    acctPort: ispcrmEntry['accounting-port'],
    timeout: ispcrmEntry.timeout,
    disabled: ispcrmEntry.disabled,
    comment: ispcrmEntry.comment,
    requests: ispcrmEntry.requests,
    accepts: ispcrmEntry.accepts,
    rejects: ispcrmEntry.rejects,
    resends: ispcrmEntry.resends,
    timeouts: ispcrmEntry.timeouts,
    badReplies: ispcrmEntry['bad-replies'],
    pending: ispcrmEntry.pending,
  } : 'NOT_FOUND';

  // 3. PostgreSQL Queries
  const nasRecord = await prisma.nas.findFirst({ where: { nasname: '10.200.0.6' } });
  const routerRecord = await prisma.router.findFirst({ where: { organizationId: '0447e609-d80b-4499-adc7-69c6a4fa25d8' } });

  const postgresNasSecret = nasRecord?.secret || null;
  const postgresRouterSecret = routerRecord?.radiusSecret || null;

  // 4. Secret Comparison (INTERNAL ONLY - NEVER EXPOSE STRING)
  let secretMatch = 'UNKNOWN';
  if (ispcrmSecretMikrotik && postgresNasSecret) {
    if (ispcrmSecretMikrotik === postgresNasSecret) {
      secretMatch = 'YES';
    } else {
      secretMatch = 'NO';
    }
  }

  let routerSecretMatch = 'UNKNOWN';
  if (ispcrmSecretMikrotik && postgresRouterSecret) {
    if (ispcrmSecretMikrotik === postgresRouterSecret) {
      routerSecretMatch = 'YES';
    } else {
      routerSecretMatch = 'NO';
    }
  }

  let nasVsRouterSecretMatch = 'UNKNOWN';
  if (postgresNasSecret && postgresRouterSecret) {
    nasVsRouterSecretMatch = (postgresNasSecret === postgresRouterSecret) ? 'YES' : 'NO';
  }

  // Length check (without exposing value)
  const secretLengths = {
    mikrotikSecretLength: ispcrmSecretMikrotik ? ispcrmSecretMikrotik.length : 0,
    postgresNasSecretLength: postgresNasSecret ? postgresNasSecret.length : 0,
    postgresRouterSecretLength: postgresRouterSecret ? postgresRouterSecret.length : 0,
  };

  // 5. RADIUS Incoming Configuration
  const incomingConfig = (radiusIncoming && radiusIncoming[0]) ? radiusIncoming[0] : 'EMPTY';

  // 6. Firewall rules inspection for UDP 3799
  const udp3799FilterRules = (firewallFilters || []).filter(r => 
    (r['dst-port'] && r['dst-port'].includes('3799')) ||
    (r['port'] && r['port'].includes('3799')) ||
    (r.protocol === 'udp' && (r['dst-port'] === '3799' || r.port === '3799'))
  );

  const defaultDropRules = (firewallFilters || []).filter(r =>
    r.action === 'drop' || r.action === 'reject'
  );

  // Print Structured Findings (Zero Secrets Printed)
  console.log('--- A. SECRET MATCH DIAGNOSIS ---');
  console.log('SECRET_MATCH (MikroTik vs postgres nas.secret):', secretMatch);
  console.log('SECRET_MATCH (MikroTik vs postgres router.radiusSecret):', routerSecretMatch);
  console.log('SECRET_MATCH (postgres nas vs postgres router):', nasVsRouterSecretMatch);
  console.log('Secret Lengths:', secretLengths);

  console.log('\n--- B. MIKROTIK ISPCRM RADIUS ENTRY ---');
  console.log(JSON.stringify(sanitizedMikrotikEntry, null, 2));

  console.log('\n--- C. RADIUS INCOMING CONFIGURATION ---');
  console.log(JSON.stringify(incomingConfig, null, 2));

  console.log('\n--- D. FIREWALL UDP 3799 RULES ---');
  console.log('Matching 3799 Filter Rules:', JSON.stringify(udp3799FilterRules, null, 2));
  console.log('Total Filter Rules:', (firewallFilters || []).length);
  console.log('Total Raw Rules:', (firewallRaw || []).length);
  console.log('Drop/Reject Filter Rules Count:', defaultDropRules.length);
  if (defaultDropRules.length > 0) {
    console.log('Drop rules summary:', defaultDropRules.map(r => ({
      chain: r.chain,
      action: r.action,
      inInterface: r['in-interface'],
      inInterfaceList: r['in-interface-list'],
      protocol: r.protocol,
      comment: r.comment
    })));
  }

  console.log('\n--- E. RECENT RADIUS LOGS ON MIKROTIK ---');
  console.log(JSON.stringify((logs || []).slice(-15), null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
