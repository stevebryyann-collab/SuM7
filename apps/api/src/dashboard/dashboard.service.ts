import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { PrismaService } from "../prisma/prisma.service";
import { MerchantContextService } from "../prisma/merchant-context.service";
import {
  InvoicesService,
  type ArAgingResult,
  type InvoiceSummary,
} from "../invoices/invoices.service";

const Money = Decimal.clone({
  rounding: Decimal.ROUND_HALF_EVEN,
  precision: 40,
});

/** KPI cards on the merchant dashboard. All money is a 2dp decimal string. */
export interface DashboardKpis {
  gmvCurrentMonth: string;
  gmvPreviousMonth: string;
  /** Month-over-month % change, or null when last month had no GMV. */
  gmvChangePercent: string | null;
  outstandingArBalance: string;
  /** Number of outstanding invoices (drives the "across N invoices" sub-label). */
  outstandingInvoiceCount: number;
  overdueInvoiceCount: number;
  overdueInvoiceAmount: string;
  newBuyersThisMonth: number;
  pendingApplicationCount: number;
}

/** One point of the dashboard's 30-day GMV trend (order value per day). */
export interface DashboardTrendPoint {
  date: string;
  gmv: string;
}

/** A pending application surfaced in the dashboard panel (no PII). */
export interface DashboardPendingApplication {
  id: string;
  companyName: string;
  businessType: string | null;
  createdAt: string;
}

/** Onboarding completion flags powering the "Get started" checklist. */
export interface DashboardSetup {
  hasTier: boolean;
  hasApprovedBuyer: boolean;
  hasSubscription: boolean;
}

/** Everything the dashboard renders, in a single round-trip. */
export interface DashboardData {
  kpis: DashboardKpis;
  aging: ArAgingResult;
  gmvTrend: DashboardTrendPoint[];
  recentInvoices: InvoiceSummary[];
  pendingApplications: DashboardPendingApplication[];
  setup: DashboardSetup;
}

interface KpiRow {
  gmv_current: Prisma.Decimal;
  gmv_previous: Prisma.Decimal;
  outstanding_ar: Prisma.Decimal;
  outstanding_count: bigint;
  overdue_count: bigint;
  overdue_amount: Prisma.Decimal;
  new_buyers: bigint;
  pending_apps: bigint;
  has_tier: boolean;
  has_approved_buyer: boolean;
  has_subscription: boolean;
}

interface TrendRow {
  day: Date;
  gmv: Prisma.Decimal;
}

