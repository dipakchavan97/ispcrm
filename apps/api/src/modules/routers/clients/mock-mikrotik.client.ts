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

@Injectable()
export class MockMikrotikClient implements MikrotikClient {
  public failNextAttempts = 0;
  public failErrorType: 'timeout' | 'auth' | 'transient' = 'transient';
  public callHistory: Array<{ method: string; host: string; port: number; timestamp: number }> = [];

  public resetSimulation() {
    this.failNextAttempts = 0;
    this.failErrorType = 'transient';
    this.callHistory = [];
  }

  public setFailNextAttempts(count: number, type: 'timeout' | 'auth' | 'transient' = 'transient') {
    this.failNextAttempts = count;
    this.failErrorType = type;
  }

  private recordCall(method: string, config: RouterConnectionConfig) {
    // SECURITY: Store host and port, NEVER store config.password
    this.callHistory.push({
      method,
      host: config.host,
      port: config.port,
      timestamp: Date.now(),
    });
  }

  private checkSimulatedFailures(config: RouterConnectionConfig) {
    if (this.failNextAttempts > 0) {
      this.failNextAttempts--;
      if (this.failErrorType === 'timeout') {
        const timeoutErr: any = new Error(`Connection to RouterOS at ${config.host}:${config.port} timed out after ${config.timeoutMs || 3000}ms`);
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      if (this.failErrorType === 'auth') {
        const authErr: any = new Error('RouterOS API error: 401 Unauthorized - Invalid username or password');
        authErr.statusCode = 401;
        throw authErr;
      }
      const netErr: any = new Error(`Connection reset by peer: ${config.host}:${config.port}`);
      netErr.code = 'ECONNRESET';
      throw netErr;
    }

    if (config.host === 'timeout.mock' || config.host === '192.0.2.1') {
      const timeoutErr: any = new Error(`Connection to RouterOS at ${config.host}:${config.port} timed out after ${config.timeoutMs || 3000}ms`);
      timeoutErr.code = 'ETIMEDOUT';
      throw timeoutErr;
    }

    if (config.host === 'unreachable.mock') {
      const netErr: any = new Error(`connect ECONNREFUSED ${config.host}:${config.port}`);
      netErr.code = 'ECONNREFUSED';
      throw netErr;
    }

    if (config.password === 'bad_password' || config.password === 'wrong_password') {
      const authErr: any = new Error('RouterOS API error: 401 Unauthorized - Invalid username or password');
      authErr.statusCode = 401;
      throw authErr;
    }
  }

  async testConnection(config: RouterConnectionConfig): Promise<TestConnectionResult> {
    this.recordCall('testConnection', config);
    try {
      this.checkSimulatedFailures(config);
      return {
        success: true,
        identity: 'MikroTik-CCR2004-Edge-01',
        rosVersion: 'RouterOS v7.14.3',
        model: 'CCR2004-1G-12S+2XS',
        latencyMs: 8,
      };
    } catch (err: any) {
      if (err.statusCode === 401) {
        return {
          success: false,
          errorMessage: 'Authentication failed: Invalid credentials',
          latencyMs: 10,
        };
      }
      throw err;
    }
  }

  async getRouterIdentity(config: RouterConnectionConfig): Promise<RouterIdentity> {
    this.recordCall('getRouterIdentity', config);
    this.checkSimulatedFailures(config);
    return {
      name: 'MikroTik-CCR2004-Edge-01',
    };
  }

  async getSystemResources(config: RouterConnectionConfig): Promise<SystemResources> {
    this.recordCall('getSystemResources', config);
    this.checkSimulatedFailures(config);
    return {
      platform: 'MikroTik',
      boardName: 'CCR2004-1G-12S+2XS',
      version: '7.14.3 (stable)',
      uptime: '14d 06:42:19',
      cpuLoad: 18,
      totalMemory: 4294967296, // 4GB
      freeMemory: 3489660928,
      totalHddSpace: 134217728, // 128MB
      freeHddSpace: 89456640,
      architectureName: 'arm64',
      cpuCount: 4,
      cpuFrequency: 1700,
    };
  }

  async getActivePppSessions(config: RouterConnectionConfig): Promise<ActivePppSession[]> {
    this.recordCall('getActivePppSessions', config);
    this.checkSimulatedFailures(config);
    return [
      {
        id: '*1',
        name: 'speed_50m_user',
        service: 'pppoe',
        callerId: 'DC:2C:6E:12:34:56',
        address: '100.64.10.101',
        uptime: '03:42:15',
        bytesIn: 148592019,
        bytesOut: 892019482,
        sessionId: '0x81000001',
      },
      {
        id: '*2',
        name: 'speed_100m_user',
        service: 'pppoe',
        callerId: '48:8F:5A:AB:CD:EF',
        address: '100.64.10.102',
        uptime: '08:14:02',
        bytesIn: 948192040,
        bytesOut: 3829104812,
        sessionId: '0x81000002',
      },
      {
        id: '*3',
        name: 'speed_200m_user',
        service: 'pppoe',
        callerId: 'BC:24:11:98:76:54',
        address: '100.64.10.103',
        uptime: '01:10:45',
        bytesIn: 58291040,
        bytesOut: 481920481,
        sessionId: '0x81000003',
      },
    ];
  }

  async getInterfaces(config: RouterConnectionConfig): Promise<RouterInterface[]> {
    this.recordCall('getInterfaces', config);
    this.checkSimulatedFailures(config);
    return [
      {
        id: '*1',
        name: 'ether1-wan',
        type: 'ether',
        actualMtu: 1500,
        macAddress: '48:8F:5A:01:00:01',
        running: true,
        disabled: false,
        comment: 'Uplink to Tier-1 IP Transit',
      },
      {
        id: '*2',
        name: 'ether2-lan',
        type: 'ether',
        actualMtu: 1500,
        macAddress: '48:8F:5A:01:00:02',
        running: true,
        disabled: false,
        comment: 'PPPoE Access Network',
      },
      {
        id: '*3',
        name: 'bridge-local',
        type: 'bridge',
        actualMtu: 1500,
        macAddress: '48:8F:5A:01:00:03',
        running: true,
        disabled: false,
        comment: 'Local OAM Bridge',
      },
      {
        id: '*4',
        name: 'sfp-sfpplus1',
        type: 'ether',
        actualMtu: 9000,
        macAddress: '48:8F:5A:01:00:04',
        running: true,
        disabled: false,
        comment: '10G OLT Trunk',
      },
    ];
  }

  async getInterfaceTraffic(config: RouterConnectionConfig, interfaceName: string): Promise<InterfaceTraffic> {
    this.recordCall('getInterfaceTraffic', config);
    this.checkSimulatedFailures(config);
    return {
      name: interfaceName,
      rxBps: 24589200, // 24.5 Mbps
      txBps: 89450200, // 89.4 Mbps
      rxPacketsPerSecond: 2840,
      txPacketsPerSecond: 9150,
    };
  }
}
