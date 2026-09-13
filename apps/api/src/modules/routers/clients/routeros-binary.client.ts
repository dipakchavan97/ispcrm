import { Injectable, Logger } from '@nestjs/common';
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

interface RosSentence {
  type: '!re' | '!done' | '!trap' | '!fatal' | string;
  attributes: Record<string, string>;
}

@Injectable()
export class RouterOsBinaryClient implements MikrotikClient {
  private readonly logger = new Logger(RouterOsBinaryClient.name);

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
   * Executes an interactive session with the RouterOS Binary API (port 8728 / 8729).
   */
  private async executeCommands(
    config: RouterConnectionConfig,
    commands: string[][],
  ): Promise<RosSentence[][]> {
    const timeoutMs = config.timeoutMs || 4000;
    const port = config.port || 8728;
    const useSsl = Boolean(config.useSsl);

    return new Promise<RosSentence[][]>((resolve, reject) => {
      let isSettled = false;
      let socket: net.Socket;

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
        reject(sanitizedErr);
      };

      const finishSuccess = (results: RosSentence[][]) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        try {
          socket.end();
        } catch {}
        resolve(results);
      };

      const timer = setTimeout(() => {
        const timeoutErr = new Error(
          `Connection to RouterOS binary API at ${config.host}:${port} timed out after ${timeoutMs}ms`,
        );
        (timeoutErr as any).code = 'ETIMEDOUT';
        finishError(timeoutErr);
      }, timeoutMs);

      // Connection options
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

      let receiveBuffer = Buffer.alloc(0);
      const parsedSentences: RosSentence[] = [];
      const allCommandResults: RosSentence[][] = [];
      let currentCommandIndex = -1;
      let isAuthenticated = false;

      const parseWordsFromBuffer = (): string[] | null => {
        let offset = 0;
        const words: string[] = [];

        while (offset < receiveBuffer.length) {
          const firstByte = receiveBuffer[offset];

          // 0x00 is end of sentence
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
            wordLength =
              ((firstByte & 0x1f) << 16) |
              (receiveBuffer[offset + 1] << 8) |
              receiveBuffer[offset + 2];
            lengthBytesCount = 3;
          } else if ((firstByte & 0xf0) === 0xe0) {
            if (offset + 4 > receiveBuffer.length) return null;
            wordLength =
              ((firstByte & 0x0f) << 24) |
              (receiveBuffer[offset + 1] << 16) |
              (receiveBuffer[offset + 2] << 8) |
              receiveBuffer[offset + 3];
            lengthBytesCount = 4;
          } else if ((firstByte & 0xf8) === 0xf0) {
            if (offset + 5 > receiveBuffer.length) return null;
            wordLength =
              (receiveBuffer[offset + 1] << 24) |
              (receiveBuffer[offset + 2] << 16) |
              (receiveBuffer[offset + 3] << 8) |
              receiveBuffer[offset + 4];
            lengthBytesCount = 5;
          } else {
            // Invalid length encoding
            throw new Error('Malformed word length received from RouterOS binary API');
          }

          const wordStart = offset + lengthBytesCount;
          const wordEnd = wordStart + wordLength;

          if (wordEnd > receiveBuffer.length) {
            return null; // Incomplete word, wait for more data
          }

          const word = receiveBuffer.subarray(wordStart, wordEnd).toString('utf8');
          words.push(word);
          offset = wordEnd;
        }

        return null; // Incomplete sentence
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

      const handleSentence = (words: string[]) => {
        if (words.length === 0) return;
        const type = words[0];
        const attributes: Record<string, string> = {};

        for (let i = 1; i < words.length; i++) {
          const w = words[i];
          if (w.startsWith('=')) {
            const eqIdx = w.indexOf('=', 1);
            if (eqIdx !== -1) {
              const key = w.substring(1, eqIdx);
              const val = w.substring(eqIdx + 1);
              attributes[key] = val;
            } else {
              attributes[w.substring(1)] = '';
            }
          }
        }

        const sentence: RosSentence = { type, attributes };

        // Handle initial login negotiation
        if (!isAuthenticated) {
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
            sendNextCommand();
            return;
          }
          return;
        }

        // Processing queued commands
        if (currentCommandIndex >= 0 && currentCommandIndex < allCommandResults.length) {
          if (type === '!re' || type === '!done' || type === '!trap') {
            allCommandResults[currentCommandIndex].push(sentence);
          }

          if (type === '!trap') {
            const msg = attributes['message'] || 'Command execution trapped by RouterOS';
            this.logger.warn(`RouterOS binary API command trap: ${msg}`);
          }

          if (type === '!done') {
            sendNextCommand();
          }
        }
      };

      socket.on('connect', () => {
        // Step 1: Login handshake (RouterOS v6.43+ supports plain password in initial login sentence)
        socket.write(
          this.encodeSentence([
            '/login',
            `=name=${config.username}`,
            `=password=${config.password}`,
          ]),
        );
      });

      socket.on('data', (chunk) => {
        receiveBuffer = Buffer.concat([receiveBuffer, chunk]);

        try {
          while (true) {
            const words = parseWordsFromBuffer();
            if (!words) break;
            handleSentence(words);
          }
        } catch (parseErr: any) {
          finishError(parseErr);
        }
      });

      socket.on('error', (err) => {
        finishError(err);
      });

      socket.on('close', () => {
        if (!isSettled) {
          if (!isAuthenticated) {
            finishError(new Error('Connection closed by RouterOS during authentication handshake'));
          } else {
            finishSuccess(allCommandResults);
          }
        }
      });
    });
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
