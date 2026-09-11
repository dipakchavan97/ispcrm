import http from 'node:http';
import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { QUEUE_NAMES } from '@isp-crm/shared';
import { processBillingJob } from './processors/billing.processor';
import { processRadiusCoaJob } from './processors/radius-coa.processor';
import { processRouterSyncJob } from './processors/router-sync.processor';

dotenv.config();

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

async function startWorkers() {
  console.log(`[Worker] Connecting to Redis at ${redisHost}:${redisPort}...`);
  try {
    await connection.connect();
    console.log('[Worker] Redis connection established.');

    billingWorker = new Worker(QUEUE_NAMES.BILLING, processBillingJob, { connection });
    coaWorker = new Worker(QUEUE_NAMES.RADIUS_COA, processRadiusCoaJob, { connection });
    syncWorker = new Worker(QUEUE_NAMES.ROUTER_SYNC, processRouterSyncJob, { connection });

    console.log('[Worker] All BullMQ workers successfully registered and listening.');
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
  if (billingWorker) await billingWorker.close();
  if (coaWorker) await coaWorker.close();
  if (syncWorker) await syncWorker.close();
  await connection.quit();
  console.log('[Worker] Shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
