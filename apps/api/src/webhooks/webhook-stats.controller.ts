import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { REDIS_CACHE } from '../redis/redis.module';
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/** Webhook-processing summary over the last 24h for one merchant's Shopify domain. */
export interface WebhookStats {
  windowHours: number;
  total: number;
  processed: number;
  failed: number;
  /** processed / total, as a 0–100 percentage (1dp), or null when no webhooks. */
  processingRatePct: number | null;
  /** Mean (processedAt − createdAt) over processed events, in ms, or null. */
  avgProcessingMs: number | null;
  lastReceivedAt: string | null;
}

interface WebhookStatsRow {
  total: bigint;
  processed: bigint;
  failed: bigint;
  avg_ms: number | string | null;
  last_received_at: Date | null;
}

/**
 * Merchant-facing webhook-processing stats for the System Health page. Separate
 * controller from {@link WebhooksController} because that class carries a
 * class-level {@link WebhookHmacGuard}; the stats route is a merchant-session
 * (NextAuth) read, not an HMAC-verified Shopify delivery. webhook_events is keyed
 * by `shopify_domain`, so the tenant is the verified session's domain.
 */
@Controller('webhooks')
@UseGuards(MerchantSessionGuard, RolesGuard)
export class WebhookStatsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {}

  @Get('stats')
  @Roles('owner', 'admin')
  async stats(@Req() req: MerchantAuthenticatedRequest): Promise<WebhookStats> {
    const merchant = req.merchant!;
    const cacheKey = `webhook:stats:${merchant.merchantId}`;

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as WebhookStats;
    }

    // webhook_events is a system-written table (no merchant RLS); scope by the
    // verified session's Shopify domain.
    const rows = await this.merchantContext.runAsSystem(() =>
      this.prisma.$queryRaw<WebhookStatsRow[]>`
        SELECT
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE status = 'processed')::bigint AS processed,
          COUNT(*) FILTER (WHERE status = 'dead_letter')::bigint AS failed,
          AVG(EXTRACT(EPOCH FROM (processed_at - created_at)) * 1000)
            FILTER (WHERE processed_at IS NOT NULL) AS avg_ms,
          MAX(created_at) AS last_received_at
        FROM webhook_events
        WHERE shopify_domain = ${merchant.shopifyDomain}
          AND created_at >= NOW() - INTERVAL '24 hours'`,
    );

    const row = rows[0];
    const total = Number(row?.total ?? 0);
    const processed = Number(row?.processed ?? 0);
    const failed = Number(row?.failed ?? 0);
    const avgProcessingMs =
      row?.avg_ms != null && Number.isFinite(Number(row.avg_ms)) ? Math.round(Number(row.avg_ms)) : null;
    const lastReceivedAt = row?.last_received_at ? new Date(row.last_received_at).toISOString() : null;
    const processingRatePct = total > 0 ? Math.round((processed / total) * 1000) / 10 : null;

    const result: WebhookStats = {
      windowHours: 24,
      total,
      processed,
      failed,
      processingRatePct,
      avgProcessingMs,
      lastReceivedAt,
    };

    await this.cache.set(cacheKey, JSON.stringify(result), 'EX', 60);
    return result;
  }
}
