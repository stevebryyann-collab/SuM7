import { BadRequestException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PricingService, type OrderLineInput } from './pricing.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MerchantContextService } from '../prisma/merchant-context.service';
import type { Redis } from 'ioredis';
import type { VolumeBreakCondition } from '@b2b/shared';

/**
 * The pricing engine is the financial system of record. These tests pin exact
 * numeric outputs for every tier type, verify banker's rounding (ROUND_HALF_EVEN),
 * volume-bracket boundary selection, quantity validation, range enforcement, and
 * cache-key determinism. Prisma/Redis are mocked so inputs are fully controlled.
 */

const BUYER_ID = '11111111-1111-1111-1111-111111111111';
const MERCHANT_ID = '22222222-2222-2222-2222-222222222222';
const TIER_ID = '33333333-3333-3333-3333-333333333333';
const VARIANT = 'gid-variant-1';
const PRODUCT = 'gid-product-1';

type TierMock = {
  id: string;
  type: 'percentage_off' | 'fixed_price_list' | 'volume_breaks';
  baseDiscountPct: Decimal | null;
  isActive: boolean;
  conditionsJson: unknown;
} | null;

interface OverrideMock {
  shopifyProductId: string;
  shopifyVariantId: string | null;
  price: Decimal;
  compareAtPrice: Decimal | null;
  currency: string;
}

interface SetupOptions {
  tier: TierMock;
  approvalStatus?: 'approved' | 'pending' | 'rejected' | 'suspended';
  overrides: OverrideMock[];
}

interface Harness {
  service: PricingService;
  cacheGet: jest.Mock;
  cacheSet: jest.Mock;
  auditCreate: jest.Mock;
}

function setup(options: SetupOptions): Harness {
  const relationship =
    options.tier === null
      ? { approvalStatus: options.approvalStatus ?? 'approved', pricingTier: null }
      : {
          approvalStatus: options.approvalStatus ?? 'approved',
          pricingTier: {
            id: options.tier.id,
            type: options.tier.type,
            baseDiscountPct: options.tier.baseDiscountPct,
            isActive: options.tier.isActive,
            conditionsJson: options.tier.conditionsJson,
          },
        };

  const auditCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    merchantBuyerRelationship: { findUnique: jest.fn().mockResolvedValue(relationship) },
    pricingTierOverride: { findMany: jest.fn().mockResolvedValue(options.overrides) },
    auditLog: { create: auditCreate },
  } as unknown as PrismaService;

  const merchantContext = {
    run: <T>(_merchantId: string, fn: () => Promise<T>): Promise<T> => fn(),
  } as unknown as MerchantContextService;

  const cacheGet = jest.fn().mockResolvedValue(null);
  const cacheSet = jest.fn().mockResolvedValue('OK');
  const cache = { get: cacheGet, set: cacheSet } as unknown as Redis;

  return { service: new PricingService(prisma, merchantContext, cache), cacheGet, cacheSet, auditCreate };
}

function override(price: string, compareAt: string | null): OverrideMock {
  return {
    shopifyProductId: PRODUCT,
    shopifyVariantId: VARIANT,
    price: new Decimal(price),
    compareAtPrice: compareAt === null ? null : new Decimal(compareAt),
    currency: 'USD',
  };
}

function brackets(values: VolumeBreakCondition[]): { brackets: VolumeBreakCondition[] } {
  return { brackets: values };
}

