import { Job } from 'bullmq';

export interface RouterSyncJobData {
  routerId: string;
  ipAddress: string;
}

export async function processRouterSyncJob(
  job: Job<RouterSyncJobData>,
): Promise<{ status: string; routerId: string; timestamp: string }> {
  console.log(`[Worker] Running router sync heartbeat for ${job.data.ipAddress}`);
  return {
    status: 'ONLINE',
    routerId: job.data.routerId,
    timestamp: new Date().toISOString(),
  };
}
