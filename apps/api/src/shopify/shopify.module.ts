import { Global, Module } from '@nestjs/common';
import { ShopifyApiService } from './shopify-api.service';

/**
 * Outbound Shopify Admin API access. Global so any worker or feature module can
 * inject {@link ShopifyApiService} without re-importing. Depends on the global
 * CircuitBreaker, Crypto, and Redis modules.
 */
@Global()
@Module({
  providers: [ShopifyApiService],
  exports: [ShopifyApiService],
})
export class ShopifyModule {}
