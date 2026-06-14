import { Global, Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';

/**
 * Buyer catalog (tier-resolved pricing, fashion variant matrices, cache
 * stampede + early-expiration protection). Global so buyer-portal controllers
 * and the catalog-sync worker can inject {@link CatalogService}. Depends on the
 * global Shopify, Pricing, Prisma and Redis modules.
 */
@Global()
@Module({
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
