import dgram from 'node:dgram';
import crypto from 'node:crypto';

/**
 * RFC 3576 / RFC 5176 RADIUS Dynamic Authorization Codes
 */
export const RADIUS_COA_CODE = {
  DISCONNECT_REQUEST: 40,
  DISCONNECT_ACK: 41,
  DISCONNECT_NAK: 42,
  COA_REQUEST: 43,
  COA_ACK: 44,
  COA_NAK: 45,
} as const;

/**
 * Standard RADIUS Attribute Types
 */
export const RADIUS_ATTR_TYPE = {
  USER_NAME: 1,
  NAS_IP_ADDRESS: 4,
  NAS_PORT: 5,
  SERVICE_TYPE: 6,
  FRAMED_PROTOCOL: 7,
  FRAMED_IP_ADDRESS: 8,
  VENDOR_SPECIFIC: 26,
  ACCT_SESSION_ID: 44,
  EVENT_TIMESTAMP: 55,
  MESSAGE_AUTHENTICATOR: 80,
  ERROR_CAUSE: 101,
} as const;

/**
 * MikroTik RouterOS Vendor-Specific Attribute (VSA) ID & Subtypes
 */
export const MIKROTIK_VENDOR_ID = 14988;
export const MIKROTIK_VSA = {
  GROUP: 7,
  RATE_LIMIT: 8,
  ADDRESS_LIST: 19,
} as const;

/**
 * Supported Operational Use Cases
 */
export enum CoaAction {
  PLAN_UPGRADE = 'PLAN_UPGRADE',
  PLAN_DOWNGRADE = 'PLAN_DOWNGRADE',
  SUSPEND = 'SUSPEND',
  REACTIVATE = 'REACTIVATE',
}

export enum CoaRequestType {
  COA = 'COA',
  DISCONNECT = 'DISCONNECT',
}

/**
 * Payload for BullMQ RADIUS CoA Job
 */
export interface RadiusCoaJobData {
  organizationId: string;
  customerId: string;
  subscriptionId?: string;
  username: string;
  action: CoaAction | string;
  requestType: CoaRequestType | 'COA' | 'DISCONNECT';
  rateLimit?: string; // e.g. "50M/100M"
  framedIp?: string;
  sessionId?: string;
  nasIp?: string;
  nasPort?: number; // Default: 3799
  secret?: string;
  reason?: string;
  adminUserId?: string;
  metadata?: Record<string, any>;
}

export interface CoaResult {
  success: boolean;
  code: number;
  codeName: 'COA_ACK' | 'COA_NAK' | 'DISCONNECT_ACK' | 'DISCONNECT_NAK' | 'TIMEOUT' | 'ERROR';
  errorCause?: string;
  latencyMs: number;
  attemptsMade: number;
  nasIp: string;
  nasPort: number;
  username: string;
}

export interface RadiusAttributeTLV {
  type: number;
  value: Buffer | string | number;
}

/**
 * Attribute Encoding Helpers
 */
export function encodeRadiusAttribute(type: number, value: Buffer | string | number): Buffer {
  let valBuf: Buffer;
  if (Buffer.isBuffer(value)) {
    valBuf = value;
  } else if (typeof value === 'string') {
    valBuf = Buffer.from(value, 'utf8');
  } else if (typeof value === 'number') {
    valBuf = Buffer.alloc(4);
    valBuf.writeUInt32BE(value, 0);
  } else {
    throw new Error(`Unsupported attribute value type: ${typeof value}`);
  }

  const length = 2 + valBuf.length;
  const attrBuf = Buffer.alloc(length);
  attrBuf[0] = type;
  attrBuf[1] = length;
  valBuf.copy(attrBuf, 2);
  return attrBuf;
}

export function encodeIpAttribute(type: number, ipStr: string): Buffer {
  const parts = ipStr.split('.').map(Number);
  const valBuf = Buffer.from(parts);
  const length = 2 + valBuf.length;
  const attrBuf = Buffer.alloc(length);
  attrBuf[0] = type;
  attrBuf[1] = length;
  valBuf.copy(attrBuf, 2);
  return attrBuf;
}

