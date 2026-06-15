import { Context, Query, Resolver } from '@nestjs/graphql';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantContextService } from '../../prisma/merchant-context.service';
import { MerchantDashboard } from '../types/dashboard.types';
import type { GraphqlContext } from '../graphql-context.service';

/** Banker's-rounding Decimal for the GMV change-percent calculation. */
const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });

/** One-row result of the dashboard CTE; numerics arrive as strings/bigint. */
interface DashboardRow {
  gmv_current_month: Prisma_Decimal;
  gmv_previous_month: Prisma_Decimal;
  outstanding_ar_balance: Prisma_Decimal;
  overdue_invoice_count: bigint;
  overdue_invoice_amount: Prisma_Decimal;
  new_buyers_this_month: bigint;
  pending_application_count: bigint;
}

/** The Prisma Decimal shape returned by $queryRaw (avoids importing the namespace). */
type Prisma_Decimal = { toString(): string };

/**
 * Merchant dashboard resolver. A single `$queryRaw` CTE returns every KPI in one
 * roundtrip (GMV current/previous, AR summary, new buyers, pending apps). The
 * tenant is taken from the authenticated GraphQL context — never from arguments —
 * and the query runs inside the merchant's RLS scope.
 */
@Resolver(() => MerchantDashboard)
export class DashboardResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  @Query(() => MerchantDashboard, {
    description: 'Aggregated KPI snapshot for the merchant admin dashboard.',
    complexity: 20,
  })
  async getMerchantDashboard(@Context() ctx: GraphqlContext): Promise<MerchantDashboard> {
    const merchantId = ctx.merchantId;

    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<DashboardRow[]>`
        WITH
          current_gmv AS (
            SELECT COALESCE(SUM(total), 0) AS gmv FROM invoices
            WHERE merchant_id = ${merchantId}::uuid AND status = 'paid'
              AND paid_at >= date_trunc('month', NOW())
          ),
          previous_gmv AS (
            SELECT COALESCE(SUM(total), 0) AS gmv FROM invoices
            WHERE merchant_id = ${merchantId}::uuid AND status = 'paid'
              AND paid_at >= date_trunc('month', NOW() - INTERVAL '1 month')
              AND paid_at < date_trunc('month', NOW())
          ),
          ar_summary AS (
            SELECT
              COALESCE(SUM(total - amount_paid), 0) AS outstanding_balance,
              COUNT(*) FILTER (WHERE due_date < NOW()) AS overdue_count,
              COALESCE(SUM(total - amount_paid) FILTER (WHERE due_date < NOW()), 0) AS overdue_amount
            FROM invoices
            WHERE merchant_id = ${merchantId}::uuid AND status NOT IN ('paid', 'void')
          ),
          new_buyers AS (
            SELECT COUNT(*) AS count FROM merchant_buyer_relationships
            WHERE merchant_id = ${merchantId}::uuid AND approved_at >= date_trunc('month', NOW())
          ),
          pending_apps AS (
            SELECT COUNT(*) AS count FROM buyer_registration_applications
            WHERE merchant_id = ${merchantId}::uuid AND status = 'pending'
          )
        SELECT
          (SELECT gmv FROM current_gmv)              AS gmv_current_month,
          (SELECT gmv FROM previous_gmv)             AS gmv_previous_month,
          (SELECT outstanding_balance FROM ar_summary) AS outstanding_ar_balance,
          (SELECT overdue_count FROM ar_summary)     AS overdue_invoice_count,
          (SELECT overdue_amount FROM ar_summary)    AS overdue_invoice_amount,
          (SELECT count FROM new_buyers)             AS new_buyers_this_month,
          (SELECT count FROM pending_apps)           AS pending_application_count`,
    );

    const row = rows[0];
    const currentGmv = new Money((row?.gmv_current_month ?? '0').toString());
    const previousGmv = new Money((row?.gmv_previous_month ?? '0').toString());

    const gmvChangePercent = previousGmv.greaterThan(0)
      ? currentGmv.minus(previousGmv).dividedBy(previousGmv).times(100).toFixed(1)
      : null;

    return {
      gmvCurrentMonth: currentGmv.toFixed(2),
      gmvPreviousMonth: previousGmv.toFixed(2),
      gmvChangePercent,
      outstandingArBalance: new Money((row?.outstanding_ar_balance ?? '0').toString()).toFixed(2),
      overdueInvoiceCount: Number(row?.overdue_invoice_count ?? 0),
      overdueInvoiceAmount: new Money((row?.overdue_invoice_amount ?? '0').toString()).toFixed(2),
      newBuyersThisMonth: Number(row?.new_buyers_this_month ?? 0),
      pendingApplicationCount: Number(row?.pending_application_count ?? 0),
    };
  }
}
