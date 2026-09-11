import { RouterStatus } from './enums';

export interface RouterConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string; // Plaintext in-memory only; never persisted or logged
  timeoutMs?: number;
  useSsl?: boolean;
}

export interface RouterIdentity {
  name: string;
}

export interface SystemResources {
  platform?: string;
  boardName?: string;
  version: string;
  uptime: string;
  cpuLoad: number; // 0 to 100 percentage
  totalMemory: number; // bytes
  freeMemory: number; // bytes
  totalHddSpace: number; // bytes
  freeHddSpace: number; // bytes
  architectureName?: string;
  cpuCount?: number;
  cpuFrequency?: number;
}

export interface ActivePppSession {
  id?: string;
  name: string; // username e.g. 'speed_50m_user'
  service: string; // 'pppoe', 'sstp', etc.
  callerId?: string; // MAC address or remote IP
  address: string; // Assigned framed IP address
  uptime: string; // Formatted uptime e.g. '01:23:45'
  bytesIn?: number;
  bytesOut?: number;
  sessionId?: string;
  encoding?: string;
}

export interface RouterInterface {
  id?: string;
  name: string;
  type: string; // 'ether', 'bridge', 'pppoe-in', 'vlan'
  actualMtu?: number;
  macAddress?: string;
  running: boolean;
  disabled: boolean;
  comment?: string;
}

export interface InterfaceTraffic {
  name: string;
  rxBps: number; // Receive bits or bytes per second
  txBps: number; // Transmit bits or bytes per second
  rxPacketsPerSecond?: number;
  txPacketsPerSecond?: number;
}

export interface TestConnectionResult {
  success: boolean;
  identity?: string;
  rosVersion?: string;
  model?: string;
  latencyMs?: number;
  errorMessage?: string;
}

export interface MikrotikClient {
  testConnection(config: RouterConnectionConfig): Promise<TestConnectionResult>;
  getRouterIdentity(config: RouterConnectionConfig): Promise<RouterIdentity>;
  getSystemResources(config: RouterConnectionConfig): Promise<SystemResources>;
  getActivePppSessions(config: RouterConnectionConfig): Promise<ActivePppSession[]>;
  getInterfaces(config: RouterConnectionConfig): Promise<RouterInterface[]>;
  getInterfaceTraffic(config: RouterConnectionConfig, interfaceName: string): Promise<InterfaceTraffic>;
}

export interface RegisterRouterInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  password: string; // Received from frontend over TLS, encrypted immediately at rest
  radiusSecret?: string;
  testOnRegister?: boolean;
}

export interface UpdateRouterInput {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  radiusSecret?: string;
  status?: RouterStatus;
}

/**
 * Sanitized router response for client and API layers.
 * STRICT SECURITY REQUIREMENT: encryptedCredential and passwords MUST NEVER BE RETURNED.
 */
export interface RouterDto {
  id: string;
  organizationId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  status: RouterStatus;
  lastSeen?: Date | string | null;
  model?: string | null;
  rosVersion?: string | null;
  identity?: string | null;
  radiusSecret?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