export function encodeMikrotikVsa(subType: number, value: string): Buffer {
  const valBuf = Buffer.from(value, 'utf8');
  const vsaLength = 6 + 2 + valBuf.length; // 2(Type/Len) + 4(VendorId) + 2(Subtype/Len) + valLen
  const vsaBuf = Buffer.alloc(vsaLength);

  // Outer Type 26 (Vendor-Specific)
  vsaBuf[0] = RADIUS_ATTR_TYPE.VENDOR_SPECIFIC;
  vsaBuf[1] = vsaLength;
  vsaBuf.writeUInt32BE(MIKROTIK_VENDOR_ID, 2);

  // Inner Sub-type (e.g. 8 = Rate-Limit)
  vsaBuf[6] = subType;
  vsaBuf[7] = 2 + valBuf.length;
  valBuf.copy(vsaBuf, 8);

  return vsaBuf;
}

/**
 * Build RFC 3576 Packet with Message-Authenticator (HMAC-MD5)
 */
export function buildCoaOrDisconnectPacket(options: {
  code: number;
  identifier: number;
  secret: string;
  username: string;
  rateLimit?: string;
  framedIp?: string;
  sessionId?: string;
  nasIp?: string;
  authenticator?: Buffer;
}): { packet: Buffer; authenticator: Buffer } {
  const authenticator = options.authenticator || crypto.randomBytes(16);
  const rawAttrs: Buffer[] = [
    encodeRadiusAttribute(RADIUS_ATTR_TYPE.USER_NAME, options.username),
  ];

  if (options.framedIp) {
    rawAttrs.push(encodeIpAttribute(RADIUS_ATTR_TYPE.FRAMED_IP_ADDRESS, options.framedIp));
  }
  if (options.sessionId) {
    rawAttrs.push(encodeRadiusAttribute(RADIUS_ATTR_TYPE.ACCT_SESSION_ID, options.sessionId));
  }
  if (options.nasIp) {
    rawAttrs.push(encodeIpAttribute(RADIUS_ATTR_TYPE.NAS_IP_ADDRESS, options.nasIp));
  }
  if (options.rateLimit) {
    rawAttrs.push(encodeMikrotikVsa(MIKROTIK_VSA.RATE_LIMIT, options.rateLimit));
  }

  // Event-Timestamp (RFC 3576 Section 3)
  const timestampBuf = Buffer.alloc(4);
  timestampBuf.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
  rawAttrs.push(encodeRadiusAttribute(RADIUS_ATTR_TYPE.EVENT_TIMESTAMP, timestampBuf));

  // Placeholder for Message-Authenticator (Type 80, length 18: 16-byte zero hash)
  const msgAuthPlaceholder = Buffer.alloc(18);
  msgAuthPlaceholder[0] = RADIUS_ATTR_TYPE.MESSAGE_AUTHENTICATOR;
  msgAuthPlaceholder[1] = 18;
  rawAttrs.push(msgAuthPlaceholder);

  const attrsConcat = Buffer.concat(rawAttrs);
  const totalLength = 20 + attrsConcat.length;

  const packet = Buffer.alloc(totalLength);
  packet[0] = options.code;
  packet[1] = options.identifier;
  packet.writeUInt16BE(totalLength, 2);
  authenticator.copy(packet, 4);
  attrsConcat.copy(packet, 20);

  // Calculate HMAC-MD5 Message-Authenticator over the full packet with shared secret
  const hmac = crypto.createHmac('md5', Buffer.from(options.secret, 'utf8'));
  hmac.update(packet);
  const messageAuthDigest = hmac.digest();

  // Find Type 80 in packet and inject the digest
  const msgAuthOffset = totalLength - 16;
  messageAuthDigest.copy(packet, msgAuthOffset);

  return { packet, authenticator };
}

/**
 * Parses response packet and verifies Response-Authenticator
 */
