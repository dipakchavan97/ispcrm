import * as crypto from 'node:crypto';
import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  GatewayTimeoutException,
  BadGatewayException,
} from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import {
  RouterStatus,
  RouterDto,
  RegisterRouterInput,
  UpdateRouterInput,
  RouterIdentity,
  SystemResources,
  ActivePppSession,
  RouterInterface,
  InterfaceTraffic,
  TestConnectionResult,
  RouterConnectionConfig,
  RouterConnectionMethod,
  RouterApiMethod,
  SstpConfigResult,
  RouterOnboardingStatus,
  AuditAction,
} from '@isp-crm/shared';
import { MIKROTIK_CLIENT, MikrotikClient } from './clients/mikrotik-client.interface';
import { SstpVpnService } from './sstp-vpn.service';
import { CreateOnboardingRouterDto } from './dto/create-onboarding-router.dto';
import {
  encryptCredential,
  decryptCredential,
  sanitizeRouter,
  sanitizeRouters,
  sanitizeMessage,
} from '../../common/utils/crypto.util';

@Injectable()
export class MikrotikService {
  private readonly logger = new Logger(MikrotikService.name);

  constructor(
    @Inject(MIKROTIK_CLIENT)
    private readonly mikrotikClient: MikrotikClient,
    private readonly sstpVpnService: SstpVpnService,
  ) {}

  /**
   * Resilience wrapper executing client commands with timeouts, exponential backoff retries,
   * fast-fail on auth errors, and sanitized error masking.
   */
  private async executeWithRetryAndTimeout<T>(
    operationName: string,
    fn: () => Promise<T>,
    options: { maxRetries?: number; baseDelayMs?: number; password?: string } = {},
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 2;
    const baseDelayMs = options.baseDelayMs ?? 150;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        return await fn();
      } catch (err: any) {
        attempt++;

        // Fast-fail: NEVER retry invalid credentials or authentication rejections
        const isAuthError =
          err.statusCode === 401 ||
          err.statusCode === 403 ||
          err.message?.includes('401') ||
          err.message?.includes('Unauthorized') ||
          err.message?.includes('Invalid credentials');

        if (isAuthError) {
          const safeMsg = sanitizeMessage(err.message, options.password ? [options.password] : []);
          this.logger.warn(`MikroTik ${operationName} failed authentication: ${safeMsg}`);
          throw new UnauthorizedException(`Router authentication failed: ${safeMsg}`);
        }

        if (attempt > maxRetries) {
          const safeMsg = sanitizeMessage(
            err.message || 'Unknown network error',
            options.password ? [options.password] : [],
          );
          this.logger.error(`MikroTik ${operationName} failed after ${attempt} attempts: ${safeMsg}`);

          if (err.code === 'ETIMEDOUT' || err.message?.includes('timed out')) {
            throw new GatewayTimeoutException(`MikroTik router timed out: ${safeMsg}`);
          }
          throw new BadGatewayException(`MikroTik router error: ${safeMsg}`);
        }

        // Exponential backoff
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new BadGatewayException(`MikroTik operation '${operationName}' failed`);
  }

