import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { subDays } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });

export interface AnalyticsKpis {
  gmv: string;
  orders: number;
  avgOrderValue: string;
  activeBuyers: number;
}

export interface AnalyticsTrendPoint {
  date: string;
  gmv: string;
  orderCount: number;
}

export interface AnalyticsTopBuyer {
  buyerId: string;
  companyName: string;
  gmv: string;
  orderCount: number;
  avgOrderValue: string;
}

export interface AnalyticsMonthlyRow {
  month: string;
  gmv: string;
  orders: number;
  avgOrder: string;
  /** Year-over-year GMV change %, or null when there is no comparison month. */
  yoyChangePct: string | null;
}

export interface AnalyticsData {
  range: { from: string; to: string };
  kpis: AnalyticsKpis;
  trend: AnalyticsTrendPoint[];
  topBuyers: AnalyticsTopBuyer[];
  monthly: AnalyticsMonthlyRow[];
}

interface KpiRow {
  gmv: Prisma.Decimal;
  orders: bigint;
  order_total: Prisma.Decimal;
  active_buyers: bigint;
}
interface TrendRow {
  day: Date;
  gmv: Prisma.Decimal;
  order_count: bigint;
}
interface TopBuyerRow {
  buyer_id: string;
  company_name: string;
  gmv: Prisma.Decimal;
  order_count: bigint;
  order_total: Prisma.Decimal;
}
interface MonthlyRow {
  month: Date;
  gmv: Prisma.Decimal;
  orders: bigint;
  order_total: Prisma.Decimal;
  gmv_year_ago: Prisma.Decimal | null;
}

/** A row exported to CSV (orders / invoices / buyers). */
interface OrderExportRow {
  shopifyOrderNumber: string | null;
  status: string;
  total: Prisma.Decimal;
  currency: string;
  createdAt: Date;
  buyer: { companyName: string };
}
interface InvoiceExportRow {
  invoiceNumber: string;
  status: string;
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  dueDate: Date;
  createdAt: Date;
  buyer: { companyName: string };
}

/** Hard cap on rows per CSV export (keeps a single response bounded). */
const EXPORT_LIMIT = 5000;