export function parseRadiusResponse(
  buffer: Buffer,
  secret: string,
  requestAuthenticator: Buffer,
): {
  code: number;
  identifier: number;
  length: number;
  authenticatorValid: boolean;
  attributes: Record<string, string | number>;
} {
  if (buffer.length < 20) {
    throw new Error('Packet smaller than 20-byte RADIUS header');
  }

  const code = buffer[0];
  const identifier = buffer[1];
  const length = buffer.readUInt16BE(2);
  const responseAuth = buffer.subarray(4, 20);
  const attrsBuf = buffer.subarray(20, length);

  // Verification: Response-Auth = MD5(Code + Identifier + Length + RequestAuth + Attrs + Secret)
  const verifyHash = crypto.createHash('md5');
  verifyHash.update(Buffer.from([code, identifier]));
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(length, 0);
  verifyHash.update(lenBuf);
  verifyHash.update(requestAuthenticator);
  verifyHash.update(attrsBuf);
  verifyHash.update(Buffer.from(secret, 'utf8'));
  const calculatedAuth = verifyHash.digest();

  const authenticatorValid = crypto.timingSafeEqual(responseAuth, calculatedAuth);

  // Parse attributes
  const attributes: Record<string, string | number> = {};
  let offset = 0;
  while (offset + 2 <= attrsBuf.length) {
    const attrType = attrsBuf[offset];
    const attrLen = attrsBuf[offset + 1];
    if (attrLen < 2 || offset + attrLen > attrsBuf.length) break;

    const val = attrsBuf.subarray(offset + 2, offset + attrLen);
    if (attrType === RADIUS_ATTR_TYPE.ERROR_CAUSE && val.length === 4) {
      attributes['Error-Cause'] = val.readUInt32BE(0);
    } else if (attrType === RADIUS_ATTR_TYPE.VENDOR_SPECIFIC && val.length >= 6) {
      const vendorId = val.readUInt32BE(0);
      if (vendorId === MIKROTIK_VENDOR_ID) {
        const subType = val[4];
        const subLen = val[5];
        if (subType === MIKROTIK_VSA.RATE_LIMIT) {
          attributes['Mikrotik-Rate-Limit'] = val.subarray(6, 6 + (subLen - 2)).toString('utf8');
        }
      }
    }
    offset += attrLen;
  }

  return {
    code,
    identifier,
    length,
    authenticatorValid,
    attributes,
  };
}

/**
 * RADIUS Change of Authorization (CoA) & Disconnect (PoD) Client
 */
