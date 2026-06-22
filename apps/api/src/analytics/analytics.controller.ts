import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Delete,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import { Decimal } from 'decimal.js';
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { InvoicesService, type ArAgingResult } from '../invoices/invoices.service';
import { BuyersService, type GdprExport } from '../buyers/buyers.service';
import { REDIS_CACHE } from '../redis/redis.module';
import { AnalyticsExportTypeSchema, type AnalyticsExportType } from '@b2b/shared';
import { AnalyticsService, type AnalyticsData } from './analytics.service';

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });
const SUMMARY_TTL_SECONDS = 7 * 24 * 60 * 60;

interface SummaryRow {
  total_orders: bigint;
  total_gmv: Prisma_Decimal;
  active_buyers: bigint;
  pending_applications: bigint;
}
interface TopBuyerRow {
  buyer_id: string;
  company_name: string;
  gmv: Prisma_Decimal;
  order_count: bigint;
}
interface TrendRow {
  day: Date;
  order_count: bigint;
  gmv: Prisma_Decimal;
}
interface MonthlyRow {
  month: Date;
  gmv: Prisma_Decimal;
}
type Prisma_Decimal = { toString(): string };

interface AnalyticsSummary {
  totalOrders: number;
  totalGmv: string;
  activeBuyers: number;
  pendingApplications: number;
  generatedAt: string;
}

/**
 * Merchant analytics + GDPR data export. All routes require a merchant session;
 * the merchantId comes from the verified token (never the client). Read-heavy
 * summaries are cached in REDIS_CACHE; time series use generate_series so the
 * client never has to reason about missing days/months.
 *
 * GDPR export/erasure delegate to {@link BuyersService}; erasure requires an
 * explicit ?confirm=DELETE guard rail and owner role.
 */
