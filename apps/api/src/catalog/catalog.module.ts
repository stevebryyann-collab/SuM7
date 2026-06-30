import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { InventoryService } from './inventory.service';

/**
 * Buyer catalog (tier-resolved pricing, fashion variant matrices, cache
 * stampede + early-expiration protection). Global so buyer-portal controllers
 * and the catalog-sync worker can inject {@link CatalogService}. Depends on the
 * global Shopify, Pricing, Prisma and Redis modules; the controller's
 * ClerkBuyerGuard comes from AuthModule.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
  providers: [CatalogService, InventoryService],
  exports: [CatalogService, InventoryService],
})
export class CatalogModule {}
