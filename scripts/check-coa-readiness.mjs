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

      const timer = setTimeout(() => {
        finishError(new Error(`Timeout connecting to ${config.host}:${port}`));
      }, timeoutMs);

      let receiveBuffer = Buffer.alloc(0);
      const allCommandResults = [];
      let currentCommandIndex = -1;
      let isAuthenticated = false;

      const parseWordsFromBuffer = () => {
        const sentences = [];
        let curWords = [];
        let offset = 0;

        while (offset < receiveBuffer.length) {
          const firstByte = receiveBuffer[offset];
          let len = 0;
          let lenBytes = 0;

          if ((firstByte & 0x80) === 0x00) {
            len = firstByte;
            lenBytes = 1;
          } else if ((firstByte & 0xc0) === 0x80) {
            if (offset + 2 > receiveBuffer.length) break;
            len = ((firstByte & 0x3f) << 8) | receiveBuffer[offset + 1];
            lenBytes = 2;
          } else if ((firstByte & 0xe0) === 0xc0) {
            if (offset + 3 > receiveBuffer.length) break;
            len = ((firstByte & 0x1f) << 16) | (receiveBuffer[offset + 1] << 8) | receiveBuffer[offset + 2];
            lenBytes = 3;
          } else if ((firstByte & 0xf0) === 0xe0) {
            if (offset + 4 > receiveBuffer.length) break;
            len = ((firstByte & 0x0f) << 24) | (receiveBuffer[offset + 1] << 16) | (receiveBuffer[offset + 2] << 8) | receiveBuffer[offset + 3];
            lenBytes = 4;
          } else if ((firstByte & 0xf8) === 0xf0) {
            if (offset + 5 > receiveBuffer.length) break;
            len = (receiveBuffer[offset + 1] << 24) | (receiveBuffer[offset + 2] << 16) | (receiveBuffer[offset + 3] << 8) | receiveBuffer[offset + 4];
            lenBytes = 5;
          }

          if (len === 0 && lenBytes === 1) {
            sentences.push(curWords);
            curWords = [];
            offset += 1;
            continue;
          }

          if (offset + lenBytes + len > receiveBuffer.length) break;

          const word = receiveBuffer.toString('utf8', offset + lenBytes, offset + lenBytes + len);
          curWords.push(word);
          offset += lenBytes + len;
        }

        if (offset > 0) {
          receiveBuffer = receiveBuffer.subarray(offset);
        }
        return sentences;
      };

      const sendNextCommand = () => {
        currentCommandIndex++;
        if (currentCommandIndex >= commands.length) {
          finishSuccess(allCommandResults);
          return;
        }
        const cmd = commands[currentCommandIndex];
        allCommandResults.push([]);
        socket.write(this.encodeSentence(cmd));
      };

      socket.on('data', (chunk) => {
        receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
        const sentences = parseWordsFromBuffer();

        for (const sentence of sentences) {
          if (!sentence || sentence.length === 0) continue;
          const replyType = sentence[0];

          if (!isAuthenticated) {
            if (replyType === '!done') {
              const retWord = sentence.find((w) => w.startsWith('=ret='));
              if (retWord) {
                const challengeHex = retWord.split('=')[2];
                const md5 = crypto.createHash('md5');
                md5.update(Buffer.from([0]));
                md5.update(Buffer.from(config.password, 'utf8'));
                md5.update(Buffer.from(challengeHex, 'hex'));
                const responseHex = '00' + md5.digest('hex');
                socket.write(this.encodeSentence(['/login', `=name=${config.username}`, `=response=${responseHex}`]));
              } else {
                isAuthenticated = true;
                sendNextCommand();
              }
            } else if (replyType === '!trap' || replyType === '!fatal') {
              finishError(new Error(`RouterOS auth error: ${sentence.join(' ')}`));
            }
          } else {
            const currentRes = allCommandResults[currentCommandIndex];
            if (replyType === '!re') {
              const row = {};
              for (let i = 1; i < sentence.length; i++) {
                const word = sentence[i];
                if (word.startsWith('=')) {
                  const firstEq = word.indexOf('=', 1);
                  if (firstEq !== -1) {
                    const k = word.substring(1, firstEq);
                    const v = word.substring(firstEq + 1);
                    row[k] = v;
                  }
                }
              }
              currentRes.push(row);
            } else if (replyType === '!done') {
              sendNextCommand();
            } else if (replyType === '!trap') {
              const msg = sentence.find((w) => w.startsWith('=message=')) || sentence.join(' ');
              currentRes.push({ error: msg });
              sendNextCommand();
            }
          }
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
    ['/radius/incoming/print'],
    ['/radius/print', '=detail='],
    ['/ppp/active/print', '?service=pppoe']
  ]);

  console.log('=== RADIUS INCOMING ===');
  console.log(JSON.stringify(res[0], null, 2));

  console.log('=== RADIUS ENTRIES DETAIL ===');
  console.log(JSON.stringify(res[1], null, 2));

  console.log('=== ACTIVE PPPOE SUBSCRIBER ===');
  console.log(JSON.stringify(res[2], null, 2));
}

main().catch(console.error);
