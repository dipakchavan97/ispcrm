import http from 'node:http';
import * as child_process from 'node:child_process';
import * as dns from 'node:dns';
import dotenv from 'dotenv';
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import { QUEUE_NAMES } from '@isp-crm/shared';
import { processBillingJob } from './processors/billing.processor';
import { processRadiusCoaJob } from './processors/radius-coa.processor';
import { processRouterSyncJob } from './processors/router-sync.processor';

dotenv.config();

/**
 * Automatically configures kernel route to 10.200.0.0/16 via the sstp container gateway.
 */
function setupVpnRoute() {
  try {
    const sstpHost = process.env.SSTP_SERVICE_HOST || 'sstp';
    dns.lookup(sstpHost, (err, address) => {
      if (!err && address) {
        child_process.exec(`ip route replace 10.200.0.0/16 via ${address}`, (execErr) => {
          if (execErr) {
            console.debug(`[Worker] Kernel route configuration note: ${execErr.message}`);
          } else {
            console.log(`[Worker] Configured kernel route: 10.200.0.0/16 via ${address} (${sstpHost})`);
          }
        });
      } else if (err) {
        console.debug(`[Worker] DNS lookup for ${sstpHost} failed: ${err.message}`);
      }
    });
  } catch (e: any) {
    console.debug(`[Worker] setupVpnRoute error: ${e.message}`);
  }
}

// Initialize route immediately and periodic re-check
setupVpnRoute();
const vpnRouteTimer = setInterval(setupVpnRoute, 60000);

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = Number(process.env.REDIS_PORT) || 6379;
const workerPort = Number(process.env.WORKER_PORT) || 4001;

const connection = new Redis({
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

let billingWorker: Worker | null = null;
let coaWorker: Worker | null = null;
let syncWorker: Worker | null = null;
let billingQueue: Queue | null = null;
let periodicExpiryTimer: NodeJS.Timeout | null = null;

async function startWorkers() {
  console.log(`[Worker] Connecting to Redis at ${redisHost}:${redisPort}...`);
  try {
    await connection.connect();
    console.log('[Worker] Redis connection established.');

    billingQueue = new Queue(QUEUE_NAMES.BILLING, { connection });
    billingWorker = new Worker(QUEUE_NAMES.BILLING, processBillingJob, { connection });
    coaWorker = new Worker(QUEUE_NAMES.RADIUS_COA, processRadiusCoaJob, { connection });
    syncWorker = new Worker(QUEUE_NAMES.ROUTER_SYNC, processRouterSyncJob, { connection });

    console.log('[Worker] All BullMQ workers successfully registered and listening.');

    // Periodic Subscription Expiry Scanner
    const runPeriodicExpiryScan = async () => {
      try {
        const slot = Math.floor(Date.now() / 60000);
        await billingQueue?.add(
          'EXPIRY_CHECK',
          { type: 'EXPIRY_CHECK' },
          {
            jobId: `expiry-scan-${slot}`,
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        );
      } catch (err: any) {
        console.warn(`[Worker] Failed to enqueue periodic expiry scan: ${err.message}`);
      }
    };

    // Initial scan after 3s, then every 60s
    setTimeout(runPeriodicExpiryScan, 3000);
    periodicExpiryTimer = setInterval(runPeriodicExpiryScan, 60000);
    console.log('[Worker] Periodic subscription expiry scheduler active (interval: 60s).');
  } catch (err: any) {
    console.warn(`[Worker] Notice: Redis not yet available (${err.message}). Retrying in background...`);
  }
}

// Lightweight HTTP Health Check Server
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'worker',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      }),
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(workerPort, () => {
  console.log(`[Worker] Health probe HTTP server running on port ${workerPort}`);
});

startWorkers();

async function shutdown() {
  console.log('[Worker] Graceful shutdown initiated...');
  server.close();
  if (vpnRouteTimer) clearInterval(vpnRouteTimer);
  if (periodicExpiryTimer) clearInterval(periodicExpiryTimer);
  if (billingQueue) await billingQueue.close();
  if (billingWorker) await billingWorker.close();
  if (coaWorker) await coaWorker.close();
  if (syncWorker) await syncWorker.close();
  await connection.quit();
  console.log('[Worker] Shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