  /**
   * Internal helper to load router, decrypt credential in-memory, and create transient connection config.
   * SECURITY: Plain password is never saved to database or logged.
   */
  private async resolveConnection(
    organizationId: string,
    routerId: string,
  ): Promise<{ router: any; config: RouterConnectionConfig }> {
    const router = await prisma.router.findFirst({
      where: { id: routerId, organizationId },
    });

    if (!router) {
      throw new NotFoundException('Router not found in your organization');
    }

    let decryptedPassword = '';
    try {
      decryptedPassword = decryptCredential(router.encryptedCredential);
    } catch (err) {
      if (router.encryptedCredential && !router.encryptedCredential.includes(':')) {
        decryptedPassword = router.encryptedCredential;
      } else {
        this.logger.warn(
          `Could not decrypt credentials for router ID: ${router.id}, using empty string fallback for probe`,
        );
        decryptedPassword = '';
      }
    }

    // Strict endpoint resolution: SSTP_TUNNEL must use vpnIp, DIRECT_API uses host
    let targetHost: string;
    if (
      router.connectionMethod === RouterConnectionMethod.SSTP_TUNNEL ||
      router.connectionMethod === 'SSTP_TUNNEL'
    ) {
      if (!router.vpnIp) {
        throw new BadRequestException(
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
      organizationId,
      routerId,
    };

    return { router, config };
  }

  /**
   * Registers a new MikroTik router entity for the organization.
   * Encrypts passwords immediately at rest with AES-256-GCM.
   * NEVER returns encryptedCredential or passwords.
   */
  async registerRouter(organizationId: string, data: RegisterRouterInput): Promise<RouterDto> {
    const name = (data.name || '').trim();
    const host = (data.host || '').trim();
    const username = (data.username || '').trim();
    const password = typeof data.password === 'string' ? data.password : '';
    const radiusSecret =
      data.radiusSecret !== undefined && data.radiusSecret !== null && String(data.radiusSecret).trim() !== ''
        ? String(data.radiusSecret).trim()
        : crypto.randomBytes(16).toString('hex');

    // Ensure port is always stored as a positive 32-bit integer for Prisma
    const rawPort = Number(data.port);
    const parsedPort = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 8728;
    const testOnRegister = Boolean(data.testOnRegister);
    const connectionMethod = data.connectionMethod || RouterConnectionMethod.DIRECT_API;
    const apiMethod = data.apiMethod || RouterApiMethod.AUTO;

    // Initial status determined by optional connectivity test
    let initialStatus: RouterStatus = RouterStatus.OFFLINE;
    let initialModel: string | null = null;
    let initialRosVersion: string | null = null;
    let initialIdentity: string | null = null;
    let lastSeen: Date | null = null;
    let majorVersion: number | null = null;
    let minorVersion: number | null = null;
    let capabilities: any = null;

    // Handle SSTP VPN Credentials and IP allocation
    let vpnIp: string | null = null;
    let vpnUsername: string | null = null;
    let encryptedVpnSecret: string | null = null;
    let vpnCreds: { username: string; passwordPlain: string } | null = null;

    if (connectionMethod === RouterConnectionMethod.SSTP_TUNNEL) {
      vpnIp = data.vpnIp?.trim() || (await this.sstpVpnService.allocateNextVpnIp());
      vpnCreds = this.sstpVpnService.generateVpnCredentials();
      vpnUsername = vpnCreds.username;
      encryptedVpnSecret = encryptCredential(vpnCreds.passwordPlain);
      initialStatus = RouterStatus.OFFLINE;
    }

    const effectiveHost = (host || vpnIp || '').trim();

    if (!name || !effectiveHost || !username || !password) {
      throw new BadRequestException(
        'Missing required router registration fields: name, host, username, password',
      );
    }

    // Tenant-isolated unique check
    const existing = await prisma.router.findUnique({
      where: {
        organizationId_host: {
          organizationId,
          host: effectiveHost,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Router with host '${effectiveHost}' already exists in your organization ("${existing.name}")`,
      );
    }

    const encryptedCredential = encryptCredential(password);

    if (testOnRegister && connectionMethod !== RouterConnectionMethod.SSTP_TUNNEL) {
      try {
        const testRes = await this.executeWithRetryAndTimeout(
          'testOnRegister',
          () =>
            this.mikrotikClient.testConnection({
              host: effectiveHost,
              port: parsedPort,
              username,
              password,
              timeoutMs: 2500,
              connectionMethod,
              apiMethod,
            }),
          { password, maxRetries: 0 },
        );

        if (testRes.success) {
          initialStatus = RouterStatus.ONLINE;
          initialModel = testRes.model || null;
          initialRosVersion = testRes.rosVersion || null;
          initialIdentity = testRes.identity || null;
          majorVersion = testRes.majorVersion ?? null;
          minorVersion = testRes.minorVersion ?? null;
          capabilities = testRes.capabilities || null;
          lastSeen = new Date();
        } else {
          initialStatus = RouterStatus.ERROR;
        }
      } catch (err: any) {
        this.logger.warn(
          `Initial connection test failed during router registration for ${host}: ${err.message}`,
        );
        initialStatus = RouterStatus.UNREACHABLE;
      }
    }

    const router = await prisma.$transaction(async (tx) => {
      const created = await tx.router.create({
        data: {
          organizationId,
          name,
          host: effectiveHost,
          port: parsedPort,
          username,
          encryptedCredential,
          status: initialStatus,
          lastSeen,
          model: initialModel,
          rosVersion: initialRosVersion,
          identity: initialIdentity,
          radiusSecret,
          connectionMethod,
          apiMethod,
          vpnIp,
          vpnUsername,
          encryptedVpnSecret,
          majorVersion,
          minorVersion,
          capabilities,
        },
      });

      // Synchronize with FreeRADIUS nas table if radiusSecret is configured
      if (radiusSecret) {
        await tx.nas.upsert({
          where: { nasname: effectiveHost },
          update: { secret: radiusSecret, shortname: name },
          create: {
            nasname: effectiveHost,
            shortname: name,
            type: 'mikrotik',
            secret: radiusSecret,
            description: `Provisioned for org ${organizationId}`,
          },
        });

        // Also add VPN IP to NAS if SSTP is configured
        if (vpnIp) {
          await tx.nas.upsert({
            where: { nasname: vpnIp },
            update: { secret: radiusSecret, shortname: `${name}-vpn` },
            create: {
              nasname: vpnIp,
              shortname: `${name}-vpn`,
              type: 'mikrotik',
              secret: radiusSecret,
              description: `SSTP VPN for org ${organizationId}`,
            },
          });
        }
      }

      // Security Audit Log: Router created
      await tx.auditLog.create({
        data: {
          organizationId,
          action: 'CREATE' as any,
          entityType: 'ROUTER',
          entityId: created.id,
          details: {
            name: created.name,
            host: created.host,
            port: created.port,
            connectionMethod: created.connectionMethod,
            vpnIp: created.vpnIp,
          },
        },
      });

      return created;
    });

    if (vpnCreds && vpnIp) {
      await this.sstpVpnService.syncChapSecrets({
        username: vpnCreds.username,
        passwordPlain: vpnCreds.passwordPlain,
        vpnIp,
      });
    }

    this.logger.log(
      `Registered router '${router.name}' (${router.host}:${router.port}, method: ${router.connectionMethod}) for organization ${organizationId}`,
    );
    return sanitizeRouter(router);
  }

  /**
   * Lists all routers owned by the organization. Sanitizes credentials from output.
   */
  async listRouters(organizationId: string): Promise<RouterDto[]> {
    const routers = await prisma.router.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return sanitizeRouters(routers);
  }

  /**
   * Retrieves a specific router by ID with organization verification.
   */
  async getRouterById(organizationId: string, id: string): Promise<RouterDto> {
    const router = await prisma.router.findFirst({
      where: { id, organizationId },
    });

    if (!router) {
      throw new NotFoundException('Router not found in your organization');
    }

    return sanitizeRouter(router);
  }

  /**
   * Updates router parameters. If a new password is provided, it is re-encrypted.
   */
  async updateRouter(
    organizationId: string,
    id: string,
    data: UpdateRouterInput,
  ): Promise<RouterDto> {
    const router = await prisma.router.findFirst({
      where: { id, organizationId },
    });

    if (!router) {
      throw new NotFoundException('Router not found in your organization');
    }

    const updateData: any = {};
    if (data.name) updateData.name = data.name.trim();
    if (data.host) updateData.host = data.host.trim();
    if (data.username) updateData.username = data.username.trim();
    if (data.status) updateData.status = data.status;
    if (data.connectionMethod) updateData.connectionMethod = data.connectionMethod;
    if (data.apiMethod) updateData.apiMethod = data.apiMethod;
    if (data.vpnIp) updateData.vpnIp = data.vpnIp.trim();
    if (data.radiusSecret !== undefined && data.radiusSecret !== null) {
      updateData.radiusSecret = String(data.radiusSecret).trim();
    }

    if (data.port !== undefined && data.port !== null) {
      const rawPort = Number(data.port);
      if (Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535) {
        updateData.port = rawPort;
      }
    }

    if (data.password) {
      updateData.encryptedCredential = encryptCredential(data.password);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.router.update({
        where: { id },
        data: updateData,
      });

      if (updateData.radiusSecret !== undefined || updateData.host !== undefined) {
        const targetHost = updateData.host || router.host;
        const targetSecret = updateData.radiusSecret || router.radiusSecret || crypto.randomBytes(16).toString('hex');
        const targetName = updateData.name || router.name;

        await tx.nas.upsert({
          where: { nasname: targetHost },
          update: { secret: targetSecret, shortname: targetName },
          create: {
            nasname: targetHost,
            shortname: targetName,
            type: 'mikrotik',
            secret: targetSecret,
            description: `Updated for org ${organizationId}`,
          },
        });
      }

      // Security Audit Log: Router updated
      await tx.auditLog.create({
        data: {
          organizationId,
          action: 'UPDATE' as any,
          entityType: 'ROUTER',
          entityId: res.id,
          details: {
            name: res.name,
            host: res.host,
            port: res.port,
            connectionMethod: res.connectionMethod,
          },
        },
      });

      return res;
    });

    return sanitizeRouter(updated);
  }

  /**
   * Deletes router from organization and cleans up FreeRADIUS nas entry.
   */
  async deleteRouter(organizationId: string, id: string): Promise<{ success: boolean }> {
    const router = await prisma.router.findFirst({
      where: { id, organizationId },
    });

    if (!router) {
      throw new NotFoundException('Router not found in your organization');
    }

    await prisma.$transaction(async (tx) => {
      await tx.router.delete({ where: { id } });
      await tx.nas.deleteMany({ where: { nasname: router.host } });
      if (router.vpnIp) {
        await tx.nas.deleteMany({ where: { nasname: router.vpnIp } });
      }

      // Security Audit Log: Router deleted
      await tx.auditLog.create({
        data: {
          organizationId,
          action: 'DELETE' as any,
          entityType: 'ROUTER',
          entityId: router.id,
          details: {
            name: router.name,
            host: router.host,
          },
        },
      });
    });

    if (router.vpnUsername) {
      await this.sstpVpnService.removeChapSecrets(router.vpnUsername);
    }

    return { success: true };
  }

  /**
   * Tests connection to MikroTik router, updates status, lastSeen, model, ROS version, and capabilities.
   */
  async testConnection(organizationId: string, routerId: string): Promise<TestConnectionResult> {
    const { router, config } = await this.resolveConnection(organizationId, routerId);

    try {
      const result = await this.executeWithRetryAndTimeout(
        'testConnection',
        () => this.mikrotikClient.testConnection(config),
        { password: config.password },
      );

      // If manual test succeeds, update online state and telemetry
      if (result.success) {
        const existingCapabilities = (router.capabilities as any) || {};
        const updatedCapabilities = {
          ...existingCapabilities,
          consecutiveFailures: 0,
          isDegraded: false,
          isStale: false,
          latencyMs: result.latencyMs,
          lastHealthCheck: new Date().toISOString(),
        };

        const updateData: any = {
          status: RouterStatus.ONLINE,
          lastSeen: new Date(),
          identity: result.identity || router.identity,
          model: result.model || router.model,
          rosVersion: result.rosVersion || router.rosVersion,
          majorVersion: result.majorVersion ?? router.majorVersion,
          minorVersion: result.minorVersion ?? router.minorVersion,
          capabilities: updatedCapabilities,
          lastError: null,
        };
        if (router.onboardingStatus === RouterOnboardingStatus.CLAIMED) {
          updateData.onboardingStatus = RouterOnboardingStatus.VERIFIED;
        }

        await prisma.router.update({
          where: { id: router.id },
          data: updateData,
        });
      } else {
        // Manual probe failed: preserve authoritative worker health state and telemetry.
        // Record manual probe metadata without forcing router status to ERROR/OFFLINE.
        const existingCapabilities = (router.capabilities as any) || {};
        await prisma.router.update({
          where: { id: router.id },
          data: {
            capabilities: {
              ...existingCapabilities,
              lastManualProbeAttempt: new Date().toISOString(),
              lastManualProbeError: result.errorMessage || 'Manual connection test failed',
            },
            lastError: result.errorMessage || null,
          },
        });
      }

      return result;
    } catch (err: any) {
      const safeErrorMsg = sanitizeMessage(err.message, [config.password]);

      // Preserve existing router status and telemetry on manual probe exception
      const existingCapabilities = (router.capabilities as any) || {};
      await prisma.router.update({
        where: { id: router.id },
        data: {
          capabilities: {
            ...existingCapabilities,
            lastManualProbeAttempt: new Date().toISOString(),
            lastManualProbeError: safeErrorMsg,
          },
          lastError: safeErrorMsg,
        },
      });

      return {
        success: false,
        errorMessage: safeErrorMsg,
      };
    }
  }

  /**
   * Generates a copyable, version-tailored MikroTik CLI setup script for SSTP onboarding.
   */
  async getSstpScript(
    organizationId: string,
    routerId: string,
    version?: 'v6' | 'v7',
  ): Promise<SstpConfigResult> {
    const router = await prisma.router.findFirst({
      where: { id: routerId, organizationId },
    });

    if (!router) {
      throw new NotFoundException('Router not found in your organization');
    }

    let vpnPasswordPlain = 'VpnSecret123#';
    if (router.encryptedVpnSecret) {
      try {
        vpnPasswordPlain = decryptCredential(router.encryptedVpnSecret);
      } catch {
        vpnPasswordPlain = 'VpnSecret123#';
      }
    }

    let targetVersion: 'v6' | 'v7' = version || 'v7';
    if (!version && router.rosVersion && router.rosVersion.startsWith('6.')) {
      targetVersion = 'v6';
    }

    const vpnIp = router.vpnIp || '10.200.0.2';
    const vpnUsername = router.vpnUsername || `rtr_${router.id.replace(/-/g, '').slice(0, 6)}`;

    const sstpResult = this.sstpVpnService.generateMikrotikScript({
      routerName: router.name,
      vpnIp,
      vpnUsername,
      vpnPasswordPlain,
      radiusSecret: router.radiusSecret || crypto.randomBytes(16).toString('hex'),
      version: targetVersion,
    });

    sstpResult.routerId = router.id;
    return sstpResult;
  }

  /**
   * Fetches router identity (/system/identity) via MikrotikClient.
   */
  async getRouterIdentity(organizationId: string, routerId: string): Promise<RouterIdentity> {
    const { config } = await this.resolveConnection(organizationId, routerId);
    return this.executeWithRetryAndTimeout(
      'getRouterIdentity',
      () => this.mikrotikClient.getRouterIdentity(config),
      { password: config.password },
    );
  }

  /**
   * Queries hardware board, CPU load, and memory telemetry.
   */
  async getSystemResources(organizationId: string, routerId: string): Promise<SystemResources> {
    const { router, config } = await this.resolveConnection(organizationId, routerId);
    try {
      return await this.executeWithRetryAndTimeout(
        'getSystemResources',
        () => this.mikrotikClient.getSystemResources({ ...config, timeoutMs: 3000 }),
        { maxRetries: 1, password: config.password },
      );
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err;
      const cap = router.capabilities as any;
      if (cap && cap.cpuLoad !== undefined) {
        return {
          cpuLoad: cap.cpuLoad,
          freeMemory: cap.freeMemory,
          totalMemory: cap.totalMemory,
          uptime: cap.uptime,
          version: router.rosVersion || '',
          boardName: router.model || '',
          isStale: true,
        } as any;
      }
      throw err;
    }
  }

  /**
   * Queries real-time active PPPoE subscriber sessions from router.
   */
  async getActivePppSessions(organizationId: string, routerId: string): Promise<ActivePppSession[]> {
    const { config } = await this.resolveConnection(organizationId, routerId);
    return this.executeWithRetryAndTimeout(
      'getActivePppSessions',
      () => this.mikrotikClient.getActivePppSessions({ ...config, timeoutMs: 3500 }),
      { maxRetries: 1, password: config.password },
    );
  }

  /**
   * Queries all interfaces on the router.
   */
  async getInterfaces(organizationId: string, routerId: string): Promise<RouterInterface[]> {
    const { config } = await this.resolveConnection(organizationId, routerId);
    return this.executeWithRetryAndTimeout(
      'getInterfaces',
      () => this.mikrotikClient.getInterfaces({ ...config, timeoutMs: 3500 }),
      { maxRetries: 1, password: config.password },
    );
  }

  /**
   * Queries real-time traffic statistics for a specific interface.
   * Uses fast-fail (maxRetries: 0) and lean 2500ms timeout for high-frequency polling.
   */
  async getInterfaceTraffic(
    organizationId: string,
    routerId: string,
    interfaceName: string,
  ): Promise<InterfaceTraffic> {
    const { config } = await this.resolveConnection(organizationId, routerId);
    return this.executeWithRetryAndTimeout(
      'getInterfaceTraffic',
      () => this.mikrotikClient.getInterfaceTraffic({ ...config, timeoutMs: 2500 }, interfaceName),
      { maxRetries: 0, password: config.password },
    );
  }

  /**
   * Retrieves the ISPCRM Root CA certificate for client verification.
   */
  getRootCaCertificate(): string {
    return this.sstpVpnService.getRootCaCertificate();
  }

  /**
   * Provisions a new router onboarding record for a tenant.
   * Generates a 32-byte single-use setupToken, hashes it at rest (SHA-256),
   * allocates an SSTP management IP, provisions dedicated credentials,
   * generates an idempotent setup script, and records an immutable audit log.
   */
  async createOnboardingRouter(
    organizationId: string,
    dto: CreateOnboardingRouterDto,
    operatorContext?: { userId: string; email: string },
  ): Promise<{
    router: RouterDto;
    setupToken: string;
    script: string;
    instructions: string;
    expiresAt: Date;
    tokenExpiresAt: string;
  }> {
    const name = dto.name.trim();
    const connectionMethod = dto.connectionMethod || RouterConnectionMethod.SSTP_TUNNEL;
    const apiMethod = dto.apiMethod || RouterApiMethod.AUTO;
    const targetRosVersion: 'v6' | 'v7' = dto.rosVersion || 'v7';
    const parsedPort =
      dto.port && Number.isInteger(dto.port) && dto.port > 0
        ? dto.port
        : targetRosVersion === 'v6'
        ? 8728
        : 80;

    let vpnIp: string | null = null;
    let vpnUsername: string | null = null;
    let encryptedVpnSecret: string | null = null;
    let vpnCreds: { username: string; passwordPlain: string } | null = null;

    let apiUsername = 'ispcrm';
    let apiPasswordPlain = '';
    let effectiveHost = '';

    if (connectionMethod === RouterConnectionMethod.SSTP_TUNNEL) {
      vpnIp = await this.sstpVpnService.allocateNextVpnIp();
      vpnCreds = this.sstpVpnService.generateVpnCredentials();
      vpnUsername = vpnCreds.username;
      encryptedVpnSecret = encryptCredential(vpnCreds.passwordPlain);

      // Generate a strong, dedicated random password for the MikroTik ISPCRM API management user
      apiPasswordPlain = `Isp!${crypto.randomBytes(9).toString('base64url')}${crypto.randomInt(10, 99)}#`;
      effectiveHost = vpnIp;
    } else {
      // DIRECT_API
      if (!dto.host?.trim() || !dto.username?.trim() || !dto.password) {
        throw new BadRequestException('Direct API requires host, username, and password');
      }
      effectiveHost = dto.host.trim();
      apiUsername = dto.username.trim();
      apiPasswordPlain = dto.password;
    }

    // Tenant-isolated unique check
    const existing = await prisma.router.findUnique({
      where: {
        organizationId_host: {
          organizationId,
          host: effectiveHost,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Router with host '${effectiveHost}' already exists in your organization ("${existing.name}")`,
      );
    }

    // Generate high-entropy 32-byte (256-bit) setup token
    const rawSetupToken = `tok_sec_${crypto.randomBytes(32).toString('hex')}`;
    const setupTokenHash = crypto.createHash('sha256').update(rawSetupToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const encryptedCredential = encryptCredential(apiPasswordPlain);
    const radiusSecret = crypto.randomBytes(16).toString('hex');

    // Create router and FreeRADIUS NAS profile in an atomic transaction
    const router = await prisma.$transaction(async (tx) => {
      const created = await tx.router.create({
        data: {
          organizationId,
          name,
          host: effectiveHost,
          port: parsedPort,
          username: apiUsername,
          encryptedCredential,
          status: RouterStatus.OFFLINE,
          onboardingStatus: RouterOnboardingStatus.PENDING_SETUP,
          setupTokenHash,
          setupTokenExpiresAt: expiresAt,
          radiusSecret,
          connectionMethod,
          apiMethod,
          vpnIp,
          vpnUsername,
          encryptedVpnSecret,
        },
      });

      // Synchronize with FreeRADIUS nas table for the assigned private VPN IP
      if (vpnIp && radiusSecret) {
        await tx.nas.upsert({
          where: { nasname: vpnIp },
          update: {
            secret: radiusSecret,
            shortname: `${name}-vpn`,
          },
          create: {
            nasname: vpnIp,
            shortname: `${name}-vpn`,
            type: 'mikrotik',
            secret: radiusSecret,
            description: `SSTP VPN for org ${organizationId}`,
          },
        });
      } else if (connectionMethod === RouterConnectionMethod.DIRECT_API && effectiveHost && radiusSecret) {
        await tx.nas.upsert({
          where: { nasname: effectiveHost },
          update: {
            secret: radiusSecret,
            shortname: name,
          },
          create: {
            nasname: effectiveHost,
            shortname: name,
            type: 'mikrotik',
            secret: radiusSecret,
            description: `Direct API for org ${organizationId}`,
          },
        });
      }

      return created;
    });

    // If SSTP, sync credentials to chap-secrets immediately so server is ready when MikroTik connects
    if (vpnCreds && vpnIp) {
      await this.sstpVpnService.syncChapSecrets({
        username: vpnCreds.username,
        passwordPlain: vpnCreds.passwordPlain,
        vpnIp,
      });
    }

    // Generate version-tailored MikroTik script
    const scriptResult = this.sstpVpnService.generateMikrotikScript({
      routerName: router.name,
      routerId: router.id,
      organizationId,
      vpnIp: vpnIp || effectiveHost,
      vpnUsername: vpnUsername || '',
      vpnPasswordPlain: vpnCreds?.passwordPlain || '',
      apiUsername,
      apiPasswordPlain,
      setupToken: rawSetupToken,
      radiusSecret,
      version: targetRosVersion,
    });

    // Validate operator user id if provided for audit log
    let validAdminUserId: string | null = null;
    if (operatorContext?.userId) {
      const exists = await prisma.adminUser.findUnique({
        where: { id: operatorContext.userId },
        select: { id: true },
      });
      if (exists) validAdminUserId = exists.id;
    }

    // Log audit action
    await prisma.auditLog.create({
      data: {
        organizationId,
        adminUserId: validAdminUserId,
        action: AuditAction.ROUTER_ONBOARDING_CREATED,
        entityType: 'ROUTER',
        entityId: router.id,
        details: {
          routerId: router.id,
          routerName: router.name,
          connectionMethod,
          onboardingStatus: RouterOnboardingStatus.PENDING_SETUP,
          expiresAt: expiresAt.toISOString(),
          operator: operatorContext?.email || 'TENANT_ADMIN',
        },
      },
    });

    return {
      router: sanitizeRouter(router),
      setupToken: rawSetupToken,
      script: scriptResult.script,
      instructions: 'Paste this script into MikroTik WinBox Terminal (New Terminal) and press Enter.',
      expiresAt,
      tokenExpiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Verifies a setup token, transitions router from PENDING_SETUP -> CLAIMED,
   * performs an end-to-end connection check over the VPN / endpoint,
   * and if successful, promotes the router to VERIFIED and ONLINE.
   */
  async claimRouter(
    organizationId: string,
    routerId: string,
    token: string,
    operatorContext?: { userId: string; email: string },
  ): Promise<{
    success: boolean;
    router: RouterDto;
    routerId: string;
    onboardingStatus: RouterOnboardingStatus;
    status: RouterStatus;
    message: string;
    latencyMs?: number;
  }> {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Setup token is required to claim router');
    }

    const router = await prisma.router.findFirst({
      where: { id: routerId, organizationId },
    });

    if (!router) {
      throw new NotFoundException('Router not found in your organization');
    }

    if (!token || !token.trim()) {
      throw new BadRequestException('Setup token is required to claim this router');
    }

    // Hash the candidate token with SHA-256
    const candidateHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    if (!router.setupTokenHash || router.setupTokenHash !== candidateHash) {
      throw new UnauthorizedException('Invalid setup token provided for this router');
    }

    if (router.setupTokenExpiresAt && router.setupTokenExpiresAt < new Date()) {
      throw new BadRequestException('Setup token has expired. Please generate a new onboarding request.');
    }

    if (router.setupTokenUsedAt && router.onboardingStatus !== RouterOnboardingStatus.CLAIMED) {
      throw new ConflictException('This setup token has already been used and cannot be reused');
    }

    // Mark token as used and set onboarding status to CLAIMED
    const claimedRouter = await prisma.router.update({
      where: { id: router.id },
      data: {
        setupTokenUsedAt: router.setupTokenUsedAt || new Date(),
        onboardingStatus: RouterOnboardingStatus.CLAIMED,
      },
    });

    // Record claim in audit log
    let validAdminUserId: string | null = null;
    if (operatorContext?.userId) {
      const exists = await prisma.adminUser.findUnique({
        where: { id: operatorContext.userId },
        select: { id: true },
      });
      if (exists) validAdminUserId = exists.id;
    }

    await prisma.auditLog.create({
      data: {
        organizationId,
        adminUserId: validAdminUserId,
        action: AuditAction.ROUTER_CLAIMED,
        entityType: 'ROUTER',
        entityId: router.id,
        details: {
          routerId: router.id,
          routerName: router.name,
          onboardingStatus: RouterOnboardingStatus.CLAIMED,
        },
      },
    });

    // Attempt connectivity and credential verification
    let verified = false;
    let failureReason = '';
    let updatedRouter = claimedRouter;

    try {
      const testResult = await this.testConnection(organizationId, router.id);
      if (testResult.success) {
        verified = true;
        // Promote to VERIFIED and ONLINE
        updatedRouter = await prisma.router.update({
          where: { id: router.id },
          data: {
            onboardingStatus: RouterOnboardingStatus.VERIFIED,
            status: RouterStatus.ONLINE,
            lastSeen: new Date(),
          },
        });

        await prisma.auditLog.create({
          data: {
            organizationId,
            adminUserId: validAdminUserId,
            action: AuditAction.ROUTER_VERIFIED,
            entityType: 'ROUTER',
            entityId: router.id,
            details: {
              routerId: router.id,
              routerName: router.name,
              onboardingStatus: RouterOnboardingStatus.VERIFIED,
              status: RouterStatus.ONLINE,
              latencyMs: testResult.latencyMs,
            },
          },
        });
      } else {
        failureReason = testResult.errorMessage || 'Router unreachable on management IP';
      }
    } catch (err: any) {
      failureReason = err.message || 'Connection verification failed';
    }

    return {
      success: verified,
      router: sanitizeRouter(updatedRouter),
      routerId: updatedRouter.id,
      onboardingStatus: updatedRouter.onboardingStatus as unknown as RouterOnboardingStatus,
      status: updatedRouter.status as unknown as RouterStatus,
      message: verified
        ? 'Router claimed and verified successfully! Online and ready for service.'
        : `Router claimed with token, but waiting for network connection: ${failureReason}`,
    };
  }

  /**
   * Public automated setup completion handshake endpoint triggered by MikroTik /tool fetch.
   * Finds the router by setupTokenHash and marks it CLAIMED.
   * SECURITY HARDENED:
   * - Fast-fail validation on token format (/^tok_sec_[a-f0-9]{64}$/).
   * - Generic uniform UnauthorizedException for invalid, expired, used, or non-existent tokens.
   * - Zero disclosure of router name, org ID, router ID, credentials, or internal IPs.
   * - Safe generic success response.
   */
  async claimByTokenPing(rawToken: string): Promise<{ success: boolean; message: string }> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException('Invalid or expired setup token');
    }

    const trimmed = rawToken.trim();
    // Setup tokens must be exactly 'tok_sec_' followed by 64 hexadecimal characters (32 bytes)
    if (!/^tok_sec_[a-f0-9]{64}$/.test(trimmed)) {
      throw new UnauthorizedException('Invalid or expired setup token');
    }

    const tokenHash = crypto.createHash('sha256').update(trimmed).digest('hex');

    const router = await prisma.router.findFirst({
      where: { setupTokenHash: tokenHash },
    });

    if (!router) {
      throw new UnauthorizedException('Invalid or expired setup token');
    }

    if (router.setupTokenUsedAt) {
      throw new UnauthorizedException('Invalid or expired setup token');
    }

    if (router.setupTokenExpiresAt && router.setupTokenExpiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired setup token');
    }

    await prisma.router.update({
      where: { id: router.id },
      data: {
        setupTokenUsedAt: new Date(),
        onboardingStatus: RouterOnboardingStatus.CLAIMED,
      },
    });

    // Attempt connectivity verification immediately
    try {
      const test = await this.testConnection(router.organizationId, router.id);
      if (test.success) {
        await prisma.router.update({
          where: { id: router.id },
          data: {
            onboardingStatus: RouterOnboardingStatus.VERIFIED,
            status: RouterStatus.ONLINE,
            lastSeen: new Date(),
          },
        });
      }
    } catch {
      // Ignored; can be verified from portal
    }

    return { success: true, message: 'Setup handshake processed' };
  }
}
