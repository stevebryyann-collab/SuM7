/* eslint-disable import/first */
// OpenTelemetry MUST be initialized before any other import so that
// auto-instrumentation can patch http/express/pg/ioredis on first require.
import { shutdownTracing } from './tracing/tracing';

import 'reflect-metadata';
import {
  BadRequestException,
  Logger,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import type { Request, Response, NextFunction } from 'express';

import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import type { ApiFieldError } from '@b2b/shared';

const SHUTDOWN_TIMEOUT_MS = 30_000;

/** Flatten class-validator errors into the API's { field, message, code } shape. */
function flattenValidationErrors(errors: ValidationError[]): ApiFieldError[] {
  const out: ApiFieldError[] = [];
  const walk = (error: ValidationError, parentPath: string): void => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    if (error.constraints) {
      const [code, message] = Object.entries(error.constraints)[0] ?? ['invalid', 'Invalid value'];
      out.push({ field: path, message, code });
    }
    for (const child of error.children ?? []) {
      walk(child, path);
    }
  };
  for (const error of errors) walk(error, '');
  return out;
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // Sentry must be initialized before the app handles any request.
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.1,
      integrations: [nodeProfilingIntegration()],
    });
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Preserve the raw body (req.rawBody) for webhook HMAC verification.
    rawBody: true,
    bufferLogs: false,
  });

  const config = app.get(AppConfigService);

  // Trust the proxy (Railway/Vercel) so req.ip reflects the client.
  app.set('trust proxy', 1);

  // ── Security headers ──────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'style-src': ["'self'"],
        },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginEmbedderPolicy: { policy: 'require-corp' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  // Permissions-Policy is not set by helmet@7; add it explicitly.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // ── CORS (explicit allowlist, never wildcard) ─────────────────────────
  const allowedOrigins = config.allowedOrigins;
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Same-origin / server-to-server requests have no Origin header.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Request-Id',
      'X-Merchant-Context',
    ],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });

  // ── Global validation ─────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          errors: flattenValidationErrors(errors),
        }),
    }),
  );

  // Nest lifecycle hooks drive PrismaService/Redis disconnect on close.
  app.enableShutdownHooks();

  const port = config.get('API_PORT');
  await app.listen(port);
  logger.log(`API listening on :${port} (${config.get('NODE_ENV')})`);

  // ── Graceful shutdown ─────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Received ${signal}, draining (max ${SHUTDOWN_TIMEOUT_MS}ms)...`);

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      // app.close() runs onModuleDestroy/onApplicationShutdown across the app:
      // BullMQ workers stop consuming, Prisma disconnects, Redis clients quit.
      await app.close();
      await shutdownTracing();
      await Sentry.close(2000);
      clearTimeout(forceExit);
      logger.log('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error(`Error during shutdown: ${(error as Error).message}`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', error);
  process.exit(1);
});
