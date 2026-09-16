import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as crypto from 'node:crypto';
import {
  MikrotikClient,
  RouterConnectionConfig,
  RouterIdentity,
  SystemResources,
  ActivePppSession,
  RouterInterface,
  InterfaceTraffic,
  TestConnectionResult,
  RouterCapabilities,
} from './mikrotik-client.interface';
import { sanitizeMessage } from '../../../common/utils/crypto.util';

export interface RosSentence {
  type: '!re' | '!done' | '!trap' | '!fatal' | string;
  attributes: Record<string, string>;
}

export interface CachedSession {
  key: string;
  socket: net.Socket;
  idleTimer: NodeJS.Timeout | null;
  commandQueue: Promise<any>;
  isClosed: boolean;
  receiveBuffer: any;
  onSentence: ((sentence: RosSentence) => void) | null;
  onError: ((err: Error) => void) | null;
}

@Injectable()
export class RouterOsBinaryClient implements MikrotikClient, OnModuleDestroy {
  private readonly logger = new Logger(RouterOsBinaryClient.name);

  /**
   * 15-second idle socket cache keyed strictly by `${organizationId}:${routerId}`.
   */
  private readonly sessionCache = new Map<string, CachedSession>();

  /**
   * Tracks in-flight connection promises to prevent concurrent duplicate socket creations for the same router.
   */
  private readonly connectingSessions = new Map<string, Promise<CachedSession>>();

  /**
   * Idle timeout in milliseconds before an unused socket is gracefully closed.
   */
  private readonly IDLE_TIMEOUT_MS = 15000;

  onModuleDestroy() {
    this.clearCache();
  }

  /**
   * Clear all cached sessions and destroy active sockets on shutdown.
   */
  public clearCache(): void {
    for (const [key, session] of this.sessionCache.entries()) {
      session.isClosed = true;
      if (session.idleTimer) {
        clearTimeout(session.idleTimer);
        session.idleTimer = null;
      }
      try {
        session.socket.destroy();
      } catch {}
    }
    this.sessionCache.clear();
    this.connectingSessions.clear();
  }

  /**
   * Number of cached sessions currently held.
   */
  public getCachedSessionCount(): number {
    return this.sessionCache.size;
  }

  /**
   * Check if an active non-closed session exists for a specific router.
   */
  public hasCachedSession(organizationId: string, routerId: string): boolean {
    const key = `${organizationId}:${routerId}`;
    const session = this.sessionCache.get(key);
    return Boolean(session && !session.isClosed && !session.socket.destroyed);
  }

  /**
   * Access a cached session directly (e.g. for testing).
   */
  public getCachedSession(organizationId: string, routerId: string): CachedSession | undefined {
    return this.sessionCache.get(`${organizationId}:${routerId}`);
  }

  /**
   * Encodes a single word using RouterOS variable-length prefix.
   */
  private encodeWord(word: string): Buffer {
    const buf = Buffer.from(word, 'utf8');
    let lenBuf: Buffer;
    const len = buf.length;

    if (len < 0x80) {
      lenBuf = Buffer.from([len]);
    } else if (len < 0x4000) {
      lenBuf = Buffer.from([(len >> 8) | 0x80, len & 0xff]);
    } else if (len < 0x200000) {
      lenBuf = Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
    } else if (len < 0x10000000) {
      lenBuf = Buffer.from([
        (len >> 24) | 0xe0,
        (len >> 16) & 0xff,
        (len >> 8) & 0xff,
        len & 0xff,
      ]);
    } else {
      lenBuf = Buffer.from([
        0xf0,
        (len >> 24) & 0xff,
        (len >> 16) & 0xff,
        (len >> 8) & 0xff,
        len & 0xff,
      ]);
    }

    return Buffer.concat([lenBuf, buf]);
  }

  /**
   * Encodes an array of words as a RouterOS API sentence (terminated with 0x00).
   */
  private encodeSentence(words: string[]): Buffer {
    const buffers: Buffer[] = words.map((w) => this.encodeWord(w));
    buffers.push(Buffer.from([0x00]));
    return Buffer.concat(buffers);
  }

