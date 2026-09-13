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
        let offset = 0;
        const words = [];

        while (offset < receiveBuffer.length) {
          const firstByte = receiveBuffer[offset];
          if (firstByte === 0) {
            receiveBuffer = receiveBuffer.subarray(offset + 1);
            return words;
          }

          let wordLength = 0;
          let lengthBytesCount = 0;

          if ((firstByte & 0x80) === 0x00) {
            wordLength = firstByte;
            lengthBytesCount = 1;
          } else if ((firstByte & 0xc0) === 0x80) {
            if (offset + 2 > receiveBuffer.length) return null;
            wordLength = ((firstByte & 0x3f) << 8) | receiveBuffer[offset + 1];
            lengthBytesCount = 2;
          } else if ((firstByte & 0xe0) === 0xc0) {
            if (offset + 3 > receiveBuffer.length) return null;
            wordLength = ((firstByte & 0x1f) << 16) | (receiveBuffer[offset + 1] << 8) | receiveBuffer[offset + 2];
            lengthBytesCount = 3;
          } else {
            return null;
          }

          const wordStart = offset + lengthBytesCount;
          const wordEnd = wordStart + wordLength;
          if (wordEnd > receiveBuffer.length) return null;

          const word = receiveBuffer.subarray(wordStart, wordEnd).toString('utf8');
          words.push(word);
          offset = wordEnd;
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
        if (words.length === 0) return;
        const type = words[0];
        const attributes = {};

        for (let i = 1; i < words.length; i++) {
          const w = words[i];
          if (w.startsWith('=')) {
            const eqIdx = w.indexOf('=', 1);
            if (eqIdx !== -1) {
              attributes[w.substring(1, eqIdx)] = w.substring(eqIdx + 1);
            } else {
              attributes[w.substring(1)] = '';
            }
          }
        }

        const sentence = { type, attributes };

        if (!isAuthenticated) {
          if (type === '!trap') {
            finishError(new Error('RouterOS authentication failed: ' + (attributes['message'] || 'unknown')));
            return;
          }

          if (type === '!done') {
            if (attributes['ret']) {
              const challenge = attributes['ret'];
              const md5Hash = crypto
                .createHash('md5')
                .update(Buffer.concat([Buffer.from([0x00]), Buffer.from(config.password, 'utf8'), Buffer.from(challenge, 'hex')]))
                .digest('hex');

              socket.write(this.encodeSentence(['/login', `=name=${config.username}`, `=response=00${md5Hash}`]));
              return;
            }

            isAuthenticated = true;
            sendNextCommand();
            return;
          }
          return;
        }

        if (currentCommandIndex >= 0 && currentCommandIndex < allCommandResults.length) {
          if (type === '!re' || type === '!done' || type === '!trap') {
            allCommandResults[currentCommandIndex].push(sentence);
          }
          if (type === '!done') {
            sendNextCommand();
          }
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
    ['/system/identity/print'],
    ['/system/resource/print'],
    ['/interface/sstp-client/print']
  ]);

  console.log('--- SYSTEM IDENTITY ---');
  console.log(res[0]);

  console.log('--- SYSTEM RESOURCE ---');
  console.log(res[1]);

  console.log('--- SSTP CLIENT INTERFACES ---');
  console.log(res[2]);
}

main().catch(console.error);
