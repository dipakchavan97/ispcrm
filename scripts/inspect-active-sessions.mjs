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
        results.push([]);
        socket.write(this.encodeSentence(commands[commandIndex]));
      };

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length > 0) {
          let wordLen = 0;
          let offset = 0;
          const b0 = buffer[0];

          if (b0 === 0x00) {
            buffer = buffer.subarray(1);
            if (currentSentence.length > 0) {
              const replyType = currentSentence[0];
              if (replyType === '!done') {
                if (commandIndex === -1) {
                  sendNextCommand();
                } else {
                  sendNextCommand();
                }
              } else if (replyType === '!re') {
                const item = {};
                for (let i = 1; i < currentSentence.length; i++) {
                  const line = currentSentence[i];
                  if (line.startsWith('=')) {
                    const eqIdx = line.indexOf('=', 1);
                    if (eqIdx !== -1) {
                      item[line.substring(1, eqIdx)] = line.substring(eqIdx + 1);
                    }
                  }
                }
                if (commandIndex >= 0) results[commandIndex].push(item);
              } else if (replyType === '!trap') {
                finishError(new Error(`RouterOS error: ${JSON.stringify(currentSentence)}`));
                return;
              }
              currentSentence = [];
            }
            continue;
          }

          if ((b0 & 0x80) === 0) { wordLen = b0; offset = 1; }
          else if ((b0 & 0xc0) === 0x80) { wordLen = ((b0 & 0x3f) << 8) | buffer[1]; offset = 2; }
          else if ((b0 & 0xe0) === 0xc0) { wordLen = ((b0 & 0x1f) << 16) | (buffer[1] << 8) | buffer[2]; offset = 3; }
          else if ((b0 & 0xf0) === 0xe0) { wordLen = ((b0 & 0x0f) << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3]; offset = 4; }
          else { wordLen = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4]; offset = 5; }

          if (buffer.length < offset + wordLen) break;
          const word = buffer.subarray(offset, offset + wordLen).toString('utf8');
          buffer = buffer.subarray(offset + wordLen);
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
  const [ivHex, authTagHex, cipherTextHex] = parts;
  const secret = 'super-secret-jwt-key-change-in-production';
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(cipherTextHex, 'hex')), decipher.final()]).toString('utf8');
}

async function main() {
  const client = new RouterOsBinaryClient();
  const password = getDecryptedPassword();
  const host = process.env.ROUTER_HOST || '10.200.0.6';
  const config = { host, port: 8728, username: 'dipak', password };

  const res = await client.executeCommands(config, [
    ['/ppp/active/print', '?service=pppoe']
  ]);

  const pppoeSessions = res[0] || [];
  const testSession = pppoeSessions.find(s => s.name?.includes('dipak'));
  const otherSessions = pppoeSessions.filter(s => !s.name?.includes('dipak'));

  console.log('Total PPPoE active sessions:', pppoeSessions.length);
  console.log('Production sessions count (untouched):', otherSessions.length);
  console.log('Test session (dipak@ispcrm):', testSession ? {
    name: testSession.name,
    service: testSession.service,
    callerId: testSession['caller-id'],
    address: testSession.address,
    uptime: testSession.uptime,
    sessionId: testSession['session-id']
  } : 'NOT CONNECTED');
}

main().catch(console.error);
