import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { ShopifyApiService } from '../shopify/shopify-api.service';
import { PricingService, type ResolvedVariantPrice } from '../pricing/pricing.service';
import { REDIS_CACHE } from '../redis/redis.module';

export interface CatalogParams {
  cursor?: string | null;
  search?: string;
  limit?: number;
}

export interface CatalogVariant {
  shopifyVariantId: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  basePrice: string;
  resolvedPrice: string;
  appliedTierType: ResolvedVariantPrice['appliedTierType'];
  available: boolean;
}

export interface CatalogProduct {
  shopifyProductId: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  colors: string[];
  sizes: string[];
  variants: CatalogVariant[];
}

export interface CatalogPage {
  products: CatalogProduct[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  /** True when served from a degraded path (lock contention, no fresh data). */
  stale: boolean;
}

const CACHE_TTL_SECONDS = 300;
const LOCK_TTL_MS = 30_000;
const LOCK_RETRY_DELAY_MS = 200;
const LOCK_MAX_RETRIES = 10;
const EARLY_EXPIRY_FRACTION = 0.2;
const EARLY_EXPIRY_PROBABILITY = 0.1;
const DEFAULT_LIMIT = 50;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Buyer-facing catalog with tier-resolved pricing, fashion variant matrices, and
 * two cache-protection strategies:
 *   - Stampede prevention: a Redis SETNX lock guards the (expensive) Shopify
 *     fetch; concurrent callers poll the cache, then degrade gracefully.
 *   - Probabilistic early expiration: as a hot key nears expiry, a small
 *     fraction of reads asynchronously pre-warm it so it never hard-misses.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly shopify: ShopifyApiService,
    private readonly pricing: PricingService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {}

  /** Resolve (and cache) one page of the buyer's catalog with tier pricing. */
  async getCatalogForBuyer(
    buyerId: string,
    merchantId: string,
    params: CatalogParams,
  ): Promise<CatalogPage> {
    const tierId = await this.resolveTierId(buyerId, merchantId);
    const cacheKey = this.buildKey(merchantId, tierId, params);

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      this.maybeEarlyRefresh(cacheKey, buyerId, merchantId, params);
      return JSON.parse(cached) as CatalogPage;
    }

    // Stampede prevention: only the lock holder hits Shopify.
    const lockKey = `${cacheKey}:lock`;
    const acquired = await this.cache.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (acquired !== 'OK') {
      return this.waitForCacheOrDegrade(cacheKey);
    }