export class RadiusCoaClient {
  /**
   * Transmits a UDP packet with timeout and retries
   */
  private static async sendUdpWithRetry(options: {
    nasIp: string;
    nasPort: number;
    packet: Buffer;
    secret: string;
    authenticator: Buffer;
    timeoutMs: number;
    maxRetries: number;
  }): Promise<{ code: number; attributes: Record<string, string | number>; latencyMs: number; attemptsMade: number }> {
    const { nasIp, nasPort, packet, secret, authenticator, timeoutMs, maxRetries } = options;
    let attempt = 0;

    while (attempt <= maxRetries) {
      attempt++;
      const startTime = Date.now();
      try {
        const res = await new Promise<{ code: number; attributes: Record<string, string | number>; latencyMs: number }>(
          (resolve, reject) => {
            const socket = dgram.createSocket('udp4');
            let timer: NodeJS.Timeout;

            socket.on('error', (err) => {
              clearTimeout(timer);
              socket.close();
              reject(err);
            });

            socket.on('message', (msg) => {
              clearTimeout(timer);
              socket.close();
              try {
                const parsed = parseRadiusResponse(msg, secret, authenticator);
                resolve({
                  code: parsed.code,
                  attributes: parsed.attributes,
                  latencyMs: Date.now() - startTime,
                });
              } catch (parseErr) {
                reject(parseErr);
              }
            });

            timer = setTimeout(() => {
              socket.close();
              const timeoutErr = new Error(`RADIUS CoA/PoD UDP timeout after ${timeoutMs}ms on ${nasIp}:${nasPort}`);
              (timeoutErr as any).code = 'ETIMEDOUT';
              reject(timeoutErr);
            }, timeoutMs);

            socket.send(packet, nasPort, nasIp, (err) => {
              if (err) {
                clearTimeout(timer);
                socket.close();
                reject(err);
              }
            });
          },
        );

        return { ...res, attemptsMade: attempt };
      } catch (err: any) {
        if (attempt > maxRetries) {
          throw err;
        }
        // Exponential backoff with jitter before next attempt
        const delay = 150 * Math.pow(2, attempt - 1) + Math.random() * 50;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw new Error('Exhausted maximum retry attempts');
  }

  /**
   * Sends RFC 3576 Disconnect-Request (Code 40 / Packet of Disconnect)
   */
  static async sendDisconnectRequest(params: {
    nasIp: string;
    nasPort?: number;
    secret: string;
    username: string;
    framedIp?: string;
    sessionId?: string;
    timeoutMs?: number;
    maxRetries?: number;
  }): Promise<CoaResult> {
    const nasPort = params.nasPort || 3799;
    const timeoutMs = params.timeoutMs || 2500;
    const maxRetries = params.maxRetries ?? 2;
    const identifier = crypto.randomInt(0, 255);

    const { packet, authenticator } = buildCoaOrDisconnectPacket({
      code: RADIUS_COA_CODE.DISCONNECT_REQUEST,
      identifier,
      secret: params.secret,
      username: params.username,
      framedIp: params.framedIp,
      sessionId: params.sessionId,
      nasIp: params.nasIp,
    });

    try {
      const res = await this.sendUdpWithRetry({
        nasIp: params.nasIp,
        nasPort,
        packet,
        secret: params.secret,
        authenticator,
        timeoutMs,
        maxRetries,
      });

      const isAck = res.code === RADIUS_COA_CODE.DISCONNECT_ACK;
      return {
        success: isAck,
        code: res.code,
        codeName: isAck ? 'DISCONNECT_ACK' : 'DISCONNECT_NAK',
        errorCause: res.attributes['Error-Cause'] ? String(res.attributes['Error-Cause']) : undefined,
        latencyMs: res.latencyMs,
        attemptsMade: res.attemptsMade,
        nasIp: params.nasIp,
        nasPort,
        username: params.username,
      };
    } catch (err: any) {
      return {
        success: false,
        code: 0,
        codeName: err.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'ERROR',
        errorCause: err.message,
        latencyMs: timeoutMs,
        attemptsMade: maxRetries + 1,
        nasIp: params.nasIp,
        nasPort,
        username: params.username,
      };
    }
  }

  /**
   * Sends RFC 3576 CoA-Request (Code 43 / Change of Authorization)
   */
  static async sendCoaRequest(params: {
    nasIp: string;
    nasPort?: number;
    secret: string;
    username: string;
    rateLimit: string;
    framedIp?: string;
    sessionId?: string;
    timeoutMs?: number;
    maxRetries?: number;
  }): Promise<CoaResult> {
    const nasPort = params.nasPort || 3799;
    const timeoutMs = params.timeoutMs || 2500;
    const maxRetries = params.maxRetries ?? 2;
    const identifier = crypto.randomInt(0, 255);

    const { packet, authenticator } = buildCoaOrDisconnectPacket({
      code: RADIUS_COA_CODE.COA_REQUEST,
      identifier,
      secret: params.secret,
      username: params.username,
      rateLimit: params.rateLimit,
      framedIp: params.framedIp,
      sessionId: params.sessionId,
      nasIp: params.nasIp,
    });

    try {
      const res = await this.sendUdpWithRetry({
        nasIp: params.nasIp,
        nasPort,
        packet,
        secret: params.secret,
        authenticator,
        timeoutMs,
        maxRetries,
      });

      const isAck = res.code === RADIUS_COA_CODE.COA_ACK;
      return {
        success: isAck,
        code: res.code,
        codeName: isAck ? 'COA_ACK' : 'COA_NAK',
        errorCause: res.attributes['Error-Cause'] ? String(res.attributes['Error-Cause']) : undefined,
        latencyMs: res.latencyMs,
        attemptsMade: res.attemptsMade,
        nasIp: params.nasIp,
        nasPort,
        username: params.username,
      };
    } catch (err: any) {
      return {
        success: false,
        code: 0,
        codeName: err.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'ERROR',
        errorCause: err.message,
        latencyMs: timeoutMs,
        attemptsMade: maxRetries + 1,
        nasIp: params.nasIp,
        nasPort,
        username: params.username,
      };
    }
  }
}

/**
 * MockNAS: Standalone UDP test double simulating a MikroTik RouterOS BNG / NAS
 */
export class MockNAS {
  private socket: dgram.Socket | null = null;
  public port = 0;
  public secret = 'testing123';
  public behavior: 'ACK' | 'NAK' | 'TIMEOUT' = 'ACK';
  public receivedPackets: Array<{
    code: number;
    identifier: number;
    username?: string;
    rateLimit?: string;
    sessionId?: string;
    timestamp: number;
  }> = [];

  constructor(options: { secret?: string; behavior?: 'ACK' | 'NAK' | 'TIMEOUT' } = {}) {
    if (options.secret) this.secret = options.secret;
    if (options.behavior) this.behavior = options.behavior;
  }

  async start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');

      this.socket.on('error', (err) => {
        reject(err);
      });

      this.socket.on('message', (msg, rinfo) => {
        const code = msg[0];
        const identifier = msg[1];
        const length = msg.readUInt16BE(2);
        const reqAuth = msg.subarray(4, 20);
        const attrsBuf = msg.subarray(20, length);

        // Decode attributes
        let username: string | undefined;
        let rateLimit: string | undefined;
        let sessionId: string | undefined;

        let offset = 0;
        while (offset + 2 <= attrsBuf.length) {
          const t = attrsBuf[offset];
          const l = attrsBuf[offset + 1];
          if (l < 2 || offset + l > attrsBuf.length) break;

          const val = attrsBuf.subarray(offset + 2, offset + l);
          if (t === RADIUS_ATTR_TYPE.USER_NAME) {
            username = val.toString('utf8');
          } else if (t === RADIUS_ATTR_TYPE.ACCT_SESSION_ID) {
            sessionId = val.toString('utf8');
          } else if (t === RADIUS_ATTR_TYPE.VENDOR_SPECIFIC && val.length >= 6) {
            const vendorId = val.readUInt32BE(0);
            if (vendorId === MIKROTIK_VENDOR_ID && val[4] === MIKROTIK_VSA.RATE_LIMIT) {
              rateLimit = val.subarray(6, 6 + (val[5] - 2)).toString('utf8');
            }
          }
          offset += l;
        }

        this.receivedPackets.push({
          code,
          identifier,
          username,
          rateLimit,
          sessionId,
          timestamp: Date.now(),
        });

        // If behavior is TIMEOUT, simulate dropped packet by not responding
        if (this.behavior === 'TIMEOUT') {
          return;
        }

        // Determine response code
        let respCode: number;
        if (code === RADIUS_COA_CODE.DISCONNECT_REQUEST) {
          respCode = this.behavior === 'NAK' ? RADIUS_COA_CODE.DISCONNECT_NAK : RADIUS_COA_CODE.DISCONNECT_ACK;
        } else {
          respCode = this.behavior === 'NAK' ? RADIUS_COA_CODE.COA_NAK : RADIUS_COA_CODE.COA_ACK;
        }

        // Build Response Packet
        const respLen = 20; // 20-byte header with no extra attributes
        const respBuf = Buffer.alloc(respLen);
        respBuf[0] = respCode;
        respBuf[1] = identifier;
        respBuf.writeUInt16BE(respLen, 2);

        // Response Authenticator = MD5(Code + Identifier + Length + RequestAuth + Attrs + Secret)
        const hash = crypto.createHash('md5');
        hash.update(Buffer.from([respCode, identifier]));
        const lenBuf = Buffer.alloc(2);
        lenBuf.writeUInt16BE(respLen, 0);
        hash.update(lenBuf);
        hash.update(reqAuth);
        hash.update(Buffer.from(this.secret, 'utf8'));
        const responseAuth = hash.digest();
        responseAuth.copy(respBuf, 4);

        this.socket?.send(respBuf, rinfo.port, rinfo.address);
      });

      this.socket.bind(port, '127.0.0.1', () => {
        const addr = this.socket!.address();
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket) {
        this.socket.close(() => {
          this.socket = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  clearHistory() {
    this.receivedPackets = [];
  }
}
