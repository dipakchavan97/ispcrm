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
} from '@isp-crm/shared';
import { MIKROTIK_CLIENT, MikrotikClient } from './clients/mikrotik-client.interface';
import { SstpVpnService } from './sstp-vpn.service';
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

    // If SSTP tunnel is configured and VPN IP assigned, route management through private VPN IP
    const targetHost =
      router.connectionMethod === 'SSTP_TUNNEL' && router.vpnIp ? router.vpnIp : router.host;

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

      // Persist state updates on router
      const newStatus = result.success ? RouterStatus.ONLINE : RouterStatus.ERROR;
      await prisma.router.update({
        where: { id: router.id },
        data: {
          status: newStatus,
          lastSeen: new Date(),
          identity: result.identity || router.identity,
          model: result.model || router.model,
          rosVersion: result.rosVersion || router.rosVersion,
          majorVersion: result.majorVersion ?? router.majorVersion,
          minorVersion: result.minorVersion ?? router.minorVersion,
          capabilities: (result.capabilities as any) || router.capabilities,
          lastError: result.errorMessage || null,
        },
      });

      return result;
    } catch (err: any) {
      const isTimeout = err.code === 'ETIMEDOUT' || err instanceof GatewayTimeoutException;
      const failureStatus = isTimeout ? RouterStatus.UNREACHABLE : RouterStatus.ERROR;
      const safeErrorMsg = sanitizeMessage(err.message, [config.password]);

      await prisma.router.update({
        where: { id: router.id },
        data: {
          status: failureStatus,
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
    const { config } = await this.resolveConnection(organizationId, routerId);
    return this.executeWithRetryAndTimeout(
      'getSystemResources',
      () => this.mikrotikClient.getSystemResources(config),
      { password: config.password },
    );
  }

  /**
   * Queries real-time active PPPoE subscriber sessions from router.
   */
  async getActivePppSessions(organizationId: string, routerId: string): Promise<ActivePppSession[]> {
    const { config } = await this.resolveConnection(organizationId, routerId);
    return this.executeWithRetryAndTimeout(
      'getActivePppSessions',
      () => this.mikrotikClient.getActivePppSessions(config),
      { password: config.password },
    );
  }

  /**
   * Queries all interfaces on the router.
   */
  async getInterfaces(organizationId: string, routerId: string): Promise<RouterInterface[]> {
    const { config } = await this.resolveConnection(organizationId, routerId);
    return this.executeWithRetryAndTimeout(
      'getInterfaces',
      () => this.mikrotikClient.getInterfaces(config),
      { password: config.password },
    );
  }

  /**
   * Queries real-time traffic statistics for a specific interface.
   */
  async getInterfaceTraffic(
    organizationId: string,
    routerId: string,
    interfaceName: string,
  ): Promise<InterfaceTraffic> {
    const { config } = await this.resolveConnection(organizationId, routerId);
    return this.executeWithRetryAndTimeout(
      'getInterfaceTraffic',
      () => this.mikrotikClient.getInterfaceTraffic(config, interfaceName),
      { password: config.password },
    );
  }

  /**
   * Retrieves the ISPCRM Root CA certificate for client verification.
   */
  getRootCaCertificate(): string {
    return this.sstpVpnService.getRootCaCertificate();
  }
}