/**
 * Composes the merchant dashboard payload (KPIs + AR aging + 30-day GMV trend +
 * recent invoices + pending applications + onboarding flags) for `GET
 * /api/v1/dashboard`. The merchantId always comes from the verified session.
 * Every read runs inside the RLS tenant scope.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly invoices: InvoicesService,
  ) {}

  async getDashboard(merchantId: string): Promise<DashboardData> {
    const [kpis, aging, gmvTrend, recent, pendingApplications] =
      await Promise.all([
        this.getKpis(merchantId),
        this.invoices.getArAging(merchantId),
        this.getGmvTrend(merchantId),
        this.invoices.listInvoicesForMerchant(merchantId, { limit: 10 }),
        this.getPendingApplications(merchantId),
      ]);

    return {
      kpis: kpis.kpis,
      aging,
      gmvTrend,
      recentInvoices: recent.data,
      pendingApplications,
      setup: kpis.setup,
    };
  }

  private async getKpis(
    merchantId: string,
  ): Promise<{ kpis: DashboardKpis; setup: DashboardSetup }> {
    const rows = await this.merchantContext.run(
      merchantId,
      () =>
        this.prisma.$queryRaw<KpiRow[]>`
        SELECT
          (SELECT COALESCE(SUM(total), 0) FROM invoices
             WHERE merchant_id = ${merchantId}::uuid AND status = 'paid'
               AND paid_at >= date_trunc('month', NOW())) AS gmv_current,
          (SELECT COALESCE(SUM(total), 0) FROM invoices
             WHERE merchant_id = ${merchantId}::uuid AND status = 'paid'
               AND paid_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
               AND paid_at <  date_trunc('month', NOW())) AS gmv_previous,
          (SELECT COALESCE(SUM(total - amount_paid), 0) FROM invoices
             WHERE merchant_id = ${merchantId}::uuid
               AND status IN ('sent','viewed','partially_paid','overdue')) AS outstanding_ar,
          (SELECT COUNT(*) FROM invoices
             WHERE merchant_id = ${merchantId}::uuid
               AND status IN ('sent','viewed','partially_paid','overdue')) AS outstanding_count,
          (SELECT COUNT(*) FROM invoices
             WHERE merchant_id = ${merchantId}::uuid AND status = 'overdue') AS overdue_count,
          (SELECT COALESCE(SUM(total - amount_paid), 0) FROM invoices
             WHERE merchant_id = ${merchantId}::uuid AND status = 'overdue') AS overdue_amount,
          (SELECT COUNT(*) FROM merchant_buyer_relationships
             WHERE merchant_id = ${merchantId}::uuid AND approval_status = 'approved'
               AND created_at >= date_trunc('month', NOW())) AS new_buyers,
          (SELECT COUNT(*) FROM buyer_registration_applications
             WHERE merchant_id = ${merchantId}::uuid AND status = 'pending') AS pending_apps,
          (SELECT COUNT(*) > 0 FROM pricing_tiers
             WHERE merchant_id = ${merchantId}::uuid) AS has_tier,
          (SELECT COUNT(*) > 0 FROM merchant_buyer_relationships
             WHERE merchant_id = ${merchantId}::uuid AND approval_status = 'approved') AS has_approved_buyer,
          (SELECT subscription_paddle_id IS NOT NULL FROM merchants
             WHERE id = ${merchantId}::uuid) AS has_subscription`,
    );
    const row = rows[0];
    const current = new Money((row?.gmv_current ?? 0).toString());
    const previous = new Money((row?.gmv_previous ?? 0).toString());
    const changePercent = previous.greaterThan(0)
      ? current
          .minus(previous)
          .dividedBy(previous)
          .times(100)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN)
          .toFixed(2)
      : null;

    return {
      kpis: {
        gmvCurrentMonth: current.toFixed(2),
        gmvPreviousMonth: previous.toFixed(2),
        gmvChangePercent: changePercent,
        outstandingArBalance: new Money(
          (row?.outstanding_ar ?? 0).toString(),
        ).toFixed(2),
        outstandingInvoiceCount: Number(row?.outstanding_count ?? 0),
        overdueInvoiceCount: Number(row?.overdue_count ?? 0),
        overdueInvoiceAmount: new Money(
          (row?.overdue_amount ?? 0).toString(),
        ).toFixed(2),
        newBuyersThisMonth: Number(row?.new_buyers ?? 0),
        pendingApplicationCount: Number(row?.pending_apps ?? 0),
      },
      setup: {
        hasTier: Boolean(row?.has_tier),
        hasApprovedBuyer: Boolean(row?.has_approved_buyer),
        hasSubscription: Boolean(row?.has_subscription),
      },
    };
  }

  private async getGmvTrend(
    merchantId: string,
  ): Promise<DashboardTrendPoint[]> {
    const rows = await this.merchantContext.run(
      merchantId,
      () =>
        this.prisma.$queryRaw<TrendRow[]>`
        SELECT
          d.day::date AS day,
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
      gmv: new Money(row.gmv.toString()).toFixed(2),
    }));
  }

  private async getPendingApplications(
    merchantId: string,
  ): Promise<DashboardPendingApplication[]> {
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.buyerRegistrationApplication.findMany({
        where: { merchantId, status: "pending" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          companyName: true,
          businessType: true,
          createdAt: true,
        },
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      companyName: row.companyName,
      businessType: row.businessType,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
