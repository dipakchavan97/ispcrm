import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';

interface MemoryBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private redisClient: Redis | null = null;
  private isRedisConnected = false;
  private readonly memoryStore = new Map<string, MemoryBucket>();

  // Default fallback limit: 300 requests per 60 seconds per IP
  private readonly defaultLimit = 300;
  private readonly defaultTtlSec = 60;

  constructor(private readonly reflector: Reflector) {
    this.initRedis();
  }

  private initRedis() {
    try {
      const host = process.env.REDIS_HOST || 'localhost';
      const port = Number(process.env.REDIS_PORT) || 6379;

      this.redisClient = new Redis({
        host,
        port,
        connectTimeout: 500,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
      });

      this.redisClient.connect().then(() => {
        this.isRedisConnected = true;
        this.logger.log(`RateLimitGuard connected to Redis at ${host}:${port}`);
      }).catch((err) => {
        this.isRedisConnected = false;
        this.logger.warn(`RateLimitGuard using in-memory store: Redis connection skipped (${err.message})`);
      });

      this.redisClient.on('connect', () => {
        this.isRedisConnected = true;
      });

      this.redisClient.on('error', () => {
        this.isRedisConnected = false;
      });
    } catch {
      this.isRedisConnected = false;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rateLimitConfig = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const limit = rateLimitConfig?.limit ?? this.defaultLimit;
    const ttlSec = rateLimitConfig?.ttlSec ?? this.defaultTtlSec;
    const keyPrefix = rateLimitConfig?.keyPrefix ?? 'global';

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.connection?.remoteAddress ||
      '127.0.0.1';

    const emailSuffix = req.body?.email ? `:${String(req.body.email).toLowerCase().trim()}` : '';
    const key = `ratelimit:${keyPrefix}:${clientIp}${emailSuffix}`;

    let currentCount = 1;
    let timeToReset = ttlSec;

    if (this.isRedisConnected && this.redisClient) {
      try {
        const count = await this.redisClient.incr(key);
        if (count === 1) {
          await this.redisClient.expire(key, ttlSec);
        } else {
          timeToReset = Math.max(1, await this.redisClient.ttl(key));
        }
        currentCount = count;
      } catch {
        // Fallback to memory store if Redis operation fails
        currentCount = this.incrementMemory(key, ttlSec);
      }
    } else {
      currentCount = this.incrementMemory(key, ttlSec);
    }

    const remaining = Math.max(0, limit - currentCount);

    if (res.setHeader) {
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', timeToReset);
    }

    if (currentCount > limit) {
      if (res.setHeader) {
        res.setHeader('Retry-After', timeToReset);
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests. Please slow down and try again later.',
          error: 'Too Many Requests',
          retryAfter: timeToReset,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private incrementMemory(key: string, ttlSec: number): number {
    const now = Date.now();
    const existing = this.memoryStore.get(key);

    if (!existing || now > existing.resetAt) {
      this.memoryStore.set(key, { count: 1, resetAt: now + ttlSec * 1000 });
      return 1;
    }

    existing.count += 1;
    return existing.count;
  }
}
