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

  async executeCommands(config, commands, timeoutMs = 8000) {
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

      const timer = setTimeout(() => {
        finishError(new Error(`Timeout connecting to ${config.host}:${port}`));
      }, timeoutMs);

      let receiveBuffer = Buffer.alloc(0);
      const allCommandResults = [];
      let currentCommandIndex = -1;
      let isAuthenticated = false;

      const parseWordsFromBuffer = () => {
        let offset = 0;
        const words = [];
        while (offset < receiveBuffer.length) {
          const firstByte = receiveBuffer[offset];
          let length = 0;
          let lenBytes = 0;
          if ((firstByte & 0x80) === 0x00) {
            length = firstByte;
            lenBytes = 1;
          } else if ((firstByte & 0xc0) === 0x80) {
            if (offset + 2 > receiveBuffer.length) return null;
            length = ((firstByte & 0x3f) << 8) | receiveBuffer[offset + 1];
            lenBytes = 2;
          } else if ((firstByte & 0xe0) === 0xc0) {
            if (offset + 3 > receiveBuffer.length) return null;
            length = ((firstByte & 0x1f) << 16) | (receiveBuffer[offset + 1] << 8) | receiveBuffer[offset + 2];
            lenBytes = 3;
          } else if ((firstByte & 0xf0) === 0xe0) {
            if (offset + 4 > receiveBuffer.length) return null;
            length = ((firstByte & 0x0f) << 24) | (receiveBuffer[offset + 1] << 16) | (receiveBuffer[offset + 2] << 8) | receiveBuffer[offset + 3];
            lenBytes = 4;
          } else if (firstByte === 0xf0) {
            if (offset + 5 > receiveBuffer.length) return null;
            length = (receiveBuffer[offset + 1] << 24) | (receiveBuffer[offset + 2] << 16) | (receiveBuffer[offset + 3] << 8) | receiveBuffer[offset + 4];
            lenBytes = 5;
          }

          offset += lenBytes;
          if (length === 0) {
            receiveBuffer = receiveBuffer.subarray(offset);
            return words;
          }
          if (offset + length > receiveBuffer.length) {
            return null;
          }
          const word = receiveBuffer.subarray(offset, offset + length).toString('utf8');
          words.push(word);
          offset += length;
        }
        return null;
      };

      const sendNextCommand = () => {
        currentCommandIndex++;
        if (currentCommandIndex >= commands.length) {
          finishSuccess(allCommandResults);
          return;
        }
        allCommandResults.push([]);
        const cmd = commands[currentCommandIndex];
        socket.write(this.encodeSentence(cmd));
      };

      const handleSentence = (words) => {
        if (!words || words.length === 0) return;
        const replyType = words[0];
        const attributes = {};
        for (let i = 1; i < words.length; i++) {
          const w = words[i];
          if (w.startsWith('=')) {
            const eqIdx = w.indexOf('=', 1);
            if (eqIdx !== -1) {
              const k = w.substring(1, eqIdx);
              const v = w.substring(eqIdx + 1);
              attributes[k] = v;
            } else {
              attributes[w.substring(1)] = 'true';
            }
          }
        }

        if (!isAuthenticated) {
          if (replyType === '!trap') {
            finishError(new Error(`Auth trap: ${attributes.message || 'unknown error'}`));
            return;
          }
          if (replyType === '!done') {
            if (attributes.ret) {
              const md5 = crypto.createHash('md5');
              md5.update(Buffer.concat([Buffer.from([0x00]), Buffer.from(config.password, 'utf8'), Buffer.from(attributes.ret, 'hex')]));
              const challengeResponse = md5.digest('hex');
              socket.write(this.encodeSentence([
                '/login',
                `=name=${config.username}`,
                `=response=00${challengeResponse}`
              ]));
            } else {
              isAuthenticated = true;
              sendNextCommand();
            }
          }
          return;
        }

        if (replyType === '!re') {
          allCommandResults[currentCommandIndex].push(attributes);
        } else if (replyType === '!trap') {
          allCommandResults[currentCommandIndex].push({ error: attributes.message || 'trap error' });
        } else if (replyType === '!done') {
          sendNextCommand();
        }
      };

      socket.on('connect', () => {
        socket.write(this.encodeSentence(['/login', `=name=${config.username}`, `=password=${config.password}`]));
      });

      socket.on('data', (chunk) => {
        receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
        while (true) {
          const words = parseWordsFromBuffer();
          if (!words) break;
          handleSentence(words);
        }
      });

      socket.on('error', finishError);
    });
  }
}

function getDecryptedPassword() {
  const payload = 'd0f4a6ff8cb5c77860a863ff3b9f7332:4284d40c210e4ab3aa1bfbff5a317c0e:9c73c2572a5722081ac5ed24';
  const parts = payload.split(':');
  const [ivHex, authTagHex, cipherTextHex] = parts;
  const secret = 'super-secret-jwt-key-change-in-production';
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const cipherText = Buffer.from(cipherTextHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return decrypted.toString('utf8');
}

async function main() {
  const client = new RouterOsBinaryClient();
  const password = getDecryptedPassword();
  const config = {
    host: '103.170.1.22',
    port: 8728,
    username: 'dipak',
    password
  };

  console.log('Connecting to physical MikroTik...');
  const res = await client.executeCommands(config, [
    ['/ppp/active/print'],
    ['/queue/simple/print'],
    ['/radius/print', '?service=ppp'],
    ['/radius/monitor', '=numbers=0', '=once='],
    ['/radius/monitor', '=numbers=1', '=once='],
    ['/ip/pool/print'],
    ['/ppp/profile/print'],
    ['/ip/firewall/nat/print'],
    ['/ip/route/print', '?dst-address=0.0.0.0/0']
  ]);

  console.log('=== 1. ACTIVE PPP SESSIONS ===');
  console.log(JSON.stringify(res[0], null, 2));

  console.log('=== 2. QUEUE SIMPLE ===');
  console.log(JSON.stringify(res[1].filter(q => q.name.includes('dipak') || q.target?.includes('10.255') || q.target?.includes('172.18')), null, 2));

  console.log('=== 3. RADIUS SERVERS ===');
  console.log(JSON.stringify(res[2], null, 2));

  console.log('=== 4. RADIUS 0 MONITOR ===');
  console.log(JSON.stringify(res[3], null, 2));

  console.log('=== 5. RADIUS 1 MONITOR ===');
  console.log(JSON.stringify(res[4], null, 2));

  console.log('=== 6. IP POOLS ===');
  console.log(JSON.stringify(res[5], null, 2));

  console.log('=== 7. PPP PROFILES ===');
  console.log(JSON.stringify(res[6], null, 2));

  console.log('=== 8. NAT RULES ===');
  console.log(JSON.stringify(res[7], null, 2));
}

main().catch(console.error);