    try {
      const page = await this.build(buyerId, merchantId, params);
      await this.cache.set(cacheKey, JSON.stringify(page), 'EX', CACHE_TTL_SECONDS);
      return page;
    } finally {
      await this.cache.del(lockKey);
    }
  }

  /** Invalidate every cached catalog artifact (pages + locks) for a merchant. */
  async invalidateMerchantCatalog(merchantId: string): Promise<void> {
    const pattern = `catalog:*:${merchantId}:*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.cache.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await this.cache.del(...keys);
      }
    } while (cursor !== '0');
    this.logger.log(`Invalidated catalog cache for merchant ${merchantId}`);
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async resolveTierId(buyerId: string, merchantId: string): Promise<string | null> {
    return this.merchantContext.run(merchantId, async () => {
      const relationship = await this.prisma.merchantBuyerRelationship.findUnique({
        where: { merchantId_buyerId: { merchantId, buyerId } },
        select: { pricingTierId: true },
      });
      return relationship?.pricingTierId ?? null;
    });
  }

  private buildKey(merchantId: string, tierId: string | null, params: CatalogParams): string {
    const cursor = params.cursor ?? 'first';
    const search = encodeURIComponent(params.search ?? '');
    return `catalog:page:${merchantId}:tier:${tierId ?? 'none'}:page:${cursor}:q:${search}`;
  }

  /** Poll for a value the lock holder is producing; degrade to empty/stale. */
  private async waitForCacheOrDegrade(cacheKey: string): Promise<CatalogPage> {
    for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt += 1) {
      await sleep(LOCK_RETRY_DELAY_MS);
      const value = await this.cache.get(cacheKey);
      if (value) {
        return JSON.parse(value) as CatalogPage;
      }
    }
    this.logger.warn(`Catalog cache wait exhausted for ${cacheKey}; serving degraded result`);
    return { products: [], pageInfo: { hasNextPage: false, endCursor: null }, stale: true };
  }

  /** Fetch the first product page from Shopify and overlay tier pricing. */
  private async build(buyerId: string, merchantId: string, params: CatalogParams): Promise<CatalogPage> {
    const limit = params.limit ?? DEFAULT_LIMIT;

    const merchant = await this.merchantContext.run(merchantId, () =>
      this.prisma.merchant.findFirstOrThrow({
        where: { id: merchantId, isActive: true },
        select: { shopifyDomain: true, shopifyAccessToken: true },
      }),
    );

    // Take the first yielded page from the auto-paginating product stream.
    // NOTE: the Shopify REST stream owns its Link cursor, so this resolves the
    // first page; deeper cursoring is a follow-up that requires since_id support.
    let batch: Awaited<ReturnType<ShopifyApiService['getProduct']>>[] = [];
    for await (const page of this.shopify.listProducts(merchant.shopifyDomain, merchant.shopifyAccessToken, {
      status: 'active',
      limit,
    })) {
      batch = page;
      break;
    }

    const search = (params.search ?? '').trim().toLowerCase();
    const filtered = search
      ? batch.filter((product) => product.title.toLowerCase().includes(search))
      : batch;

    const variantIds = filtered.flatMap((product) => product.variants.map((v) => String(v.id)));
    const priced = await this.pricing.resolveBuyerPricing(buyerId, merchantId, variantIds);
    const priceByVariant = new Map<string, ResolvedVariantPrice>(
      priced.map((entry) => [entry.shopifyVariantId, entry]),
    );

    const products: CatalogProduct[] = filtered.map((product) => {
      const colors = new Set<string>();
      const sizes = new Set<string>();
      const variants: CatalogVariant[] = product.variants.map((variant) => {
        const color = variant.option1;
        const size = variant.option2;
        if (color) colors.add(color);
        if (size) sizes.add(size);
        const resolved = priceByVariant.get(String(variant.id));
        return {
          shopifyVariantId: String(variant.id),
          sku: variant.sku,
          color,
          size,
          basePrice: resolved?.basePrice ?? variant.price,
          resolvedPrice: resolved?.resolvedPrice ?? variant.price,
          appliedTierType: resolved?.appliedTierType ?? null,
          available: variant.available ?? variant.inventory_quantity > 0,
        };
      });
      return {
        shopifyProductId: String(product.id),
        title: product.title,
        handle: product.handle,
        vendor: product.vendor,
        productType: product.product_type,
        colors: Array.from(colors),
        sizes: Array.from(sizes),
        variants,
      };
    });

    const lastProduct = products[products.length - 1];
    const endCursor = lastProduct ? lastProduct.shopifyProductId : null;
    return {
      products,
      pageInfo: { hasNextPage: batch.length >= limit, endCursor },
      stale: false,
    };
  }

  /** As a cached page nears expiry, a fraction of reads pre-warm it off-thread. */
  private maybeEarlyRefresh(
    cacheKey: string,
    buyerId: string,
    merchantId: string,
    params: CatalogParams,
  ): void {
    void (async () => {
      const ttl = await this.cache.ttl(cacheKey);
      if (
        ttl > 0 &&
        ttl < CACHE_TTL_SECONDS * EARLY_EXPIRY_FRACTION &&
        Math.random() < EARLY_EXPIRY_PROBABILITY
      ) {
        setTimeout(() => {
          void this.refresh(cacheKey, buyerId, merchantId, params);
        }, 0);
      }
    })().catch(() => undefined);
  }

  /** Best-effort background re-fetch + cache write; never throws to the caller. */
  private async refresh(
    cacheKey: string,
    buyerId: string,
    merchantId: string,
    params: CatalogParams,
  ): Promise<void> {
    try {
      const page = await this.build(buyerId, merchantId, params);
      await this.cache.set(cacheKey, JSON.stringify(page), 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(
        `Background catalog refresh failed for ${cacheKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
