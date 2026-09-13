import net from 'node:net';
import crypto from 'node:crypto';

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

  async executeCommands(config, commands, timeoutMs = 5000) {
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
  const client = new RouterOsBinaryClient();
  const config = { host: '10.200.0.6', port: 8728, username: 'dipak', password: getDecryptedPassword() };

  const res = await client.executeCommands(config, [
    ['/radius/monitor', '=numbers=0', '=once='],
    ['/radius/print', '=stats='],
    ['/radius/print', '=detail=']
  ]);

  console.log('=== RADIUS MONITOR NUMBERS 0 ===');
  console.log(JSON.stringify(res[0], null, 2));

  console.log('=== RADIUS PRINT STATS ===');
  console.log(JSON.stringify(res[1], null, 2));

  console.log('=== ALL RADIUS ENTRIES (WITHOUT SECRETS) ===');
  const sanitized = (res[2] || []).map((e, idx) => {
    const copy = { index: idx, ...e };
    delete copy.secret;
    return copy;
  });
  console.log(JSON.stringify(sanitized, null, 2));
}

main().catch(console.error);
