import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';
import { BullModule } from '@nestjs/bullmq';
import { Redis } from 'ioredis';

import { envValidationSchema } from './config/env.validation';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule, REDIS_CACHE } from './redis/redis.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { GraphQLModule } from './graphql/graphql.module';
import { MerchantsModule } from './merchants/merchants.module';
import { BuyersModule } from './buyers/buyers.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PricingModule } from './pricing/pricing.module';
import { OrdersModule } from './orders/orders.module';
import { InvoicesModule } from './invoices/invoices.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BillingModule } from './billing/billing.module';
import { BnplModule } from './bnpl/bnpl.module';

import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { CorrelationMiddleware } from './tracing/correlation.middleware';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';

@Module({
  imports: [
    // Config (global) with fail-fast Joi validation.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    AppConfigModule,

    // Infrastructure (all global).
    PrismaModule,
    RedisModule,
    CryptoModule,

    // Rate limiting storage shares the cache Redis instance.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CACHE],
      useFactory: (cache: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 200 }],
        storage: new ThrottlerStorageRedisService(cache),
      }),
    }),

    // BullMQ runs exclusively on the queue Redis instance. It manages its own
    // connections, so we hand it connection options parsed from the queue URL
    // rather than the shared ioredis instance (whose bundled types differ from
    // BullMQ's). maxRetriesPerRequest: null is required by BullMQ.
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const url = new URL(config.get('REDIS_QUEUE_URL'));
        return {
          connection: {
            host: url.hostname,
            port: url.port ? Number(url.port) : 6379,
            username: url.username || undefined,
            password: url.password || undefined,
            db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
            maxRetriesPerRequest: null,
            ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
          },
        };
      },
    }),

    ScheduleModule.forRoot(),

    // Domain modules.
    AuthModule,
    MerchantsModule,
    BuyersModule,
    WebhooksModule,
    PricingModule,
    OrdersModule,
    InvoicesModule,
    AnalyticsModule,
    BillingModule,
    BnplModule,

    // API surfaces.
    GraphQLModule,
    HealthModule,
  ],
  providers: [
    // Global IP-tier rate limiting (entity tiers apply once auth has run).
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Opens the RLS tenant scope for the request once a session is resolved.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation id first so every later log/span is tagged.
    consumer.apply(CorrelationMiddleware).forRoutes('*');
    // Idempotency self-filters to POST/PATCH carrying an Idempotency-Key.
    consumer.apply(IdempotencyMiddleware).forRoutes('*');
  }
}
