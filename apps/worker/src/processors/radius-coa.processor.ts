import { Job } from 'bullmq';
import { prisma } from '@isp-crm/database';
import {
  RadiusCoaJobData,
  RadiusCoaClient,
  CoaAction,
  CoaRequestType,
  CoaResult,
  AuditAction,
} from '@isp-crm/shared';

export { RadiusCoaJobData };

export async function processRadiusCoaJob(
  job: Job<RadiusCoaJobData>,
): Promise<{
  success: boolean;
  code: number;
  codeName: string;
  latencyMs: number;
  username: string;
  timestamp: string;
}> {
  const {
    organizationId,
    customerId,
    subscriptionId,
    username,
    action,
    requestType = CoaRequestType.COA,
    rateLimit,
    framedIp,
    sessionId,
    nasIp = '127.0.0.1',
    nasPort = 3799,
    secret = 'testing123',
    adminUserId,
  } = job.data;

  console.log(
    `[Worker:CoA] Received job '${job.id}' (${action} / ${requestType}) for subscriber '${username}' targeting NAS ${nasIp}:${nasPort}`,
  );

  let result: CoaResult;

  // 1. Dispatch CoA or Disconnect Request
  if (requestType === CoaRequestType.DISCONNECT || action === CoaAction.SUSPEND) {
    result = await RadiusCoaClient.sendDisconnectRequest({
      nasIp,
      nasPort,
      secret,
      username,
      framedIp,
      sessionId,
      timeoutMs: 2500,
      maxRetries: 2,
    });
  } else {
    // CoA-Request for bandwidth change (UPGRADE, DOWNGRADE, REACTIVATE)
    let effectiveRateLimit = rateLimit;
    if (!effectiveRateLimit) {
      // Look up current rate-limit attribute from radreply
      const reply = await prisma.radReply.findFirst({
        where: { username, attribute: 'Mikrotik-Rate-Limit' },
      });
      effectiveRateLimit = reply?.value || '20M/50M';
    }

    result = await RadiusCoaClient.sendCoaRequest({
      nasIp,
      nasPort,
      secret,
      username,
      rateLimit: effectiveRateLimit,
      framedIp,
      sessionId,
      timeoutMs: 2500,
      maxRetries: 2,
    });

    // Fallback: If router NAKs CoA (e.g. dynamic queue adjustment not supported), send Disconnect (PoD)
    if (result.codeName === 'COA_NAK') {
      console.warn(
        `[Worker:CoA] Router ${nasIp}:${nasPort} responded with CoA-NAK for '${username}'. Executing Disconnect fallback...`,
      );
      const disconnectResult = await RadiusCoaClient.sendDisconnectRequest({
        nasIp,
        nasPort,
        secret,
        username,
        framedIp,
        sessionId,
        timeoutMs: 2500,
        maxRetries: 1,
      });
      if (disconnectResult.success) {
        result = disconnectResult;
      }
    }
  }

  // 2. Structured Logging
  console.log(
    `[Worker:CoA] Result for '${username}' (${action}) -> ${result.codeName} (${result.latencyMs}ms, attempts: ${result.attemptsMade}, NAS: ${nasIp}:${nasPort})`,
  );

  // 3. Persist Audit Log in PostgreSQL
  try {
    if (organizationId) {
      await prisma.auditLog.create({
        data: {
          organizationId,
          adminUserId: adminUserId || null,
          action: AuditAction.COA_DISCONNECT,
          entityType: 'SUBSCRIPTION',
          entityId: subscriptionId || customerId,
          details: {
            jobId: job.id,
            action,
            requestType,
            username,
            rateLimit,
            nasIp,
            nasPort,
            sessionId,
            framedIp,
            success: result.success,
            codeName: result.codeName,
            latencyMs: result.latencyMs,
            attemptsMade: result.attemptsMade,
            errorCause: result.errorCause || null,
          },
        },
      });
    }
  } catch (auditErr: any) {
    console.warn(`[Worker:CoA] Failed to persist audit log: ${auditErr.message}`);
  }

  // If operation timed out or failed with an error, throw so BullMQ can execute exponential backoff retry
  if (!result.success && result.codeName === 'TIMEOUT') {
    throw new Error(`RADIUS CoA/PoD request timed out on NAS ${nasIp}:${nasPort}`);
  }

  return {
    success: result.success,
    code: result.code,
    codeName: result.codeName,
    latencyMs: result.latencyMs,
    username,
    timestamp: new Date().toISOString(),
  };
}