  /**
   * Extracts one sentence's words and remaining buffer from an incoming Buffer.
   * Returns null if sentence is incomplete.
   */
  private extractSentenceWords(buf: Buffer): { words: string[]; remaining: Buffer } | null {
    let offset = 0;
    const words: string[] = [];

    while (offset < buf.length) {
      const firstByte = buf[offset];

      // 0x00 is end of sentence
      if (firstByte === 0) {
        const remaining = Buffer.from(buf.subarray(offset + 1));
        return { words, remaining };
      }

      let wordLength = 0;
      let lengthBytesCount = 0;

      if ((firstByte & 0x80) === 0x00) {
        wordLength = firstByte;
        lengthBytesCount = 1;
      } else if ((firstByte & 0xc0) === 0x80) {
        if (offset + 2 > buf.length) return null;
        wordLength = ((firstByte & 0x3f) << 8) | buf[offset + 1];
        lengthBytesCount = 2;
      } else if ((firstByte & 0xe0) === 0xc0) {
        if (offset + 3 > buf.length) return null;
        wordLength =
          ((firstByte & 0x1f) << 16) |
          (buf[offset + 1] << 8) |
          buf[offset + 2];
        lengthBytesCount = 3;
      } else if ((firstByte & 0xf0) === 0xe0) {
        if (offset + 4 > buf.length) return null;
        wordLength =
          ((firstByte & 0x0f) << 24) |
          (buf[offset + 1] << 16) |
          (buf[offset + 2] << 8) |
          buf[offset + 3];
        lengthBytesCount = 4;
      } else if ((firstByte & 0xf8) === 0xf0) {
        if (offset + 5 > buf.length) return null;
        wordLength =
          (buf[offset + 1] << 24) |
          (buf[offset + 2] << 16) |
          (buf[offset + 3] << 8) |
          buf[offset + 4];
        lengthBytesCount = 5;
      } else {
        throw new Error('Malformed word length received from RouterOS binary API');
      }

      const wordStart = offset + lengthBytesCount;
      const wordEnd = wordStart + wordLength;

      if (wordEnd > buf.length) {
        return null; // Incomplete word, wait for more data
      }

      const word = buf.subarray(wordStart, wordEnd).toString('utf8');
      words.push(word);
      offset = wordEnd;
    }

    return null; // Incomplete sentence
  }

  /**
   * Converts parsed words into a structured RosSentence.
   */
  private parseSentenceFromWords(words: string[]): RosSentence | null {
    if (words.length === 0) return null;
    const type = words[0];
    const attributes: Record<string, string> = {};

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

    return { type, attributes };
  }

  /**
   * Safe removal of a session from cache.
   * MANDATORY RACE CONDITION PROTECTION:
   * A stale session must never remove a newer replacement session from the cache.
   */
  private removeSession(key: string, session: CachedSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    if (this.sessionCache.get(key) === session) {
      this.sessionCache.delete(key);
    }
  }

  /**
   * Idle timeout handler: ends socket cleanly and removes from cache.
   */
  private closeIdleSession(session: CachedSession): void {
    if (session.isClosed) return;
    session.isClosed = true;

    this.removeSession(session.key, session);

    try {
      session.socket.end();
    } catch {}
  }

  /**
   * Handles socket or command failure on a cached session:
   * 1. Marks closed.
   * 2. Clears idle timer.
   * 3. Removes session from cache (safe race check).
   * 4. Destroys socket.
   * 5. Rejects active command handler if waiting.
   */
  private handleSessionError(session: CachedSession, err: Error): void {
    if (session.isClosed) return;
    session.isClosed = true;

    this.removeSession(session.key, session);

    try {
      session.socket.destroy();
    } catch {}

    if (session.onError) {
      const handler = session.onError;
      session.onError = null;
      session.onSentence = null;
      handler(err);
    }
  }

  /**
   * Starts or resets the 15-second idle timer on an active session.
   */
  private resetIdleTimer(session: CachedSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }

    if (session.isClosed) return;

    session.idleTimer = setTimeout(() => {
      this.closeIdleSession(session);
    }, this.IDLE_TIMEOUT_MS);

