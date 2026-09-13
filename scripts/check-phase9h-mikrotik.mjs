import net from 'node:net';
import crypto from 'node:crypto';

class RouterOsBinaryClient {
  encodeWord(word) {
    const buf = Buffer.from(word, 'utf8');
    let lenBuf;
    const len = buf.length;
    if (len < 0x80) {
      lenBuf = Buffer.from([len]);
    } else if (len < 0x4000) {
      lenBuf = Buffer.from([(len >> 8) | 0x80, len & 0xff]);
    } else if (len < 0x200000) {
      lenBuf = Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
    } else if (len < 0x10000000) {
      lenBuf = Buffer.from([(len >> 24) | 0xe0, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    } else {
      lenBuf = Buffer.from([0xf0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    }
    return Buffer.concat([lenBuf, buf]);
  }

  encodeSentence(words) {
    const bufs = words.map((w) => this.encodeWord(w));
    bufs.push(Buffer.from([0x00]));
    return Buffer.concat(bufs);
  }

  async executeCommands(config, commands, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let isSettled = false;
      const port = config.port || 8728;
      const socket = net.createConnection({ host: config.host, port });

      const finishError = (err) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        try { socket.destroy(); } catch {}
        reject(err);
      };

      const finishSuccess = (results) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        try { socket.end(); } catch {}
        resolve(results);
      };

      const timer = setTimeout(() => finishError(new Error('Timeout')), timeoutMs);

      let buffer = Buffer.alloc(0);
      let currentSentence = [];
      const results = [];
      let commandIndex = -1;

      const sendNextCommand = () => {
        commandIndex++;
        if (commandIndex >= commands.length) {
          finishSuccess(results);
          return;
        }
        const cmd = commands[commandIndex];
        socket.write(this.encodeSentence(cmd));
      };

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length > 0) {
          let b = buffer[0];
          let len = 0;
          let offset = 0;
          if ((b & 0x80) === 0) { len = b; offset = 1; }
          else if ((b & 0xc0) === 0x80) {
            if (buffer.length < 2) break;
            len = ((b & 0x3f) << 8) | buffer[1]; offset = 2;
          } else if ((b & 0xe0) === 0xc0) {
            if (buffer.length < 3) break;
            len = ((b & 0x1f) << 16) | (buffer[1] << 8) | buffer[2]; offset = 3;
          } else if ((b & 0xf0) === 0xe0) {
            if (buffer.length < 4) break;
            len = ((b & 0x0f) << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3]; offset = 4;
          } else {
            if (buffer.length < 5) break;
            len = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4]; offset = 5;
          }

          if (buffer.length < offset + len) break;

          const word = buffer.subarray(offset, offset + len).toString('utf8');
          buffer = buffer.subarray(offset + len);

          if (word.length === 0) {
            if (currentSentence.length > 0) {
              const sentenceType = currentSentence[0];
              if (sentenceType === '!re') {
                const row = {};
                for (let i = 1; i < currentSentence.length; i++) {
                  const part = currentSentence[i];
                  if (part.startsWith('=')) {
                    const eqIdx = part.indexOf('=', 1);
                    if (eqIdx !== -1) {
                      row[part.substring(1, eqIdx)] = part.substring(eqIdx + 1);
                    } else {
                      row[part.substring(1)] = '';
                    }
                  }
                }
                if (!results[commandIndex]) results[commandIndex] = [];
                results[commandIndex].push(row);
              } else if (sentenceType === '!done') {
                if (!results[commandIndex]) results[commandIndex] = [];
                sendNextCommand();
              } else if (sentenceType === '!trap') {
                finishError(new Error('RouterOS Trap: ' + JSON.stringify(currentSentence)));
                return;
              }
            }
            currentSentence = [];
            continue;
          }
          currentSentence.push(word);
        }
      });

      socket.on('error', finishError);
      socket.on('connect', () => {
        socket.write(this.encodeSentence(['/login', `=name=${config.username}`, `=password=${config.password}`]));
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
  const client = new RouterOsBinaryClient();
  const config = { host: '10.200.0.6', port: 8728, username: 'dipak', password: getDecryptedPassword() };

  const [radiusList, actives, incoming] = await client.executeCommands(config, [
    ['/radius/print'],
    ['/ppp/active/print'],
    ['/radius/incoming/print']
  ]);

  console.log('--- MIKROTIK RADIUS SERVERS ---');
  radiusList.forEach((r, idx) => {
    console.log(`Index ${idx}: .id=${r['.id']}, domain="${r.domain}", address=${r.address}, service=${r.service}, comment="${r.comment || ''}"`);
  });

  const ispcrmFirst = radiusList[0] && radiusList[0].domain === 'ispcrm' && radiusList[0].address === '10.200.0.1';
  const xceednetSecond = radiusList[1] && (radiusList[1].domain === '' || radiusList[1].domain === undefined) && radiusList[1].address === '172.16.1.12';
  console.log(`ISPCRM first: ${ispcrmFirst}`);
  console.log(`XceedNet second: ${xceednetSecond}`);

  console.log('\n--- PPP ACTIVE SESSIONS ---');
  console.log(`Total active PPP sessions: ${actives.length}`);
  const ispcrmSession = actives.find(a => (a.name || '').includes('ispcrm'));
  const prodSessions = actives.filter(a => !(a.name || '').includes('ispcrm'));
  console.log(`Production sessions: ${prodSessions.length}`);
  console.log(`ISPCRM test session:`, ispcrmSession ? {
    name: ispcrmSession.name,
    service: ispcrmSession.service,
    address: ispcrmSession.address,
    uptime: ispcrmSession.uptime,
    sessionId: ispcrmSession['session-id']
  } : 'NOT CONNECTED');
  console.log('RADIUS incoming:', incoming);
}

main().catch(console.error);
