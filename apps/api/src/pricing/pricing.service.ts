import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { Decimal } from 'decimal.js';
import type {
  PricedVariant,
  PricingTierType,
  ResolvedOrderLine,
  VolumeBreakCondition,
} from '@b2b/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { REDIS_CACHE } from '../redis/redis.module';

/**
 * A Decimal constructor pinned to banker's rounding (ROUND_HALF_EVEN). ALL price
 * arithmetic in this service uses `Money` — never native JS number math — so the
 * engine is fully deterministic: identical inputs always yield identical output.
 */
const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });

const MIN_PRICE = new Money('0.01');
const MAX_PRICE = new Money('999999.99');
const CACHE_TTL_SECONDS = 300;

/**
 * Enriched {@link PricedVariant}. The base shape is the cross-package contract;
 * the extra flags tell the caller whether the price is final or needs a manual
 * decision / a quantity before it is meaningful.
 */
export interface ResolvedVariantPrice extends PricedVariant {
  requiresManualPricing: boolean;
  requiresQuantityForPricing: boolean;
  volumeBrackets: VolumeBreakCondition[] | null;
}

export interface OrderLineInput {
  shopifyVariantId: string;
  quantity: number;
}

interface TierData {
  id: string;
  type: PricingTierType;
  baseDiscountPct: Decimal | null;
  brackets: VolumeBreakCondition[];
}

interface OverrideRow {
  shopifyProductId: string;
  shopifyVariantId: string | null;
  price: Decimal;
  compareAtPrice: Decimal | null;
  currency: string;
}

