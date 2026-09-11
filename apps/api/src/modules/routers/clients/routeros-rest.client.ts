import { Injectable } from '@nestjs/common';
import {
  MikrotikClient,
  RouterConnectionConfig,
  RouterIdentity,
  SystemResources,
  ActivePppSession,
  RouterInterface,
  InterfaceTraffic,
  TestConnectionResult,
} from './mikrotik-client.interface';
import { sanitizeMessage } from '../../../common/utils/crypto.util';

@Injectable()
export class RouterOsRestClient implements MikrotikClient {
  private getBaseUrl(config: RouterConnectionConfig): string {
    const protocol = config.useSsl ? 'https' : 'http';
    return `${protocol}://${config.host}:${config.port}/rest`;
  }

  private getAuthHeader(config: RouterConnectionConfig): string {
    return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  }

  private async request<T>(config: RouterConnectionConfig, endpoint: string, options: RequestInit = {}): Promise<T> {
    const timeoutMs = config.timeoutMs || 4000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const url = `${this.getBaseUrl(config)}${endpoint}`;
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: this.getAuthHeader(config),
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          const authError: any = new Error(`RouterOS authentication failed on ${config.host}:${config.port}`);
          authError.statusCode = 401;
          throw authError;
        }
        const errorText = await response.text().catch(() => '');
        throw new Error(`RouterOS request to ${endpoint} failed with HTTP ${response.status}: ${errorText}`);
      }

      return (await response.json()) as T;
    } catch (err: any) {
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        const timeoutErr: any = new Error(`Connection to RouterOS at ${config.host}:${config.port} timed out after ${timeoutMs}ms`);
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      // SECURITY: Ensure passwords or auth tokens never appear in the thrown error message
      err.message = sanitizeMessage(err.message, [config.password, config.username]);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(config: RouterConnectionConfig): Promise<TestConnectionResult> {
    const startTime = Date.now();
    try {
      const [identity, resource] = await Promise.all([
        this.getRouterIdentity(config),
        this.getSystemResources(config),
      ]);

      const latencyMs = Date.now() - startTime;
      return {
        success: true,
        identity: identity.name,
        rosVersion: resource.version,
        model: resource.boardName,
        latencyMs,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      return {
        success: false,
        latencyMs,
        errorMessage: sanitizeMessage(err.message || 'Connection failed', [config.password]),
      };
    }
  }

  async getRouterIdentity(config: RouterConnectionConfig): Promise<RouterIdentity> {
    const data = await this.request<{ name?: string }>(config, '/system/identity');
    return {
      name: data?.name || 'MikroTik',
    };
  }

  async getSystemResources(config: RouterConnectionConfig): Promise<SystemResources> {
    const data = await this.request<any>(config, '/system/resource');
    return {
      platform: data?.platform || 'MikroTik',
      boardName: data?.['board-name'] || data?.boardName,
      version: data?.version || 'Unknown',
      uptime: data?.uptime || '0s',
      cpuLoad: Number(data?.['cpu-load'] ?? 0),
      totalMemory: Number(data?.['total-memory'] ?? 0),
      freeMemory: Number(data?.['free-memory'] ?? 0),
      totalHddSpace: Number(data?.['total-hdd-space'] ?? 0),
      freeHddSpace: Number(data?.['free-hdd-space'] ?? 0),
      architectureName: data?.['architecture-name'],
      cpuCount: Number(data?.['cpu-count'] ?? 1),
      cpuFrequency: Number(data?.['cpu-frequency'] ?? 0),
    };
  }

  async getActivePppSessions(config: RouterConnectionConfig): Promise<ActivePppSession[]> {
    const items = await this.request<any[]>(config, '/ppp/active');
    if (!Array.isArray(items)) return [];

    return items.map((item) => ({
      id: item['.id'] || item.id,
      name: item.name || '',
      service: item.service || 'pppoe',
      callerId: item['caller-id'] || item.callerId,
      address: item.address || '',
      uptime: item.uptime || '0s',
      bytesIn: item['bytes-in'] ? Number(item['bytes-in']) : undefined,
      bytesOut: item['bytes-out'] ? Number(item['bytes-out']) : undefined,
      sessionId: item['session-id'] || item.sessionId,
    }));
  }

  async getInterfaces(config: RouterConnectionConfig): Promise<RouterInterface[]> {
    const items = await this.request<any[]>(config, '/interface');
    if (!Array.isArray(items)) return [];

    return items.map((item) => ({
      id: item['.id'] || item.id,
      name: item.name,
      type: item.type,
      actualMtu: item['actual-mtu'] ? Number(item['actual-mtu']) : undefined,
      macAddress: item['mac-address'] || item.macAddress,
      running: item.running === 'true' || item.running === true,
      disabled: item.disabled === 'true' || item.disabled === true,
      comment: item.comment,
    }));
  }

  async getInterfaceTraffic(config: RouterConnectionConfig, interfaceName: string): Promise<InterfaceTraffic> {
    const data = await this.request<any[]>(config, '/interface/monitor-traffic', {
      method: 'POST',
      body: JSON.stringify({
        interface: interfaceName,
        once: '',
      }),
    });

    const stat = Array.isArray(data) ? data[0] : data;
    return {
      name: interfaceName,
      rxBps: Number(stat?.['rx-bits-per-second'] ?? 0),
      txBps: Number(stat?.['tx-bits-per-second'] ?? 0),
      rxPacketsPerSecond: Number(stat?.['rx-packets-per-second'] ?? 0),
      txPacketsPerSecond: Number(stat?.['tx-packets-per-second'] ?? 0),
    };
  }
}
