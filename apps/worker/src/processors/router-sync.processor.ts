import { Job } from 'bullmq';
import { prisma } from '@isp-crm/database';
import { RouterOsRestClient } from '../mikrotik/routeros-rest.client';
import { RouterOsBinaryClient } from '../mikrotik/routeros-binary.client';
import { MockMikrotikClient } from '../mikrotik/mock-mikrotik.client';
import { decryptCredential } from '../utils/crypto.util';
import { RouterStatus, RouterConnectionMethod, RouterApiMethod, RouterConnectionConfig } from '@isp-crm/shared';

export interface RouterSyncJobData {
  routerId: string;
  ipAddress: string;
}

export async function processRouterSyncJob(
  job: Job<RouterSyncJobData>,
): Promise<{ status: string; routerId: string; timestamp: string }> {
  console.log(`[Worker] Running router sync heartbeat for ${job.data.ipAddress} (${job.data.routerId})`);

  const router = await prisma.router.findUnique({
    where: { id: job.data.routerId },
  });

  if (!router) {
    throw new Error(`Router ${job.data.routerId} not found`);
  }

  let decryptedPassword = '';
  try {
    decryptedPassword = decryptCredential(router.encryptedCredential);
  } catch (err) {
    if (router.encryptedCredential && !router.encryptedCredential.includes(':')) {
      decryptedPassword = router.encryptedCredential;
    } else {
      console.warn(`[Worker] Could not decrypt credentials for router ID: ${router.id}`);
    }
  }

  // Strict endpoint resolution: SSTP_TUNNEL must use vpnIp, DIRECT_API uses host
  let targetHost: string;
  if (
    router.connectionMethod === RouterConnectionMethod.SSTP_TUNNEL ||
    router.connectionMethod === 'SSTP_TUNNEL'
  ) {
    if (!router.vpnIp) {
      throw new Error(
        'SSTP router has no vpnIp assigned; cannot reach via public host',
      );
    }
    targetHost = router.vpnIp;
  } else {
    targetHost = router.host;
  }

  const config: RouterConnectionConfig = {
    host: targetHost,
    port: router.port,
    username: router.username,
    password: decryptedPassword,
    timeoutMs: 4000,
    connectionMethod: (router.connectionMethod as RouterConnectionMethod) || RouterConnectionMethod.DIRECT_API,
    apiMethod: (router.apiMethod as RouterApiMethod) || RouterApiMethod.AUTO,
    vpnIp: router.vpnIp || undefined,
  };

  const isMock = config.host.endsWith('.mock') || config.host === '127.0.0.1' || config.host === 'localhost';
  const restClient = new RouterOsRestClient();
  const binaryClient = new RouterOsBinaryClient();
  const mockClient = new MockMikrotikClient();

  const client = isMock ? mockClient : (config.apiMethod === RouterApiMethod.BINARY_API || config.port === 8728 ? binaryClient : restClient);

  try {
    const testResult = await client.testConnection(config);
    const existingCapabilities = (router.capabilities as any) || {};

    if (testResult.success) {
      // Worker deduplication: use systemResources returned by testConnection; do NOT query getSystemResources a 2nd time
      const resources = testResult.systemResources || null;

      const updatedCapabilities = {
        ...existingCapabilities,
        consecutiveFailures: 0,
        isDegraded: false,
        isStale: false,
        latencyMs: testResult.latencyMs,
        cpuLoad: resources?.cpuLoad !== undefined ? resources.cpuLoad : existingCapabilities.cpuLoad,
        freeMemory: resources?.freeMemory !== undefined ? resources.freeMemory : existingCapabilities.freeMemory,
        totalMemory: resources?.totalMemory !== undefined ? resources.totalMemory : existingCapabilities.totalMemory,
        uptime: resources?.uptime !== undefined ? resources.uptime : existingCapabilities.uptime,
        lastHealthCheck: new Date().toISOString(),
      };

      await prisma.router.update({
        where: { id: router.id },
        data: {
          status: RouterStatus.ONLINE,
          lastSeen: new Date(),
          identity: testResult.identity || router.identity,
          model: testResult.model || router.model,
          rosVersion: testResult.rosVersion || router.rosVersion,
          capabilities: updatedCapabilities,
          lastError: null,
        },
      });

      return {
        status: RouterStatus.ONLINE,
        routerId: job.data.routerId,
        timestamp: new Date().toISOString(),
      };
    } else {
      // Failed probe handling: protect against transient hiccups
      const failures = (existingCapabilities.consecutiveFailures || 0) + 1;
      // Failures 1 or 2: keep status ONLINE, mark isDegraded/isStale, preserve telemetry
      // Failures >= 3: mark UNREACHABLE
      const newStatus = failures < 3 ? RouterStatus.ONLINE : RouterStatus.UNREACHABLE;

      const updatedCapabilities = {
        ...existingCapabilities,
        consecutiveFailures: failures,
        isDegraded: true,
        isStale: true,
        latencyMs: testResult.latencyMs !== undefined ? testResult.latencyMs : existingCapabilities.latencyMs,
        lastAttempt: new Date().toISOString(),
      };

      await prisma.router.update({
        where: { id: router.id },
        data: {
          status: newStatus,
          lastError: testResult.errorMessage || 'Connection test failed',
          capabilities: updatedCapabilities,
        },
      });

      return {
        status: newStatus,
        routerId: job.data.routerId,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (err: any) {
    const existingCapabilities = (router.capabilities as any) || {};
    const failures = (existingCapabilities.consecutiveFailures || 0) + 1;

    // Failures 1 or 2: keep status ONLINE, mark isDegraded/isStale, preserve telemetry
    // Failures >= 3: mark UNREACHABLE
    const failureStatus = failures < 3 ? RouterStatus.ONLINE : RouterStatus.UNREACHABLE;

    const updatedCapabilities = {
      ...existingCapabilities,
      consecutiveFailures: failures,
      isDegraded: true,
      isStale: true,
      lastAttempt: new Date().toISOString(),
    };

    await prisma.router.update({
      where: { id: router.id },
      data: {
        status: failureStatus,
        lastError: err.message || 'Unknown network error',
        capabilities: updatedCapabilities,
      },
    });

    return {
      status: failureStatus,
      routerId: job.data.routerId,
      timestamp: new Date().toISOString(),
    };
  }
}
