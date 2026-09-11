import { Injectable } from '@nestjs/common';
import { prisma } from '@isp-crm/database';
import Redis from 'ioredis';

@Injectable()
export class HealthService {
  async checkOverall() {
    const dbStatus = await this.checkDatabase();
    const redisStatus = await this.checkRedis();

    const isHealthy = dbStatus.status === 'up' && redisStatus.status === 'up';

    return {
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      info: {
        database: dbStatus,
        redis: redisStatus,
      },
    };
  }

  async checkDatabase() {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'up' as const, message: 'Database connection operational' };
    } catch (error: any) {
      return {
        status: 'down' as const,
        message: error?.message || 'Database unreachable',
      };
    }
  }

  async checkRedis() {
    let client: Redis | null = null;
    try {
      const host = process.env.REDIS_HOST || 'localhost';
      const port = Number(process.env.REDIS_PORT) || 6379;
      client = new Redis({
        host,
        port,
        connectTimeout: 1000,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        enableOfflineQueue: false,
        lazyConnect: true,
      });

      client.on('error', () => {
        // Prevent unhandled error event on offline Redis
      });

      await client.connect();
      const pong = await client.ping();
      await client.quit();
      return pong === 'PONG'
        ? { status: 'up' as const, message: 'Redis ping successful' }
        : { status: 'down' as const, message: 'Unexpected ping response' };
    } catch (error: any) {
      if (client) {
        try {
          client.disconnect();
        } catch {
          // ignore disconnect errors
        }
      }
      return {
        status: 'down' as const,
        message: error?.message || 'Redis unreachable',
      };
    }
  }
}
