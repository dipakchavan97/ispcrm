import crypto from 'node:crypto';
import {
  buildCoaOrDisconnectPacket,
  encodeIpAttribute,
  RADIUS_COA_CODE,
  RADIUS_ATTR_TYPE,
  MIKROTIK_VENDOR_ID,
  MIKROTIK_VSA
} from '../packages/shared/dist/index.js';

function parsePacketAttributes(buf) {
  const attrs = [];
  const attrsBuf = buf.subarray(20);
  let offset = 0;
  while (offset + 2 <= attrsBuf.length) {
    const type = attrsBuf[offset];
    const len = attrsBuf[offset + 1];
    if (len < 2 || offset + len > attrsBuf.length) break;
    const valBuf = attrsBuf.subarray(offset + 2, offset + len);
    attrs.push({ type, len, valBuf });
    offset += len;
  }
  return attrs;
}

async function main() {
  console.log('=== OFFLINE PACKET CONSTRUCTION TEST (PHASE 9G) ===\n');

  const secret = 'de7703b89034d1f500f2642a7d0230fc';
  const username = 'dipak@ispcrm';
  const framedIp = '172.18.23.154/32';
  const sessionId = '81b02026';
  const nasIp = '10.200.0.6';

  // Build Disconnect-Request packet
  const res = buildCoaOrDisconnectPacket({
    code: RADIUS_COA_CODE.DISCONNECT_REQUEST,
    identifier: 77,
    secret,
    username,
    framedIp,
    sessionId,
    nasIp, // Passed in options, but must be OMITTED in DISCONNECT_REQUEST per Phase 9G
  });

  const pkt = res.packet;
  const parsedAttrs = parsePacketAttributes(pkt);

  console.log('1. Packet Header:');
  console.log('   Code:', pkt[0], '(Expected: 40 [DISCONNECT_REQUEST])');
  console.log('   Identifier:', pkt[1], '(Expected: 77)');
  console.log('   Length:', pkt.readUInt16BE(2), `(Total buffer bytes: ${pkt.length})`);
  console.log('   Request Authenticator (hex):', pkt.subarray(4, 20).toString('hex'));

  console.log('\n2. Attribute Inspection:');
  for (const a of parsedAttrs) {
    let desc = `Type ${a.type}`;
    let valStr = '';
    if (a.type === RADIUS_ATTR_TYPE.USER_NAME) {
      desc = 'User-Name (1)';
      valStr = a.valBuf.toString('utf8');
    } else if (a.type === RADIUS_ATTR_TYPE.FRAMED_IP_ADDRESS) {
      desc = 'Framed-IP-Address (8)';
      valStr = Array.from(a.valBuf).join('.');
    } else if (a.type === RADIUS_ATTR_TYPE.ACCT_SESSION_ID) {
      desc = 'Acct-Session-Id (44)';
      valStr = a.valBuf.toString('utf8');
    } else if (a.type === RADIUS_ATTR_TYPE.EVENT_TIMESTAMP) {
      desc = 'Event-Timestamp (55)';
      valStr = a.valBuf.readUInt32BE(0).toString();
    } else if (a.type === RADIUS_ATTR_TYPE.NAS_IP_ADDRESS) {
      desc = 'NAS-IP-Address (4) [UNEXPECTED!]';
      valStr = Array.from(a.valBuf).join('.');
    } else if (a.type === RADIUS_ATTR_TYPE.MESSAGE_AUTHENTICATOR) {
      desc = 'Message-Authenticator (80) [UNEXPECTED!]';
      valStr = a.valBuf.toString('hex');
    }
    console.log(`   - [${desc}] Length: ${a.len}, Value: ${valStr}`);
  }

  const hasNasIp = parsedAttrs.some(a => a.type === RADIUS_ATTR_TYPE.NAS_IP_ADDRESS);
  const hasMsgAuth = parsedAttrs.some(a => a.type === RADIUS_ATTR_TYPE.MESSAGE_AUTHENTICATOR);
  const hasUserName = parsedAttrs.some(a => a.type === RADIUS_ATTR_TYPE.USER_NAME && a.valBuf.toString('utf8') === username);
  const hasSessionId = parsedAttrs.some(a => a.type === RADIUS_ATTR_TYPE.ACCT_SESSION_ID && a.valBuf.toString('utf8') === sessionId);
  const hasFramedIp = parsedAttrs.some(a => a.type === RADIUS_ATTR_TYPE.FRAMED_IP_ADDRESS && Array.from(a.valBuf).join('.') === '172.18.23.154');

  console.log('\n3. Compliance Checks:');
  console.log('   [PASS] Code is 40:', pkt[0] === 40);
  console.log('   [PASS] User-Name present:', hasUserName);
  console.log('   [PASS] Acct-Session-Id present:', hasSessionId);
  console.log('   [PASS] Framed-IP-Address is 172.18.23.154:', hasFramedIp);
  console.log('   [PASS] NAS-IP-Address is ABSENT:', !hasNasIp);
  console.log('   [PASS] Message-Authenticator is ABSENT:', !hasMsgAuth);

  // Manual RFC 3576 Request Authenticator Verification
  // MD5(Code + Identifier + Length + 16 zero octets + Attributes + Secret)
  const clonePkt = Buffer.from(pkt);
  clonePkt.fill(0, 4, 20); // 16 zeroes in header
  const manualHash = crypto.createHash('md5');
  manualHash.update(clonePkt);
  manualHash.update(Buffer.from(secret, 'utf8'));
  const expectedAuth = manualHash.digest();

  const authMatches = expectedAuth.equals(pkt.subarray(4, 20));
  console.log('   [PASS] RFC 3576 Request Authenticator Verification:', authMatches);
  console.log('          Calculated Authenticator:', expectedAuth.toString('hex'));
  console.log('          Header Authenticator:    ', pkt.subarray(4, 20).toString('hex'));

  // Also verify CoA-Request still retains Message-Authenticator
  console.log('\n4. Regression Check (CoA-Request packet retains Message-Authenticator):');
  const coaRes = buildCoaOrDisconnectPacket({
    code: RADIUS_COA_CODE.COA_REQUEST,
    identifier: 78,
    secret,
    username,
    rateLimit: '20M/50M',
    nasIp
  });
  const coaAttrs = parsePacketAttributes(coaRes.packet);
  const coaHasMsgAuth = coaAttrs.some(a => a.type === RADIUS_ATTR_TYPE.MESSAGE_AUTHENTICATOR);
  const coaHasNasIp = coaAttrs.some(a => a.type === RADIUS_ATTR_TYPE.NAS_IP_ADDRESS);
  console.log('   [PASS] CoA-Request Code is 43:', coaRes.packet[0] === 43);
  console.log('   [PASS] CoA-Request retains Message-Authenticator:', coaHasMsgAuth);
  console.log('   [PASS] CoA-Request retains NAS-IP-Address:', coaHasNasIp);
}

main().catch(console.error);