describe('PricingService', () => {
  describe('percentage_off', () => {
    it('computes an exact discounted price', async () => {
      const { service } = setup({
        tier: { id: TIER_ID, type: 'percentage_off', baseDiscountPct: new Decimal('15'), isActive: true, conditionsJson: null },
        overrides: [override('100.00', '100.00')],
      });
      const result = (await service.resolveBuyerPricing(BUYER_ID, MERCHANT_ID, [VARIANT]))[0]!;
      expect(result.resolvedPrice).toBe('85.00');
      expect(result.basePrice).toBe('100.00');
      expect(result.appliedTierType).toBe('percentage_off');
      expect(result.discountPct).toBe('15.00');
      expect(result.requiresManualPricing).toBe(false);
    });

    it('rounds a 0.025 tie DOWN to 0.02 (banker\'s rounding, even neighbour)', async () => {
      const { service } = setup({
        tier: { id: TIER_ID, type: 'percentage_off', baseDiscountPct: new Decimal('50'), isActive: true, conditionsJson: null },
        overrides: [override('0.05', '0.05')],
      });
      const result = (await service.resolveBuyerPricing(BUYER_ID, MERCHANT_ID, [VARIANT]))[0]!;
      // 0.05 * 0.5 = 0.025 → nearest even hundredth = 0.02
      expect(result.resolvedPrice).toBe('0.02');
    });

    it('rounds a 0.075 tie UP to 0.08 (banker\'s rounding, even neighbour)', async () => {
      const { service } = setup({
        tier: { id: TIER_ID, type: 'percentage_off', baseDiscountPct: new Decimal('50'), isActive: true, conditionsJson: null },
        overrides: [override('0.15', '0.15')],
      });
      const result = (await service.resolveBuyerPricing(BUYER_ID, MERCHANT_ID, [VARIANT]))[0]!;
      // 0.15 * 0.5 = 0.075 → nearest even hundredth = 0.08
      expect(result.resolvedPrice).toBe('0.08');
    });

    it('enforces the 0.01 minimum when a discount rounds below a cent', async () => {
      const { service } = setup({
        tier: { id: TIER_ID, type: 'percentage_off', baseDiscountPct: new Decimal('90'), isActive: true, conditionsJson: null },
        overrides: [override('0.01', '0.01')],
      });
      const result = (await service.resolveBuyerPricing(BUYER_ID, MERCHANT_ID, [VARIANT]))[0]!;
      // 0.01 * 0.10 = 0.001 → rounds to 0.00 → floored to the 0.01 minimum
      expect(result.resolvedPrice).toBe('0.01');
    });

    it('throws PRICE_OUT_OF_RANGE above the maximum', async () => {
      const { service } = setup({
        tier: { id: TIER_ID, type: 'percentage_off', baseDiscountPct: new Decimal('0'), isActive: true, conditionsJson: null },
        overrides: [override('1000000.00', '1000000.00')],
      });
      await expect(service.resolveBuyerPricing(BUYER_ID, MERCHANT_ID, [VARIANT])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('fixed_price_list', () => {
    it('passes the override price through and flags manual pricing', async () => {
      const { service } = setup({
        tier: { id: TIER_ID, type: 'fixed_price_list', baseDiscountPct: null, isActive: true, conditionsJson: null },
        overrides: [override('42.50', '99.00')],
      });
      const result = (await service.resolveBuyerPricing(BUYER_ID, MERCHANT_ID, [VARIANT]))[0]!;
      expect(result.resolvedPrice).toBe('42.50');
      expect(result.appliedTierType).toBe('fixed_price_list');
      expect(result.requiresManualPricing).toBe(true);
    });
  });

  describe('volume_breaks (order line resolution)', () => {
    const tier = {
      id: TIER_ID,
      type: 'volume_breaks' as const,
      baseDiscountPct: null,
      isActive: true,
      conditionsJson: brackets([
        { minQty: 1, discountPct: 0 },
        { minQty: 10, discountPct: 10 },
        { minQty: 50, discountPct: 20 },
      ]),
    };

    async function price(quantity: number): Promise<string> {
      const { service } = setup({ tier, overrides: [override('100.00', '100.00')] });
      const lines: OrderLineInput[] = [{ shopifyVariantId: VARIANT, quantity }];
      const line = (await service.resolveOrderLinePricing(BUYER_ID, MERCHANT_ID, lines))[0]!;
      return line.unitPrice;
    }

    it('selects the minQty=1 bracket at quantity 1', async () => {
      expect(await price(1)).toBe('100.00');
    });

    it('stays in the first bracket just below the next boundary (qty 9)', async () => {
      expect(await price(9)).toBe('100.00');
    });

    it('selects the 10% bracket exactly at its boundary (qty 10)', async () => {
      expect(await price(10)).toBe('90.00');
    });

    it('stays in the 10% bracket just below the top boundary (qty 49)', async () => {
      expect(await price(49)).toBe('90.00');
    });

    it('selects the 20% bracket exactly at its boundary (qty 50)', async () => {
      expect(await price(50)).toBe('80.00');
    });

    it('applies the unbounded last bracket above all boundaries (qty 1000)', async () => {
      expect(await price(1000)).toBe('80.00');
    });

    it('records the applied discount and computes the line total', async () => {
      const { service } = setup({ tier, overrides: [override('100.00', '100.00')] });
      const line = (await service.resolveOrderLinePricing(BUYER_ID, MERCHANT_ID, [
        { shopifyVariantId: VARIANT, quantity: 50 },
      ]))[0]!;
      expect(line.unitPrice).toBe('80.00');
      expect(line.lineTotal).toBe('4000.00');
      expect(line.discountPct).toBe('20.00');
      expect(line.appliedTierType).toBe('volume_breaks');
      expect(line.quantity).toBe(50);
    });

    it('rejects a zero quantity', async () => {
      const { service } = setup({ tier, overrides: [override('100.00', '100.00')] });
      await expect(
        service.resolveOrderLinePricing(BUYER_ID, MERCHANT_ID, [{ shopifyVariantId: VARIANT, quantity: 0 }]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('cache key determinism', () => {
    it('produces the same key regardless of variant-id order', () => {
      const { service } = setup({
        tier: { id: TIER_ID, type: 'percentage_off', baseDiscountPct: new Decimal('10'), isActive: true, conditionsJson: null },
        overrides: [],
      });
      const a = service.buildPricingCacheKey(BUYER_ID, MERCHANT_ID, ['v3', 'v1', 'v2']);
      const b = service.buildPricingCacheKey(BUYER_ID, MERCHANT_ID, ['v1', 'v2', 'v3']);
      expect(a).toBe(b);
    });

    it('produces different keys for different id sets', () => {
      const { service } = setup({
        tier: { id: TIER_ID, type: 'percentage_off', baseDiscountPct: new Decimal('10'), isActive: true, conditionsJson: null },
        overrides: [],
      });
      const a = service.buildPricingCacheKey(BUYER_ID, MERCHANT_ID, ['v1', 'v2']);
      const b = service.buildPricingCacheKey(BUYER_ID, MERCHANT_ID, ['v1', 'v3']);
      expect(a).not.toBe(b);
    });
  });

  describe('concurrent cache writes (mocked Redis)', () => {
    it('two concurrent misses resolve to identical deterministic results', async () => {
      const harness = setup({
        tier: { id: TIER_ID, type: 'percentage_off', baseDiscountPct: new Decimal('25'), isActive: true, conditionsJson: null },
        overrides: [override('200.00', '200.00')],
      });
      const [first, second] = await Promise.all([
        harness.service.resolveBuyerPricing(BUYER_ID, MERCHANT_ID, [VARIANT]),
        harness.service.resolveBuyerPricing(BUYER_ID, MERCHANT_ID, [VARIANT]),
      ]);
      expect(first).toEqual(second);
      expect(first[0]?.resolvedPrice).toBe('150.00');
      expect(harness.cacheSet).toHaveBeenCalledTimes(2);
    });
  });

  describe('no tier / unpriceable variants', () => {
    it('flags manual pricing when the buyer has no approved tier (no tier snapshot exists)', async () => {
      // Base prices live in per-tier override snapshots; with no approved tier
      // there is no price source, so the variant is returned for manual pricing.
      const { service } = setup({ tier: null, overrides: [] });
      const result = (await service.resolveBuyerPricing(BUYER_ID, MERCHANT_ID, [VARIANT]))[0]!;
      expect(result.requiresManualPricing).toBe(true);
      expect(result.appliedTierType).toBeNull();
    });

    it('flags a variant with no price snapshot as requiring manual pricing', async () => {
      const { service } = setup({
        tier: { id: TIER_ID, type: 'percentage_off', baseDiscountPct: new Decimal('10'), isActive: true, conditionsJson: null },
        overrides: [],
      });
      const result = (await service.resolveBuyerPricing(BUYER_ID, MERCHANT_ID, ['missing-variant']))[0]!;
      expect(result.requiresManualPricing).toBe(true);
    });
  });
});
