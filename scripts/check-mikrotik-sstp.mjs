import net from 'node:net';
import crypto from 'node:crypto';

function encodeWord(word) {
  const buf = Buffer.from(word, 'utf8');
  let lenBuf;
  const len = buf.length;
  if (len < 0x80) {
    lenBuf = Buffer.from([len]);
  } else if (len < 0x4000) {
    lenBuf = Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  } else if (len < 0x200000) {
    lenBuf = Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  } else {
    lenBuf = Buffer.from([0xf0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  }
  return Buffer.concat([lenBuf, buf]);
}

function sendSentence(socket, words) {
  const bufs = words.map(encodeWord);
  bufs.push(Buffer.from([0x00]));
  socket.write(Buffer.concat(bufs));
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
  const password = getDecryptedPassword();
  const username = 'dipak';
  const host = '103.170.1.22';
  const port = 8728;

  console.log(`Connecting to physical MikroTik RouterOS Binary API at ${host}:${port}...`);

  const socket = net.createConnection({ host, port });
  let receiveBuffer = Buffer.alloc(0);
  let state = 'LOGIN_STEP_1';

  socket.on('data', (chunk) => {
    receiveBuffer = Buffer.concat([receiveBuffer, chunk]);

    while (true) {
      let offset = 0;
      const words = [];
      let completeSentence = false;

      while (offset < receiveBuffer.length) {
        const firstByte = receiveBuffer[offset];
        if (firstByte === 0) {
          receiveBuffer = receiveBuffer.subarray(offset + 1);
          completeSentence = true;
          break;
        }

        let wordLen = 0;
        let lenBytes = 0;
        if ((firstByte & 0x80) === 0x00) {
          wordLen = firstByte;
          lenBytes = 1;
        } else if ((firstByte & 0xc0) === 0x80) {
          if (offset + 2 > receiveBuffer.length) break;
          wordLen = ((firstByte & 0x3f) << 8) | receiveBuffer[offset + 1];
          lenBytes = 2;
        } else {
          break;
        }

        if (offset + lenBytes + wordLen > receiveBuffer.length) break;
        const word = receiveBuffer.subarray(offset + lenBytes, offset + lenBytes + wordLen).toString('utf8');
        words.push(word);
        offset += lenBytes + wordLen;
      }

      if (!completeSentence) break;

      handleSentence(words);
    }
  });

  function handleSentence(words) {
    const type = words[0];
    const attrs = {};
    for (const w of words.slice(1)) {
      if (w.startsWith('=')) {
        const idx = w.indexOf('=', 1);
        if (idx !== -1) {
          attrs[w.substring(1, idx)] = w.substring(idx + 1);
        } else {
          attrs[w.substring(1)] = '';
        }
      }
    }

    if (state === 'LOGIN_STEP_1') {
      if (type === '!done') {
        const challenge = attrs['ret'];
        if (challenge) {
          // MD5 challenge response
          const chalBuf = Buffer.from(challenge, 'hex');
          const passBuf = Buffer.from(password, 'utf8');
          const md5 = crypto.createHash('md5');
          md5.update(Buffer.concat([Buffer.from([0x00]), passBuf, chalBuf]));
          const response = '00' + md5.digest('hex');

          state = 'LOGIN_STEP_2';
          sendSentence(socket, ['/login', `=name=${username}`, `=response=${response}`]);
        } else {
          // Direct login (ROS 6.43+)
          state = 'LOGGED_IN';
          onLoggedIn();
        }
      } else if (type === '!trap') {
        console.error('Login Step 1 failed:', attrs);
        socket.end();
      }
    } else if (state === 'LOGIN_STEP_2') {
      if (type === '!done') {
        state = 'LOGGED_IN';
        onLoggedIn();
      } else if (type === '!trap') {
        console.error('Login failed (bad password or username):', attrs);
        socket.end();
      }
    } else if (state === 'QUERY_SSTP') {
      if (type === '!re') {
        console.log('SSTP Client Interface:', attrs);
      } else if (type === '!done') {
        state = 'SYSTEM_RESOURCE';
        sendSentence(socket, ['/system/resource/print']);
      }
    } else if (state === 'SYSTEM_RESOURCE') {
      if (type === '!re') {
        console.log('System Resource:', {
          board: attrs['board-name'],
          version: attrs['version'],
          uptime: attrs['uptime'],
          cpuLoad: attrs['cpu-load']
        });
      } else if (type === '!done') {
        state = 'SYSTEM_IDENTITY';
        sendSentence(socket, ['/system/identity/print']);
      }
    } else if (state === 'SYSTEM_IDENTITY') {
      if (type === '!re') {
        console.log('System Identity:', attrs['name']);
      } else if (type === '!done') {
        console.log('--- Queries completed successfully ---');
        socket.end();
      }
    }
  }

  function onLoggedIn() {
    console.log('Authenticated to MikroTik RouterOS Binary API!');
    state = 'QUERY_SSTP';
    sendSentence(socket, ['/interface/sstp-client/print']);
  }

  socket.on('connect', () => {
    console.log('Socket connected. Initiating RouterOS login handshake...');
    sendSentence(socket, ['/login', `=name=${username}`, `=password=${password}`]);
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
  });
}

main().catch(console.error);
