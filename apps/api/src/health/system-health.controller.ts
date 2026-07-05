import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { REDIS_CACHE, REDIS_QUEUE } from '../redis/redis.module';
import { CircuitBreakerFactory } from '../common/circuit-breaker/circuit-breaker.factory';
import { QueueHealthService, type QueueMetrics } from '../queues/queue-health.service';
import { MerchantSessionGuard } from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

type ServiceStatus = 'up' | 'down';
type BreakerState = 'open' | 'half-open' | 'closed';

interface BreakerSnapshot {
  name: string;
  state: BreakerState;
  stats: {
    fires: number;
    successes: number;
    failures: number;
    fallbacks: number;
    timeouts: number;
  };
}

/** Merchant-facing system-health snapshot powering /settings/health. */
export interface SystemHealthReport {
  checkedAt: string;
  services: {
    database: ServiceStatus;
    redisCache: ServiceStatus;
    redisQueue: ServiceStatus;
  };
  breakers: BreakerSnapshot[];
  queues: QueueMetrics[];
}

/**
 * Merchant-authenticated aggregator for the System Health page. The raw probes
 * (`/health/ready`, `/health/circuit-breakers`, `/health/queues`) are
 * unauthenticated internal endpoints meant to stay off the public ingress — so
 * the browser never calls them. This controller composes the same data behind
 * the merchant session guard (owner/admin only), giving merchants reliability
 * visibility without exposing internal probes.
 */
@Controller('system-health')
@UseGuards(MerchantSessionGuard, RolesGuard)
@Roles('owner', 'admin')
export class SystemHealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    @Inject(REDIS_QUEUE) private readonly queue: Redis,
    private readonly breakerFactory: CircuitBreakerFactory,
    private readonly queueHealth: QueueHealthService,
  ) {}

  @Get()
  async report(): Promise<SystemHealthReport> {
    const [database, redisCache, redisQueue, queueReport] = await Promise.all([
      this.checkDatabase(),
      this.ping(this.cache),
      this.ping(this.queue),
      this.queueHealth.getReport(),
    ]);

    const breakers = this.breakerFactory.getAll().map<BreakerSnapshot>((breaker) => ({
      name: breaker.name,
      state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
      stats: {
        fires: breaker.stats.fires,
        successes: breaker.stats.successes,
        failures: breaker.stats.failures,
        fallbacks: breaker.stats.fallbacks,
        timeouts: breaker.stats.timeouts,
      },
    }));

    return {
      checkedAt: new Date().toISOString(),
      services: { database, redisCache, redisQueue },
      breakers,
      queues: queueReport.queues,
    };
  }

  private async checkDatabase(): Promise<ServiceStatus> {
    try {
      // Health checks are a trusted system path → bypass RLS.
      await this.merchantContext.runAsSystem(() => this.prisma.$queryRaw`SELECT 1`);
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async ping(client: Redis): Promise<ServiceStatus> {
    try {
      const pong = await client.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
