import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
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
} from '@isp-crm/shared';
import { MIKROTIK_CLIENT, MikrotikClient } from './clients/mikrotik-client.interface';
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
          const safeMsg = sanitizeMessage(err.message || 'Unknown network error', options.password ? [options.password] : []);
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
      this.logger.error(`Failed to decrypt credentials for router ID: ${router.id}`);
      throw new BadGatewayException('Failed to decrypt stored router credentials');
    }

    const config: RouterConnectionConfig = {
      host: router.host,
      port: router.port,
      username: router.username,
      password: decryptedPassword,
      timeoutMs: 4000,
    };

    return { router, config };
  }

  /**
   * Registers a new MikroTik router entity for the organization.
   * Encrypts passwords immediately at rest with AES-256-GCM.
   * NEVER returns encryptedCredential or passwords.
   */
  async registerRouter(organizationId: string, data: RegisterRouterInput): Promise<RouterDto> {
    const {
      name,
      host,
      port = 8728,
      username,
      password,
      radiusSecret = 'testing123',
      testOnRegister = false,
    } = data;

    if (!name || !host || !username || !password) {
      throw new BadGatewayException('Missing required router registration fields (name, host, username, password)');
    }

    // Tenant-isolated unique check
    const existing = await prisma.router.findUnique({
      where: {
        organizationId_host: {
          organizationId,
          host,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Router with host '${host}' already exists in your organization`);
    }

    const encryptedCredential = encryptCredential(password);

    // Initial status determined by optional connectivity test
    let initialStatus: RouterStatus = RouterStatus.OFFLINE;
    let initialModel: string | null = null;
    let initialRosVersion: string | null = null;
    let initialIdentity: string | null = null;
    let lastSeen: Date | null = null;

    if (testOnRegister) {
      try {
        const testRes = await this.executeWithRetryAndTimeout(
          'testOnRegister',
          () =>
            this.mikrotikClient.testConnection({
              host,
              port,
              username,
              password,
              timeoutMs: 3000,
            }),
          { password },
        );

        if (testRes.success) {
          initialStatus = RouterStatus.ONLINE;
          initialModel = testRes.model || null;
          initialRosVersion = testRes.rosVersion || null;
          initialIdentity = testRes.identity || null;
          lastSeen = new Date();
        } else {
          initialStatus = RouterStatus.ERROR;
        }
      } catch (err: any) {
        this.logger.warn(`Initial connection test failed during router registration for ${host}: ${err.message}`);
        initialStatus = RouterStatus.UNREACHABLE;
      }
    }

    const router = await prisma.$transaction(async (tx) => {
      const created = await tx.router.create({
        data: {
          organizationId,
          name,
          host,
          port,
          username,
          encryptedCredential,
          status: initialStatus,
          lastSeen,
          model: initialModel,
          rosVersion: initialRosVersion,
          identity: initialIdentity,
          radiusSecret,
        },
      });

      // Synchronize with FreeRADIUS nas table if radiusSecret is configured
      if (radiusSecret) {
        await tx.nas.upsert({
          where: { nasname: host },
          update: { secret: radiusSecret },
          create: {
            nasname: host,
            shortname: name,
            type: 'mikrotik',
            secret: radiusSecret,
            description: `Provisioned for org ${organizationId}`,
          },
        });
      }

      return created;
    });

    this.logger.log(`Registered router '${router.name}' (${router.host}) for organization ${organizationId}`);
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
  async updateRouter(organizationId: string, id: string, data: UpdateRouterInput): Promise<RouterDto> {
    const router = await prisma.router.findFirst({
      where: { id, organizationId },
    });

    if (!router) {
      throw new NotFoundException('Router not found in your organization');
    }

    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.host) updateData.host = data.host;
    if (data.port) updateData.port = data.port;
    if (data.username) updateData.username = data.username;
    if (data.radiusSecret) updateData.radiusSecret = data.radiusSecret;
    if (data.status) updateData.status = data.status;

    if (data.password) {
      updateData.encryptedCredential = encryptCredential(data.password);
    }

    const updated = await prisma.router.update({
      where: { id },
      data: updateData,
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
    });

    return { success: true };
  }

  /**
   * Tests connection to MikroTik router, updates status, lastSeen, model, and ROS version.
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
        },
      });

      return result;
    } catch (err: any) {
      const isTimeout = err.code === 'ETIMEDOUT' || err instanceof GatewayTimeoutException;
      const failureStatus = isTimeout ? RouterStatus.UNREACHABLE : RouterStatus.ERROR;

      await prisma.router.update({
        where: { id: router.id },
        data: { status: failureStatus },
      });

      return {
        success: false,
        errorMessage: sanitizeMessage(err.message, [config.password]),
      };
    }
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
   * Fetches router system resources (/system/resource) via MikrotikClient.
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
   * Fetches active PPP / PPPoE sessions (/ppp/active) via MikrotikClient.
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
   * Fetches interfaces (/interface) via MikrotikClient.
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
   * Fetches live interface traffic (/interface/monitor-traffic) via MikrotikClient.
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
}

export { MikrotikService as RoutersService };
