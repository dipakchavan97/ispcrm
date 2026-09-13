import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  // Security: Restrict CORS origins strictly
  const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS;
  const defaultAllowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4000',
    'http://127.0.0.1:4000',
  ];
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((o) => o.trim())
    : defaultAllowedOrigins;

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile clients, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }
      if (
        allowedOrigins.includes(origin) ||
        (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy violation: Origin '${origin}' is not permitted by Access-Control-Allow-Origin.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Idempotency-Key',
      'X-Webhook-Signature',
    ],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Production Security Sanity Checks
  if (process.env.NODE_ENV === 'production') {
    const defaultSecret = 'super-secret-jwt-key-change-in-production';
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === defaultSecret || process.env.JWT_SECRET.length < 32) {
      logger.warn(
        'SECURITY ALERT: Running in production with default or weak JWT_SECRET! Please configure a high-entropy secret (>=32 chars).',
      );
    }
    if (!process.env.ROUTER_ENCRYPTION_KEY || process.env.ROUTER_ENCRYPTION_KEY.length < 32) {
      logger.warn(
        'SECURITY ALERT: ROUTER_ENCRYPTION_KEY is not set or less than 32 characters! Set a dedicated 256-bit encryption key.',
      );
    }
  }

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // Swagger OpenAPI Documentation
  const config = new DocumentBuilder()
    .setTitle('ISP CRM, Billing & Bandwidth Management API')
    .setDescription(
      'Modular Monolith REST API for Indian ISPs, PPPoE subscriber management, and FreeRADIUS / MikroTik orchestration.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`API application running on: http://localhost:${port}/api`);
  logger.log(`Swagger documentation available at: http://localhost:${port}/api/docs`);
  logger.log(`Health check probe: http://localhost:${port}/api/health`);
}

bootstrap();