/**
 * THE financial system of record for buyer prices. Resolution order per variant
 * (first match wins): exact pricing-tier override → tier-type rule → manual.
 *
 * Base prices come from the per-variant override snapshot maintained by the
 * catalog-sync worker (override.compareAtPrice = list price, override.price =
 * explicit price). Product-level overrides (null variant) require a product
 * context the order-construction layer owns, so this id-only API resolves on the
 * exact-variant snapshot. Titles/SKUs are likewise overlaid by that layer; the
 * authoritative outputs here are the monetary fields.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {}

  /**
   * Resolve catalog prices for a set of variants. Cached for 5 minutes under a
   * key derived from the SORTED variant ids (so input order never changes the
   * key). Audited (tier metadata only — never the prices themselves).
   */
  async resolveBuyerPricing(
    buyerId: string,
    merchantId: string,
    shopifyVariantIds: string[],
  ): Promise<ResolvedVariantPrice[]> {
    const cacheKey = this.buildPricingCacheKey(buyerId, merchantId, shopifyVariantIds);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ResolvedVariantPrice[];
    }

    const result = await this.merchantContext.run(merchantId, async () => {
      const tier = await this.loadTier(buyerId, merchantId);
      const overrides = await this.loadOverrides(tier?.id ?? null, shopifyVariantIds);

      const priced = shopifyVariantIds.map((variantId) =>
        this.priceVariant(variantId, tier, overrides.get(variantId)),
      );

      await this.writeAudit(merchantId, buyerId, tier, shopifyVariantIds.length, 'resolve_catalog_pricing');
      return priced;
    });

    await this.cache.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * Resolve the authoritative per-line prices for an order. ALWAYS reads from the
   * DB — never trusts client-supplied prices — and never caches (orders must
   * reflect the live tier, including volume brackets selected by quantity).
   */
  async resolveOrderLinePricing(
    buyerId: string,
    merchantId: string,
    lineItems: OrderLineInput[],
  ): Promise<ResolvedOrderLine[]> {
    return this.merchantContext.run(merchantId, async () => {
      const tier = await this.loadTier(buyerId, merchantId);
      const variantIds = lineItems.map((l) => l.shopifyVariantId);
      const overrides = await this.loadOverrides(tier?.id ?? null, variantIds);

      const lines = lineItems.map((line) =>
        this.priceOrderLine(line, tier, overrides.get(line.shopifyVariantId)),
      );

      await this.writeAudit(merchantId, buyerId, tier, lineItems.length, 'resolve_order_pricing');
      return lines;
    });
  }

  /** Deterministic cache key: SHA-256 over the sorted, comma-joined variant ids. */
  buildPricingCacheKey(buyerId: string, merchantId: string, shopifyVariantIds: string[]): string {
    const sorted = [...shopifyVariantIds].sort();
    const digest = createHash('sha256').update(sorted.join(',')).digest('hex');
    return `pricing:${buyerId}:${merchantId}:${digest}`;
  }

  // ── Resolution ────────────────────────────────────────────────────────

  private priceVariant(
    variantId: string,
    tier: TierData | null,
    override: OverrideRow | undefined,
  ): ResolvedVariantPrice {
    if (!override) {
      // No price snapshot for this variant → cannot price deterministically.
      return {
        shopifyProductId: '',
        shopifyVariantId: variantId,
        sku: null,
        basePrice: MIN_PRICE.toFixed(2),
        resolvedPrice: MIN_PRICE.toFixed(2),
        appliedTierType: tier?.type ?? null,
        discountPct: null,
        currency: 'USD',
        requiresManualPricing: true,
        requiresQuantityForPricing: false,
        volumeBrackets: null,
      };
    }

    const base = this.basePriceOf(override);
    const common = {
      shopifyProductId: override.shopifyProductId,
      shopifyVariantId: variantId,
      sku: null,
      currency: override.currency,
    };

    if (!tier) {
      const price = this.enforceRange(base);
      return {
        ...common,
        basePrice: base.toFixed(2),
        resolvedPrice: price.toFixed(2),
        appliedTierType: null,
        discountPct: null,
        requiresManualPricing: false,
        requiresQuantityForPricing: false,
        volumeBrackets: null,
      };
    }

    if (tier.type === 'percentage_off') {
      const pct = tier.baseDiscountPct ?? new Money(0);
      const resolved = this.enforceRange(this.applyPercentage(base, pct));
      return {
        ...common,
        basePrice: base.toFixed(2),
        resolvedPrice: resolved.toFixed(2),
        appliedTierType: 'percentage_off',
        discountPct: pct.toFixed(2),
        requiresManualPricing: false,
        requiresQuantityForPricing: false,
        volumeBrackets: null,
      };
    }

    if (tier.type === 'fixed_price_list') {
      const fixed = this.enforceRange(new Money(override.price.toString()));
      return {
        ...common,
        basePrice: base.toFixed(2),
        resolvedPrice: fixed.toFixed(2),
        appliedTierType: 'fixed_price_list',
        discountPct: null,
        requiresManualPricing: true,
        requiresQuantityForPricing: false,
        volumeBrackets: null,
      };
    }

    // volume_breaks: price depends on quantity, not known at catalog time.
    const enforcedBase = this.enforceRange(base);
    return {
      ...common,
      basePrice: base.toFixed(2),
      resolvedPrice: enforcedBase.toFixed(2),
      appliedTierType: 'volume_breaks',
      discountPct: null,
      requiresManualPricing: false,
      requiresQuantityForPricing: true,
      volumeBrackets: tier.brackets,
    };
  }

  private priceOrderLine(
    line: OrderLineInput,
    tier: TierData | null,
    override: OverrideRow | undefined,
  ): ResolvedOrderLine {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new BadRequestException({
        code: 'INVALID_QUANTITY',
        message: `Quantity for variant ${line.shopifyVariantId} must be a positive integer`,
      });
    }
    if (!override) {
      throw new BadRequestException({
        code: 'VARIANT_NOT_PRICEABLE',
        message: `No price snapshot for variant ${line.shopifyVariantId}`,
      });
    }

    const base = this.basePriceOf(override);
    let unit = base;
    let appliedTierType: PricingTierType | null = tier?.type ?? null;
    let discountPct: Decimal | null = null;

    if (tier?.type === 'percentage_off') {
      discountPct = tier.baseDiscountPct ?? new Money(0);
      unit = this.applyPercentage(base, discountPct);
    } else if (tier?.type === 'fixed_price_list') {
      unit = new Money(override.price.toString());
    } else if (tier?.type === 'volume_breaks') {
      const bracket = this.selectBracket(tier.brackets, line.quantity);
      if (bracket) {
        discountPct = new Money(bracket.discountPct);
        unit = this.applyPercentage(base, discountPct);
      }
    }

    const unitPrice = this.enforceRange(unit);
    const lineTotal = this.enforceRange(unitPrice.mul(line.quantity), /* allowZeroFloor */ false);

    return {
      shopifyProductId: override.shopifyProductId,
      shopifyVariantId: line.shopifyVariantId,
      productTitle: override.shopifyProductId,
      variantTitle: null,
      sku: null,
      quantity: line.quantity,
      unitPrice: unitPrice.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
      appliedTierType,
      discountPct: discountPct ? discountPct.toFixed(2) : null,
      currency: override.currency,
    };
  }

  /**
   * Volume bracket selection: the bracket with the greatest `minQty` that is
   * still <= quantity (brackets are stored strictly ascending and contiguous, so
   * `[minQty, nextMinQty)`; the last bracket has an unbounded upper edge).
   * Returns null when quantity is below the first bracket.
   */
  private selectBracket(brackets: VolumeBreakCondition[], quantity: number): VolumeBreakCondition | null {
    const sorted = [...brackets].sort((a, b) => a.minQty - b.minQty);
    let chosen: VolumeBreakCondition | null = null;
    for (const bracket of sorted) {
      if (quantity >= bracket.minQty) {
        chosen = bracket;
      } else {
        break;
      }
    }
    return chosen;
  }

  private applyPercentage(base: Decimal, pct: Decimal): Decimal {
    const factor = new Money(1).minus(pct.div(100));
    return base.mul(factor).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  }

  private basePriceOf(override: OverrideRow): Decimal {
    const source = override.compareAtPrice ?? override.price;
    return new Money(source.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  }

  /** Floor at 0.01, then assert within [0.01, 999999.99]. */
  private enforceRange(value: Decimal, allowZeroFloor = true): Decimal {
    const floored = allowZeroFloor ? Money.max(value, MIN_PRICE) : value;
    const rounded = floored.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    if (rounded.lessThan(MIN_PRICE) || rounded.greaterThan(MAX_PRICE)) {
      throw new BadRequestException({
        code: 'PRICE_OUT_OF_RANGE',
        message: `Resolved price ${rounded.toFixed(2)} is outside [0.01, 999999.99]`,
      });
    }
    return rounded;
  }

  // ── Data loading ──────────────────────────────────────────────────────

  private async loadTier(buyerId: string, merchantId: string): Promise<TierData | null> {
    const relationship = await this.prisma.merchantBuyerRelationship.findUnique({
      where: { merchantId_buyerId: { merchantId, buyerId } },
      include: { pricingTier: true },
    });
    if (
      !relationship ||
      relationship.approvalStatus !== 'approved' ||
      !relationship.pricingTier ||
      !relationship.pricingTier.isActive
    ) {
      return null;
    }
    const tier = relationship.pricingTier;
    return {
      id: tier.id,
      type: tier.type as PricingTierType,
      baseDiscountPct: tier.baseDiscountPct ? new Money(tier.baseDiscountPct.toString()) : null,
      brackets: this.parseBrackets(tier.conditionsJson),
    };
  }

  private async loadOverrides(
    tierId: string | null,
    variantIds: string[],
  ): Promise<Map<string, OverrideRow>> {
    const map = new Map<string, OverrideRow>();
    if (!tierId || variantIds.length === 0) {
      return map;
    }
    const rows = await this.prisma.pricingTierOverride.findMany({
      where: { pricingTierId: tierId, shopifyVariantId: { in: variantIds } },
    });
    for (const row of rows) {
      if (row.shopifyVariantId) {
        map.set(row.shopifyVariantId, {
          shopifyProductId: row.shopifyProductId,
          shopifyVariantId: row.shopifyVariantId,
          price: new Money(row.price.toString()),
          compareAtPrice: row.compareAtPrice ? new Money(row.compareAtPrice.toString()) : null,
          currency: row.currency,
        });
      }
    }
    return map;
  }

  private parseBrackets(conditions: unknown): VolumeBreakCondition[] {
    if (!conditions || typeof conditions !== 'object') {
      return [];
    }
    const brackets = (conditions as { brackets?: unknown }).brackets;
    if (!Array.isArray(brackets)) {
      return [];
    }
    const result: VolumeBreakCondition[] = [];
    for (const item of brackets) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as VolumeBreakCondition).minQty === 'number' &&
        typeof (item as VolumeBreakCondition).discountPct === 'number'
      ) {
        result.push({
          minQty: (item as VolumeBreakCondition).minQty,
          discountPct: (item as VolumeBreakCondition).discountPct,
        });
      }
    }
    return result;
  }

  private async writeAudit(
    merchantId: string,
    buyerId: string,
    tier: TierData | null,
    variantCount: number,
    action: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          merchantId,
          entityType: 'pricing_resolution',
          entityId: buyerId,
          action,
          actorType: 'system',
          newValueJson: {
            tierId: tier?.id ?? null,
            tierType: tier?.type ?? null,
            ruleApplied: tier ? tier.type : 'base_price',
            variantCount,
          },
        },
      });
    } catch (error) {
      // Auditing must never break price resolution.
      this.logger.warn(`Failed to write pricing audit log: ${(error as Error).message}`);
    }
  }
}
