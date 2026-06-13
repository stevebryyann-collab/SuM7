import { Global, Module } from '@nestjs/common';
import { PricingService } from './pricing.service';

/**
 * Pricing engine (tiers, overrides, volume breaks, resolved variant pricing).
 * Global so the catalog service and order/invoice workers can inject
 * {@link PricingService}, the authoritative source of buyer prices.
 */
@Global()
@Module({
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