    if (typeof session.idleTimer.unref === 'function') {
      session.idleTimer.unref();
    }
  }

  /**
   * Attaches persistent data, error, and close listeners to an authenticated socket.
   */
  private attachSessionListeners(session: CachedSession): void {
    session.socket.on('data', (chunk: Buffer) => {
      session.receiveBuffer = Buffer.concat([session.receiveBuffer, chunk]);
      try {
        while (true) {
          const parsed = this.extractSentenceWords(session.receiveBuffer);
          if (!parsed) break;
          session.receiveBuffer = parsed.remaining;
          const sentence = this.parseSentenceFromWords(parsed.words);
          if (sentence) {
            if (sentence.type === '!fatal') {
              const fatalMsg = sentence.attributes['message'] || 'Fatal error from RouterOS';
              const fatalErr = new Error(`RouterOS fatal: ${fatalMsg}`);
              this.handleSessionError(session, fatalErr);
              return;
            }
            session.onSentence?.(sentence);
          }
        }
      } catch (err: any) {
        this.handleSessionError(session, err);
      }
    });

    session.socket.on('error', (err: Error) => {
      this.handleSessionError(session, err);
    });

    session.socket.on('close', () => {
      if (!session.isClosed) {
        const closeErr = new Error('RouterOS binary socket closed unexpectedly');
        this.handleSessionError(session, closeErr);
      }
    });
  }

  /**
   * Connects and authenticates a fresh socket with RouterOS.
   * SECURITY: Plain password exists only transiently during handshake and is never stored on session.
   */
  private connectAndAuthenticate(
    config: RouterConnectionConfig,
    key: string,
    cacheSession: boolean = true,
  ): Promise<CachedSession> {
    const timeoutMs = config.timeoutMs || 4000;
    const port = config.port || 8728;
    const useSsl = Boolean(config.useSsl);

    return new Promise<CachedSession>((resolve, reject) => {
      let isSettled = false;
      let socket: net.Socket;

      const timer = setTimeout(() => {
        const timeoutErr = new Error(
          `Connection to RouterOS binary API at ${config.host}:${port} timed out after ${timeoutMs}ms`,
        );
        (timeoutErr as any).code = 'ETIMEDOUT';
        finishError(timeoutErr);
      }, timeoutMs);

      const finishError = (err: Error) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        try {
          socket.destroy();
        } catch {}
        const safeMsg = sanitizeMessage(err.message, [config.password, config.username]);
        const sanitizedErr = new Error(safeMsg);
        (sanitizedErr as any).code = (err as any).code;
        (sanitizedErr as any).statusCode = (err as any).statusCode;
        reject(sanitizedErr);
      };

      if (useSsl) {
        socket = tls.connect({
          host: config.host,
          port,
          rejectUnauthorized: false,
        });
      } else {
        socket = net.createConnection({
          host: config.host,
          port,
        });
      }

      socket.setKeepAlive(true, 10000);
      socket.setNoDelay(true);

      let receiveBuffer: any = Buffer.alloc(0);
      let isAuthenticated = false;

      // Create session without storing passwords
      const session: CachedSession = {
        key,
        socket,
        idleTimer: null,
        commandQueue: Promise.resolve(),
        isClosed: false,
        receiveBuffer: Buffer.alloc(0),
        onSentence: null,
        onError: null,
      };

      const handleLoginSentence = (words: string[]) => {
        if (words.length === 0) return;
        const sentence = this.parseSentenceFromWords(words);
        if (!sentence) return;

        const { type, attributes } = sentence;

        if (type === '!trap') {
          const msg = attributes['message'] || 'Authentication rejected by RouterOS';
          const authErr = new Error(`RouterOS authentication failed: ${msg}`);
          (authErr as any).statusCode = 401;
          finishError(authErr);
          return;
        }

        if (type === '!done') {
          // Challenge-response fallback for legacy RouterOS (< v6.43)
          if (attributes['ret']) {
            const challenge = attributes['ret'];
            const md5Hash = crypto
              .createHash('md5')
              .update(
                Buffer.concat([
                  Buffer.from([0x00]),
                  Buffer.from(config.password, 'utf8'),
                  Buffer.from(challenge, 'hex'),
                ]),
              )
              .digest('hex');

            socket.write(
              this.encodeSentence([
                '/login',
                `=name=${config.username}`,
                `=response=00${md5Hash}`,
              ]),
            );
            return;
          }

          // Authentication succeeded!
          isAuthenticated = true;
          clearTimeout(timer);
          isSettled = true;

          session.receiveBuffer = receiveBuffer;
          this.attachSessionListeners(session);

          if (cacheSession) {
            this.sessionCache.set(key, session);
            this.resetIdleTimer(session);
          }

          resolve(session);
        }
      };

      socket.on('connect', () => {
        socket.write(
          this.encodeSentence([
            '/login',
            `=name=${config.username}`,
            `=password=${config.password}`,
          ]),
        );
      });

      const onInitialData = (chunk: Buffer) => {
        receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
        try {
          while (true) {
            const words = this.extractSentenceWords(receiveBuffer);
            if (!words) break;
            receiveBuffer = words.remaining;
            handleLoginSentence(words.words);
            if (isAuthenticated) {
              socket.off('data', onInitialData);
              break;
            }
          }
        } catch (parseErr: any) {
          finishError(parseErr);
        }
      };

      socket.on('data', onInitialData);

      socket.once('error', (err) => {
        finishError(err);
      });

      socket.once('close', () => {
        if (!isSettled) {
          finishError(new Error('Connection closed by RouterOS during authentication handshake'));
        }
      });
    });
  }

  /**
   * Retrieves an existing valid session from cache or initiates authenticated connection.
   */
  private async getOrCreateSession(
    config: RouterConnectionConfig,
    key: string,
  ): Promise<CachedSession> {
    const existing = this.sessionCache.get(key);
    if (existing) {
      if (!existing.isClosed && !existing.socket.destroyed) {
        return existing;
      }
      this.removeSession(key, existing);
    }

    const inFlight = this.connectingSessions.get(key);
    if (inFlight) {
      return inFlight;
    }

    const connectPromise = this.connectAndAuthenticate(config, key, true)
      .finally(() => {
        this.connectingSessions.delete(key);
      });

    this.connectingSessions.set(key, connectPromise);
    return connectPromise;
  }

  /**
   * Executes a batch of commands sequentially on an active session.
   */
  private runCommandsOnSession(
    session: CachedSession,
    commands: string[][],
    timeoutMs: number,
    config: RouterConnectionConfig,
  ): Promise<RosSentence[][]> {
    return new Promise<RosSentence[][]>((resolve, reject) => {
      if (session.isClosed || session.socket.destroyed) {
        return reject(new Error('RouterOS binary socket is closed or destroyed'));
      }

      let isSettled = false;
      let timer: NodeJS.Timeout | null = null;
      let currentCommandIndex = -1;
      const allCommandResults: RosSentence[][] = [];

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        session.onSentence = null;
        session.onError = null;
      };

      const finishError = (err: Error) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();

        this.handleSessionError(session, err);

        const safeMsg = sanitizeMessage(err.message, [config.password, config.username]);
        const sanitizedErr = new Error(safeMsg);
        (sanitizedErr as any).code = (err as any).code;
        reject(sanitizedErr);
      };

      const finishSuccess = (results: RosSentence[][]) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        resolve(results);
      };

      timer = setTimeout(() => {
        const timeoutErr = new Error(
          `Command execution to RouterOS binary API timed out after ${timeoutMs}ms`,
        );
        (timeoutErr as any).code = 'ETIMEDOUT';
        finishError(timeoutErr);
      }, timeoutMs);

      session.onError = (err: Error) => {
        finishError(err);
      };

      const sendNextCommand = () => {
        currentCommandIndex++;
        if (currentCommandIndex >= commands.length) {
          finishSuccess(allCommandResults);
          return;
        }

        allCommandResults.push([]);
        const cmd = commands[currentCommandIndex];
        try {
          session.socket.write(this.encodeSentence(cmd));
        } catch (writeErr: any) {
          finishError(writeErr);
        }
      };

      session.onSentence = (sentence: RosSentence) => {
        if (currentCommandIndex >= 0 && currentCommandIndex < allCommandResults.length) {
          if (sentence.type === '!re' || sentence.type === '!done' || sentence.type === '!trap') {
            allCommandResults[currentCommandIndex].push(sentence);
          }

          if (sentence.type === '!trap') {
            const msg = sentence.attributes['message'] || 'Command execution trapped by RouterOS';
            this.logger.warn(`RouterOS binary API command trap: ${msg}`);
          }

          if (sentence.type === '!done') {
            sendNextCommand();
          }
        }
      };

      sendNextCommand();
    });
  }

  /**
   * Enqueues a command batch into the per-router serialized command queue.
   * Ensures commands execute sequentially without interleaving binary API sentences.
   */
  private enqueueCommands(
    session: CachedSession,
    commands: string[][],
    config: RouterConnectionConfig,
  ): Promise<RosSentence[][]> {
    return new Promise<RosSentence[][]>((resolve, reject) => {
      session.commandQueue = session.commandQueue
        .then(
          () => this.dispatchCommandToSession(session, commands, config),
          () => this.dispatchCommandToSession(session, commands, config),
        )
        .then(resolve, reject);
    });
  }

  private async dispatchCommandToSession(
    session: CachedSession,
    commands: string[][],
    config: RouterConnectionConfig,
  ): Promise<RosSentence[][]> {
    if (session.isClosed || session.socket.destroyed) {
      throw new Error('RouterOS socket was closed or destroyed before command execution');
    }

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }

    try {
      const res = await this.runCommandsOnSession(
        session,
        commands,
        config.timeoutMs || 4000,
        config,
      );
      this.resetIdleTimer(session);
      return res;
    } catch (err) {
      this.resetIdleTimer(session);
      throw err;
    }
  }

  /**
   * Fallback for callers that do not supply organizationId + routerId (one-shot execution).
   */
  private async executeStatelessCommands(
    config: RouterConnectionConfig,
    commands: string[][],
  ): Promise<RosSentence[][]> {
    const ephemeralKey = `stateless:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const session = await this.connectAndAuthenticate(config, ephemeralKey, false);
    try {
      return await this.runCommandsOnSession(
        session,
        commands,
        config.timeoutMs || 4000,
        config,
      );
    } finally {
      try {
        session.socket.end();
      } catch {}
      session.isClosed = true;
    }
  }

  /**
   * Executes commands on the router. Uses 15s cached session when organizationId and routerId are present.
   */
  private async executeCommands(
    config: RouterConnectionConfig,
    commands: string[][],
  ): Promise<RosSentence[][]> {
    const cacheKey =
      config.organizationId && config.routerId
        ? `${config.organizationId}:${config.routerId}`
        : null;

    if (!cacheKey) {
      return this.executeStatelessCommands(config, commands);
    }

    const session = await this.getOrCreateSession(config, cacheKey);
    return this.enqueueCommands(session, commands, config);
  }

  /**
   * Helper to parse version numbers from RouterOS version string (e.g. "6.45.1" -> major: 6, minor: 45)
   */
  public parseRosVersion(versionStr: string): { major: number; minor: number } {
    const match = versionStr.match(/^(\d+)\.(\d+)/);
    if (match) {
      return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
      };
    }
    return { major: 6, minor: 0 };
  }

  /**
   * Parses system resource attributes from RouterOS /system/resource/print.
   */
  public parseSystemResourcesAttributes(r: Record<string, string>): SystemResources {
    const cpuLoad = parseInt(r['cpu-load'] || '0', 10);
    const totalMemory = parseInt(r['total-memory'] || '0', 10);
    const freeMemory = parseInt(r['free-memory'] || '0', 10);
    const totalHddSpace = parseInt(r['total-hdd-space'] || '0', 10);
    const freeHddSpace = parseInt(r['free-hdd-space'] || '0', 10);
    const cpuCount = r['cpu-count'] ? parseInt(r['cpu-count'], 10) : undefined;
    const cpuFrequency = r['cpu-frequency'] ? parseInt(r['cpu-frequency'], 10) : undefined;

    return {
      platform: r['platform'] || 'MikroTik',
      boardName: r['board-name'] || 'RouterBOARD',
      version: r['version'] || '6.x',
      uptime: r['uptime'] || '0s',
      cpuLoad: isNaN(cpuLoad) ? 0 : cpuLoad,
      totalMemory: isNaN(totalMemory) ? 0 : totalMemory,
      freeMemory: isNaN(freeMemory) ? 0 : freeMemory,
      totalHddSpace: isNaN(totalHddSpace) ? 0 : totalHddSpace,
      freeHddSpace: isNaN(freeHddSpace) ? 0 : freeHddSpace,
      architectureName: r['architecture-name'],
      cpuCount,
      cpuFrequency,
    };
  }

  async testConnection(config: RouterConnectionConfig): Promise<TestConnectionResult> {
    const startTime = Date.now();
    try {
      const results = await this.executeCommands(config, [
        ['/system/identity/print'],
        ['/system/resource/print'],
      ]);

      const latencyMs = Date.now() - startTime;

      const identitySentence = results[0]?.find((s) => s.type === '!re');
      const resourceSentence = results[1]?.find((s) => s.type === '!re');

      const identity = identitySentence?.attributes['name'] || 'MikroTik';
      const rosVersion = resourceSentence?.attributes['version'] || '6.x';
      const model =
        resourceSentence?.attributes['board-name'] ||
        resourceSentence?.attributes['platform'] ||
        'RouterBOARD';

      const { major, minor } = this.parseRosVersion(rosVersion);

      const capabilities: RouterCapabilities = {
        rest: major >= 7,
        binaryApi: true,
        sstp: true,
        coa: true,
      };

      const systemResources = resourceSentence
        ? this.parseSystemResourcesAttributes(resourceSentence.attributes)
        : undefined;

      return {
        success: true,
        identity,
        rosVersion,
        model,
        latencyMs,
        majorVersion: major,
        minorVersion: minor,
        apiMethodUsed: 'BINARY_API',
        capabilities,
        systemResources,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      const safeMsg = sanitizeMessage(err.message || 'Binary API connection failed', [
        config.password,
      ]);
      return {
        success: false,
        latencyMs,
        errorMessage: safeMsg,
        apiMethodUsed: 'BINARY_API',
      };
    }
  }

  async getRouterIdentity(config: RouterConnectionConfig): Promise<RouterIdentity> {
    const results = await this.executeCommands(config, [['/system/identity/print']]);
    const rec = results[0]?.find((s) => s.type === '!re');
    return {
      name: rec?.attributes['name'] || 'MikroTik',
    };
  }

  async getSystemResources(config: RouterConnectionConfig): Promise<SystemResources> {
    const results = await this.executeCommands(config, [['/system/resource/print']]);
    const r = results[0]?.find((s) => s.type === '!re')?.attributes || {};
    return this.parseSystemResourcesAttributes(r);
  }

  async getActivePppSessions(config: RouterConnectionConfig): Promise<ActivePppSession[]> {
    const results = await this.executeCommands(config, [['/ppp/active/print']]);
    const records = results[0]?.filter((s) => s.type === '!re') || [];

    return records.map((rec) => {
      const a = rec.attributes;
      return {
        id: a['.id'],
        name: a['name'] || 'unknown',
        service: a['service'] || 'pppoe',
        callerId: a['caller-id'],
        address: a['address'] || '0.0.0.0',
        uptime: a['uptime'] || '0s',
        encoding: a['encoding'],
        sessionId: a['session-id'],
      };
    });
  }

  async getInterfaces(config: RouterConnectionConfig): Promise<RouterInterface[]> {
    const results = await this.executeCommands(config, [['/interface/print']]);
    const records = results[0]?.filter((s) => s.type === '!re') || [];

    return records.map((rec) => {
      const a = rec.attributes;
      return {
        id: a['.id'],
        name: a['name'] || 'unknown',
        type: a['type'] || 'ether',
        actualMtu: a['actual-mtu'] ? parseInt(a['actual-mtu'], 10) : undefined,
        macAddress: a['mac-address'],
        running: a['running'] === 'true',
        disabled: a['disabled'] === 'true',
        comment: a['comment'],
      };
    });
  }

  async getInterfaceTraffic(
    config: RouterConnectionConfig,
    interfaceName: string,
  ): Promise<InterfaceTraffic> {
    const results = await this.executeCommands(config, [
      ['/interface/monitor-traffic', `=interface=${interfaceName}`, '=once='],
    ]);
    const rec = results[0]?.find((s) => s.type === '!re')?.attributes || {};

    const rxBps = parseInt(rec['rx-bits-per-second'] || '0', 10);
    const txBps = parseInt(rec['tx-bits-per-second'] || '0', 10);
    const rxPackets = rec['rx-packets-per-second']
      ? parseInt(rec['rx-packets-per-second'], 10)
      : undefined;
    const txPackets = rec['tx-packets-per-second']
      ? parseInt(rec['tx-packets-per-second'], 10)
      : undefined;

    return {
      name: interfaceName,
      rxBps: isNaN(rxBps) ? 0 : rxBps,
      txBps: isNaN(txBps) ? 0 : txBps,
      rxPacketsPerSecond: rxPackets,
      txPacketsPerSecond: txPackets,
    };
  }
}
