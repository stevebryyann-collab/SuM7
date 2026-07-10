import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StandingOrdersController } from './standing-orders.controller';
import { StandingOrdersService } from './standing-orders.service';

/**
 * Buyer reorder reminders. The ClerkBuyerGuard comes from AuthModule; Prisma,
 * MerchantContext and Email are global. The service also hosts the daily
 * reminder cron (ScheduleModule is initialised in AppModule).
 */
@Module({
  imports: [AuthModule],
  controllers: [StandingOrdersController],
  providers: [StandingOrdersService],
  exports: [StandingOrdersService],
})
export class StandingOrdersModule {}
