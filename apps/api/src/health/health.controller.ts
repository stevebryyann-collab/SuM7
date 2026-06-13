import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { REDIS_CACHE, REDIS_QUEUE } from '../redis/redis.module';

/**
 * Liveness and readiness probes for Railway / Kubernetes.
 *   /health/live  — process is up (no dependencies checked).
 *   /health/ready — DB + both Redis instances reachable; 503 otherwise.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    @Inject(REDIS_QUEUE) private readonly queue: Redis,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    const failing: string[] = [];

    await Promise.all([
      this.checkDatabase().catch(() => failing.push('database')),
      this.ping(this.cache).catch(() => failing.push('redis_cache')),
      this.ping(this.queue).catch(() => failing.push('redis_queue')),
    ]);

    if (failing.length > 0) {
      res.status(503).json({ status: 'unavailable', failing });
      return;
    }
    res.status(200).json({ status: 'ok' });
  }

  private async checkDatabase(): Promise<void> {
    // Health checks are a trusted system path → bypass RLS.
    await this.merchantContext.runAsSystem(() => this.prisma.$queryRaw`SELECT 1`);
  }

  private async ping(client: Redis): Promise<void> {
    const pong = await client.ping();
    if (pong !== 'PONG') {
      throw new Error('unexpected ping response');
    }
  }
}