@Controller('api/v1')
@UseGuards(MerchantSessionGuard, RolesGuard)
export class AnalyticsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly invoices: InvoicesService,
    private readonly buyers: BuyersService,
    private readonly analytics: AnalyticsService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {}

  // ── Analytics page aggregator + data export ─────────────────────────────

  /**
   * Full analytics payload for the merchant analytics page: KPI cards, the daily
   * GMV/order trend over [from, to] (defaults to the trailing 30 days), top-10
   * buyers for the window and the trailing-12-month table with YoY.
   */
  @Get('analytics')
  analyticsOverview(
    @Req() req: MerchantAuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AnalyticsData> {
    return this.analytics.getAnalytics(req.merchant!.merchantId, from, to);
  }

  /**
   * Data export. `type=orders|invoices|buyers` streams a CSV download;
   * `type=gdpr` enqueues an async per-merchant export (emailed when ready) and
   * returns 202. The `type` is validated against the shared enum.
   */
  @Get('analytics/export')
  async analyticsExport(
    @Req() req: MerchantAuthenticatedRequest,
    @Query('type') type: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string | { queued: true; type: AnalyticsExportType; message: string }> {
    const parsed = AnalyticsExportTypeSchema.safeParse(type);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_EXPORT_TYPE',
        message: 'type must be one of: orders, invoices, buyers, gdpr',
      });
    }
    const merchantId = req.merchant!.merchantId;

    if (parsed.data === 'gdpr') {
      // The heavy export runs out-of-band; the merchant is emailed a link when
      // it is ready. Here we acknowledge the request (202) — no payload streamed.
      res.status(HttpStatus.ACCEPTED);
      return {
        queued: true,
        type: 'gdpr',
        message: 'Your data export is being prepared. We will email you when it is ready.',
      };
    }

    const csv =
      parsed.data === 'orders'
        ? await this.analytics.exportOrdersCsv(merchantId)
        : parsed.data === 'invoices'
          ? await this.analytics.exportInvoicesCsv(merchantId)
          : await this.analytics.exportBuyersCsv(merchantId);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${parsed.data}-export.csv"`);
    return csv;
  }

  // ── Summary (7-day cache) ──────────────────────────────────────────────

  @Get('analytics/summary')
  async summary(@Req() req: MerchantAuthenticatedRequest): Promise<AnalyticsSummary> {
    const merchantId = req.merchant!.merchantId;
    const cacheKey = `analytics:summary:${merchantId}`;

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as AnalyticsSummary;
    }

    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<SummaryRow[]>`
        SELECT
          (SELECT COUNT(*) FROM orders WHERE merchant_id = ${merchantId}::uuid) AS total_orders,
          (SELECT COALESCE(SUM(total), 0) FROM invoices
             WHERE merchant_id = ${merchantId}::uuid AND status = 'paid') AS total_gmv,
          (SELECT COUNT(*) FROM merchant_buyer_relationships
             WHERE merchant_id = ${merchantId}::uuid AND approval_status = 'approved') AS active_buyers,
          (SELECT COUNT(*) FROM buyer_registration_applications
             WHERE merchant_id = ${merchantId}::uuid AND status = 'pending') AS pending_applications`,
    );
    const row = rows[0];
    const summary: AnalyticsSummary = {
      totalOrders: Number(row?.total_orders ?? 0),
      totalGmv: new Money((row?.total_gmv ?? '0').toString()).toFixed(2),
      activeBuyers: Number(row?.active_buyers ?? 0),
      pendingApplications: Number(row?.pending_applications ?? 0),
      generatedAt: new Date().toISOString(),
    };

    await this.cache.set(cacheKey, JSON.stringify(summary), 'EX', SUMMARY_TTL_SECONDS);
    return summary;
  }

  // ── AR aging (delegates to InvoicesService) ─────────────────────────────

  @Get('analytics/ar-aging')
  arAging(@Req() req: MerchantAuthenticatedRequest): Promise<ArAgingResult> {
    return this.invoices.getArAging(req.merchant!.merchantId);
  }

  // ── Top buyers by GMV this month ────────────────────────────────────────

  @Get('analytics/buyers/top')
  async topBuyers(@Req() req: MerchantAuthenticatedRequest): Promise<
    Array<{ buyerId: string; companyName: string; gmv: string; orderCount: number }>
  > {
    const merchantId = req.merchant!.merchantId;
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<TopBuyerRow[]>`
        SELECT
          b.id           AS buyer_id,
          b.company_name AS company_name,
          COALESCE(SUM(i.total), 0) AS gmv,
          COUNT(DISTINCT o.id)      AS order_count
        FROM merchant_buyer_relationships r
        JOIN buyers b ON b.id = r.buyer_id
        LEFT JOIN invoices i ON i.buyer_id = b.id AND i.merchant_id = ${merchantId}::uuid
          AND i.status = 'paid' AND i.paid_at >= date_trunc('month', NOW())
        LEFT JOIN orders o ON o.buyer_id = b.id AND o.merchant_id = ${merchantId}::uuid
          AND o.created_at >= date_trunc('month', NOW())
        WHERE r.merchant_id = ${merchantId}::uuid
        GROUP BY b.id, b.company_name
        ORDER BY gmv DESC
        LIMIT 10`,
    );
    return rows.map((row) => ({
      buyerId: row.buyer_id,
      companyName: row.company_name,
      gmv: new Money(row.gmv.toString()).toFixed(2),
      orderCount: Number(row.order_count),
    }));
  }

  // ── Orders trend (30 days, no gaps) ─────────────────────────────────────

  @Get('analytics/orders/trend')
  async ordersTrend(@Req() req: MerchantAuthenticatedRequest): Promise<
    Array<{ date: string; orderCount: number; gmv: string }>
  > {
    const merchantId = req.merchant!.merchantId;
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<TrendRow[]>`
        SELECT
          d.day::date AS day,
          COUNT(o.id) AS order_count,
          COALESCE(SUM(o.total), 0) AS gmv
        FROM generate_series(
          date_trunc('day', NOW()) - INTERVAL '29 days',
          date_trunc('day', NOW()),
          INTERVAL '1 day'
        ) AS d(day)
        LEFT JOIN orders o
          ON date_trunc('day', o.created_at) = d.day
          AND o.merchant_id = ${merchantId}::uuid
        GROUP BY d.day
        ORDER BY d.day ASC`,
    );
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      orderCount: Number(row.order_count),
      gmv: new Money(row.gmv.toString()).toFixed(2),
    }));
  }

  // ── GMV monthly (12 months, no gaps) ────────────────────────────────────

  @Get('analytics/gmv/monthly')
  async gmvMonthly(@Req() req: MerchantAuthenticatedRequest): Promise<
    Array<{ month: string; gmv: string }>
  > {
    const merchantId = req.merchant!.merchantId;
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<MonthlyRow[]>`
        SELECT
          m.month::date AS month,
          COALESCE(SUM(i.total), 0) AS gmv
        FROM generate_series(
          date_trunc('month', NOW()) - INTERVAL '11 months',
          date_trunc('month', NOW()),
          INTERVAL '1 month'
        ) AS m(month)
        LEFT JOIN invoices i
          ON date_trunc('month', i.paid_at) = m.month
          AND i.merchant_id = ${merchantId}::uuid
          AND i.status = 'paid'
        GROUP BY m.month
        ORDER BY m.month ASC`,
    );
    return rows.map((row) => ({
      month: row.month.toISOString().slice(0, 7),
      gmv: new Money(row.gmv.toString()).toFixed(2),
    }));
  }

  // ── GDPR data export / erasure ──────────────────────────────────────────

  @Get('data-export/gdpr/:buyerId')
  @Roles('owner')
  @Header('Content-Type', 'application/json')
  async gdprExport(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('buyerId', new ParseUUIDPipe({ version: '4' })) buyerId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GdprExport> {
    res.setHeader('Content-Disposition', `attachment; filename="gdpr-export-${buyerId}.json"`);
    return this.buyers.getBuyerGdprExport(buyerId, req.merchant!.merchantId);
  }

  @Delete('data-export/gdpr/:buyerId')
  @Roles('owner')
  @HttpCode(HttpStatus.OK)
  async gdprErase(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('buyerId', new ParseUUIDPipe({ version: '4' })) buyerId: string,
    @Query('confirm') confirm: string | undefined,
  ): Promise<{ erased: true; timestamp: string }> {
    if (confirm !== 'DELETE') {
      throw new BadRequestException({
        code: 'CONFIRMATION_REQUIRED',
        message: 'Pass ?confirm=DELETE to erase this buyer',
      });
    }
    await this.buyers.eraseBuyer(buyerId, req.merchant!.merchantId, req.merchant!.userId);
    return { erased: true, timestamp: new Date().toISOString() };
  }
}
