import { Global, Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingTiersController } from './pricing-tiers.controller';

/**
 * Pricing engine (tiers, overrides, volume breaks, resolved variant pricing).
 * Global so the catalog service and order/invoice workers can inject
 * {@link PricingService}, the authoritative source of buyer prices. Also hosts
 * the merchant-admin pricing-tier controller (CRUD + bulk overrides). Prisma,
 * Redis, Catalog and Auth guards come from global modules.
 */
@Global()
@Module({
  controllers: [PricingTiersController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
