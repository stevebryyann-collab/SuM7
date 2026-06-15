import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * Order domain (bulk spreadsheet ordering, Shopify order sync, credit checks).
 * The controller's guards (MerchantSessionGuard, RolesGuard, ClerkBuyerGuard)
 * come from AuthModule; Prisma, MerchantContext, Pricing and Shopify are all
 * global. OrdersService is exported for any future cross-module use.
 */
@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