/**
 * Analytics aggregation + CSV/GDPR export for the merchant analytics page.
 * KPIs and the daily trend are computed over the requested [from, to] window;
 * top buyers cover the same window; the monthly table always spans the last 12
 * months with a 24-month lookback so YoY is comparable. All money is Decimal.js
 * (banker's rounding) serialized to 2dp strings. Reads run in the RLS scope.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  /** Parse + clamp the requested window (defaults to the trailing 30 days). */
  private resolveRange(from?: string, to?: string): { from: Date; to: Date } {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : subDays(toDate, 29);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'from/to must be ISO dates' });
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'from must be on or before to' });
    }
    return { from: fromDate, to: toDate };
  }

  async getAnalytics(merchantId: string, from?: string, to?: string): Promise<AnalyticsData> {
    const range = this.resolveRange(from, to);
    const [kpis, trend, topBuyers, monthly] = await Promise.all([
      this.getKpis(merchantId, range.from, range.to),
      this.getTrend(merchantId, range.from, range.to),
      this.getTopBuyers(merchantId, range.from, range.to),
      this.getMonthly(merchantId),
    ]);
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      kpis,
      trend,
      topBuyers,
      monthly,
    };
  }

  private async getKpis(merchantId: string, from: Date, to: Date): Promise<AnalyticsKpis> {
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<KpiRow[]>`
        SELECT
          (SELECT COALESCE(SUM(total), 0) FROM invoices
             WHERE merchant_id = ${merchantId}::uuid AND status = 'paid'
               AND paid_at BETWEEN ${from} AND ${to}) AS gmv,
          (SELECT COUNT(*) FROM orders
             WHERE merchant_id = ${merchantId}::uuid
               AND created_at BETWEEN ${from} AND ${to}) AS orders,
          (SELECT COALESCE(SUM(total), 0) FROM orders
             WHERE merchant_id = ${merchantId}::uuid
               AND created_at BETWEEN ${from} AND ${to}) AS order_total,
          (SELECT COUNT(DISTINCT buyer_id) FROM orders
             WHERE merchant_id = ${merchantId}::uuid
               AND created_at BETWEEN ${from} AND ${to}) AS active_buyers`,
    );
    const row = rows[0];
    const orders = Number(row?.orders ?? 0);
    const orderTotal = new Money((row?.order_total ?? 0).toString());
    const avg = orders > 0 ? orderTotal.dividedBy(orders).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN) : new Money(0);
    return {
      gmv: new Money((row?.gmv ?? 0).toString()).toFixed(2),
      orders,
      avgOrderValue: avg.toFixed(2),
      activeBuyers: Number(row?.active_buyers ?? 0),
    };
  }

  private async getTrend(merchantId: string, from: Date, to: Date): Promise<AnalyticsTrendPoint[]> {
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<TrendRow[]>`
        SELECT
          d.day::date AS day,
          COALESCE(SUM(o.total), 0) AS gmv,
          COUNT(o.id) AS order_count
        FROM generate_series(
          date_trunc('day', ${from}::timestamptz),
          date_trunc('day', ${to}::timestamptz),
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
      gmv: new Money(row.gmv.toString()).toFixed(2),
      orderCount: Number(row.order_count),
    }));
  }

  private async getTopBuyers(merchantId: string, from: Date, to: Date): Promise<AnalyticsTopBuyer[]> {
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<TopBuyerRow[]>`
        SELECT
          b.id           AS buyer_id,
          b.company_name AS company_name,
          COALESCE((SELECT SUM(i.total) FROM invoices i
             WHERE i.buyer_id = b.id AND i.merchant_id = ${merchantId}::uuid
               AND i.status = 'paid' AND i.paid_at BETWEEN ${from} AND ${to}), 0) AS gmv,
          COALESCE((SELECT COUNT(*) FROM orders o
             WHERE o.buyer_id = b.id AND o.merchant_id = ${merchantId}::uuid
               AND o.created_at BETWEEN ${from} AND ${to}), 0) AS order_count,
          COALESCE((SELECT SUM(o.total) FROM orders o
             WHERE o.buyer_id = b.id AND o.merchant_id = ${merchantId}::uuid
               AND o.created_at BETWEEN ${from} AND ${to}), 0) AS order_total
        FROM merchant_buyer_relationships r
        JOIN buyers b ON b.id = r.buyer_id
        WHERE r.merchant_id = ${merchantId}::uuid
        ORDER BY gmv DESC, order_count DESC
        LIMIT 10`,
    );
    return rows.map((row) => {
      const count = Number(row.order_count);
      const orderTotal = new Money(row.order_total.toString());
      const avg = count > 0 ? orderTotal.dividedBy(count).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN) : new Money(0);
      return {
        buyerId: row.buyer_id,
        companyName: row.company_name,
        gmv: new Money(row.gmv.toString()).toFixed(2),
        orderCount: count,
        avgOrderValue: avg.toFixed(2),
      };
    });
  }

  private async getMonthly(merchantId: string): Promise<AnalyticsMonthlyRow[]> {
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<MonthlyRow[]>`
        WITH months AS (
          SELECT m.month::date AS month
          FROM generate_series(
            date_trunc('month', NOW()) - INTERVAL '23 months',
            date_trunc('month', NOW()),
            INTERVAL '1 month'
          ) AS m(month)
        ),
        gmv AS (
          SELECT date_trunc('month', i.paid_at)::date AS month, COALESCE(SUM(i.total), 0) AS gmv
          FROM invoices i
          WHERE i.merchant_id = ${merchantId}::uuid AND i.status = 'paid'
            AND i.paid_at >= date_trunc('month', NOW()) - INTERVAL '23 months'
          GROUP BY 1
        ),
        ord AS (
          SELECT date_trunc('month', o.created_at)::date AS month,
                 COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS order_total
          FROM orders o
          WHERE o.merchant_id = ${merchantId}::uuid
            AND o.created_at >= date_trunc('month', NOW()) - INTERVAL '23 months'
          GROUP BY 1
        ),
        joined AS (
          SELECT mo.month,
                 COALESCE(g.gmv, 0) AS gmv,
                 COALESCE(ord.orders, 0) AS orders,
                 COALESCE(ord.order_total, 0) AS order_total
          FROM months mo
          LEFT JOIN gmv g ON g.month = mo.month
          LEFT JOIN ord ON ord.month = mo.month
        )
        SELECT month, gmv, orders, order_total,
               LAG(gmv, 12) OVER (ORDER BY month) AS gmv_year_ago
        FROM joined
        ORDER BY month ASC`,
    );
    // Keep only the trailing 12 months (the first 12 only seed the YoY lookback).
    return rows.slice(-12).map((row) => {
      const orders = Number(row.orders);
      const orderTotal = new Money(row.order_total.toString());
      const avg = orders > 0 ? orderTotal.dividedBy(orders).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN) : new Money(0);
      const gmv = new Money(row.gmv.toString());
      const yearAgo = row.gmv_year_ago !== null ? new Money(row.gmv_year_ago.toString()) : null;
      const yoy =
        yearAgo && yearAgo.greaterThan(0)
          ? gmv.minus(yearAgo).dividedBy(yearAgo).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2)
          : null;
      return {
        month: row.month.toISOString().slice(0, 7),
        gmv: gmv.toFixed(2),
        orders,
        avgOrder: avg.toFixed(2),
        yoyChangePct: yoy,
      };
    });
  }

  // ── CSV exports ──────────────────────────────────────────────────────────

  async exportOrdersCsv(merchantId: string): Promise<string> {
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.order.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_LIMIT,
        select: {
          shopifyOrderNumber: true,
          status: true,
          total: true,
          currency: true,
          createdAt: true,
          buyer: { select: { companyName: true } },
        },
      }),
    );
    const lines = ['Order Number,Buyer,Status,Total,Currency,Created At'];
    for (const row of rows as OrderExportRow[]) {
      lines.push(
        [
          this.csvCell(row.shopifyOrderNumber ?? ''),
          this.csvCell(row.buyer?.companyName ?? ''),
          row.status,
          new Money(row.total.toString()).toFixed(2),
          row.currency,
          row.createdAt.toISOString(),
        ].join(','),
      );
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  async exportInvoicesCsv(merchantId: string): Promise<string> {
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.invoice.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_LIMIT,
        select: {
          invoiceNumber: true,
          status: true,
          total: true,
          amountPaid: true,
          dueDate: true,
          createdAt: true,
          buyer: { select: { companyName: true } },
        },
      }),
    );
    const lines = ['Invoice Number,Buyer,Status,Total,Amount Paid,Due Date,Created At'];
    for (const row of rows as InvoiceExportRow[]) {
      lines.push(
        [
          this.csvCell(row.invoiceNumber),
          this.csvCell(row.buyer?.companyName ?? ''),
          row.status,
          new Money(row.total.toString()).toFixed(2),
          new Money(row.amountPaid.toString()).toFixed(2),
          row.dueDate.toISOString().slice(0, 10),
          row.createdAt.toISOString(),
        ].join(','),
      );
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  async exportBuyersCsv(merchantId: string): Promise<string> {
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchantBuyerRelationship.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_LIMIT,
        select: {
          approvalStatus: true,
          paymentTerms: true,
          creditLimit: true,
          createdAt: true,
          buyer: { select: { companyName: true, email: true } },
        },
      }),
    );
    const lines = ['Company,Email,Status,Payment Terms,Credit Limit,Created At'];
    for (const row of rows) {
      lines.push(
        [
          this.csvCell(row.buyer?.companyName ?? ''),
          this.csvCell(row.buyer?.email ?? ''),
          row.approvalStatus,
          row.paymentTerms,
          row.creditLimit !== null ? new Money(row.creditLimit.toString()).toFixed(2) : '',
          row.createdAt.toISOString(),
        ].join(','),
      );
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  /** Quote a CSV cell when it contains a comma, quote or newline. */
  private csvCell(value: string): string {
    if (/[",\r\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
