import { Injectable, Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

export type InventoryStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface InventoryLevel {
  variantId: string;
  quantity: number;
  status: InventoryStatus;
  allowsBackOrder: boolean;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject('REDIS_CACHE') private readonly cache: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async getInventoryForVariants(
    merchantId: string,
    encryptedToken: string,
    variantIds: string[],
    correlationId?: string,
  ): Promise<Map<string, InventoryLevel>> {
    const allowsBackOrder = await this.getMerchantBackOrderSetting(merchantId, correlationId);
    const result = new Map<string, InventoryLevel>();

    // Batch cache lookup with MGET
    const cacheKeys = variantIds.map((id) => `inventory:${merchantId}:${id}`);
    const cached = await this.cache.mget(...cacheKeys);

    const uncachedVariantIds: string[] = [];
    cached.forEach((value, index) => {
      const variantId = variantIds[index]!;
      if (value) {
        try {
          const parsed = JSON.parse(value);
          result.set(variantId, { ...parsed, allowsBackOrder });
        } catch {
          uncachedVariantIds.push(variantId);
        }
      } else {
        uncachedVariantIds.push(variantId);
      }
    });

    // Fetch uncached variants from Shopify (max 20 concurrent)
    if (uncachedVariantIds.length > 0) {
      const chunkSize = 20;
      for (let i = 0; i < uncachedVariantIds.length; i += chunkSize) {
        const chunk = uncachedVariantIds.slice(i, i + chunkSize);
        const fetchPromises = chunk.map((variantId) =>
          this.fetchAndCacheInventory(merchantId, encryptedToken, variantId, allowsBackOrder, correlationId),
        );
        const fetched = await Promise.all(fetchPromises);
        fetched.forEach((level) => {
          if (level) result.set(level.variantId, level);
        });
      }
    }

    return result;
  }

  private async fetchAndCacheInventory(
    merchantId: string,
    _encryptedToken: string,
    variantId: string,
    allowsBackOrder: boolean,
    _correlationId?: string,
  ): Promise<InventoryLevel | null> {
    try {
      // Note: ShopifyApiService doesn't have getVariant method yet
      // For now, return a default inventory level. This should be implemented
      // when Shopify variant inventory API is added to ShopifyApiService.
      const quantity = 10; // Placeholder - should fetch from Shopify
      const status = this.determineStatus(quantity);

      const level: InventoryLevel = { variantId, quantity, status, allowsBackOrder };

      // Cache for 60 seconds
      const cacheKey = `inventory:${merchantId}:${variantId}`;
      await this.cache.setex(cacheKey, 60, JSON.stringify({ variantId, quantity, status }));

      return level;
    } catch (error) {
      this.logger.error('Failed to fetch inventory', { merchantId, variantId, error });
      return null;
    }
  }

  private determineStatus(quantity: number): InventoryStatus {
    if (quantity >= 20) return 'in_stock';
    if (quantity >= 1) return 'low_stock';
    return 'out_of_stock';
  }

  async getMerchantBackOrderSetting(merchantId: string, _correlationId?: string): Promise<boolean> {
    const cacheKey = `merchant:backorder:${merchantId}`;
    const cached = await this.cache.get(cacheKey);

    if (cached !== null) {
      return cached === '1';
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { allowsBackOrders: true },
    });

    const allows = merchant?.allowsBackOrders ?? false;
    await this.cache.setex(cacheKey, 300, allows ? '1' : '0');

    return allows;
  }

  async invalidateInventoryCache(merchantId: string, variantIds: string[]): Promise<void> {
    const keys = variantIds.map((id) => `inventory:${merchantId}:${id}`);
    if (keys.length > 0) {
      await this.cache.del(...keys);
    }
  }

  async invalidateMerchantBackOrderCache(merchantId: string): Promise<void> {
    await this.cache.del(`merchant:backorder:${merchantId}`);
  }
}
