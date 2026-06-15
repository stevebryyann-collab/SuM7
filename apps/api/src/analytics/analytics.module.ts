import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuyersModule } from '../buyers/buyers.module';
import { AnalyticsController } from './analytics.controller';

/**
 * Merchant analytics (summary, AR aging, top buyers, order/GMV trends) plus the
 * GDPR data-export surface. Delegates AR aging to InvoicesService (global) and
 * GDPR export/erasure to BuyersService (imported here). AuthModule supplies the
 * merchant guards; Prisma and Redis are global.
 */
@Module({
  imports: [AuthModule, BuyersModule],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
