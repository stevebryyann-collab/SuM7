import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Merchant dashboard aggregation. Composes the KPI/aging/trend/recent-invoice/
 * pending-application reads into one endpoint. AuthModule supplies the merchant
 * guards; Prisma is global and InvoicesService is provided by the global
 * InvoicesModule (reused for AR aging + the recent-invoice list).
 */
@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
