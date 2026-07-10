import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuyersModule } from '../buyers/buyers.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Ga4Service } from './ga4.service';

/**
 * Merchant analytics (summary, AR aging, top buyers, order/GMV trends, the
 * analytics-page aggregator + CSV/GDPR export) plus the per-buyer GDPR
 * data-export surface. Delegates AR aging to InvoicesService (global) and
 * GDPR export/erasure to BuyersService (imported here). AnalyticsService owns
 * the aggregation + CSV builders. AuthModule supplies the merchant guards;
 * Prisma and Redis are global.
 */
@Module({
  imports: [AuthModule, BuyersModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, Ga4Service],
  exports: [Ga4Service],
})
export class AnalyticsModule {}
