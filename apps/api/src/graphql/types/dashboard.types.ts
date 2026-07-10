import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * Merchant dashboard summary. All monetary values are serialized as strings
 * (computed with Decimal.js upstream) to avoid float drift across the wire;
 * counts are integers and the GMV change percent is a nullable string.
 */
@ObjectType({ description: 'Aggregated KPIs for the merchant admin dashboard.' })
export class MerchantDashboard {
  @Field(() => String, { description: 'Paid GMV for the current calendar month.' })
  gmvCurrentMonth!: string;

  @Field(() => String, { description: 'Paid GMV for the previous calendar month.' })
  gmvPreviousMonth!: string;

  @Field(() => String, { description: 'Lifetime paid GMV across all months.' })
  allTimeGmv!: string;

  @Field(() => String, {
    nullable: true,
    description: 'Month-over-month GMV change percent (1dp), or null when no prior GMV.',
  })
  gmvChangePercent!: string | null;

  @Field(() => String, { description: 'Total outstanding (unpaid, non-void) AR balance.' })
  outstandingArBalance!: string;

  @Field(() => Int, { description: 'Number of invoices past their due date.' })
  overdueInvoiceCount!: number;

  @Field(() => String, { description: 'Total amount across overdue invoices.' })
  overdueInvoiceAmount!: string;

  @Field(() => Int, { description: 'Buyers approved this calendar month.' })
  newBuyersThisMonth!: number;

  @Field(() => Int, { description: 'Applications currently awaiting review.' })
  pendingApplicationCount!: number;
}

/** One AR aging bucket (count + outstanding amount). */
@ObjectType({ description: 'A single accounts-receivable aging bucket.' })
export class ArAgingBucket {
  @Field(() => String, { description: 'Bucket key (e.g. current, overdue_1_30).' })
  bucket!: string;

  @Field(() => Int, { description: 'Number of invoices in this bucket.' })
  invoiceCount!: number;

  @Field(() => String, { description: 'Outstanding amount in this bucket.' })
  outstandingAmount!: string;
}

/** Full AR aging report across the five fixed buckets. */
@ObjectType({ description: 'Accounts-receivable aging across the standard buckets.' })
export class ArAgingType {
  @Field(() => ArAgingBucket)
  current!: ArAgingBucket;

  @Field(() => ArAgingBucket)
  overdue_1_30!: ArAgingBucket;

  @Field(() => ArAgingBucket)
  overdue_31_60!: ArAgingBucket;

  @Field(() => ArAgingBucket)
  overdue_61_90!: ArAgingBucket;

  @Field(() => ArAgingBucket)
  overdue_90_plus!: ArAgingBucket;
}
