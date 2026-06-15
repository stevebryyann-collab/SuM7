import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { Redis } from 'ioredis';
import {
  BulkPricingOverrideSchema,
  CreatePricingTierSchema,
  CursorPaginationSchema,
  UpdatePricingTierSchema,
  type BulkPricingOverrideInput,
  type CreatePricingTierInput,
  type CursorPaginationInput,
  type DecodedCursor,
  type PaginatedResponse,
  type UpdatePricingTierInput,
} from '@b2b/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService, type PrismaTransaction } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';
import { CatalogService } from '../catalog/catalog.service';
import { REDIS_CACHE } from '../redis/redis.module';

/** Banker's-rounding Decimal for tier price validation. */
const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });
const MIN_OVERRIDE_PRICE = new Money('0.01');

/** Tier summary row (list view) with the count of buyers assigned to it. */
interface PricingTierSummary {
  id: string;
  name: string;
  type: string;
  baseDiscountPct: string | null;
  isDefault: boolean;
  minOrderAmount: string | null;
  priority: number;
  isActive: boolean;
  buyerCount: number;
  createdAt: string;
}

/** A single override row in the tier-detail paginated list. */
interface OverrideSummary {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string | null;
  price: string;
  compareAtPrice: string | null;
  currency: string;
  createdAt: string;
}

/** Tier detail (header + first page of overrides). */
interface PricingTierDetail extends PricingTierSummary {
  conditionsJson: Prisma.JsonValue | null;
  overrides: PaginatedResponse<OverrideSummary>;
}

interface TierWithCountRow {
  id: string;
  name: string;
  type: string;
  baseDiscountPct: Prisma.Decimal | null;
  isDefault: boolean;
  minOrderAmount: Prisma.Decimal | null;
  priority: number;
  isActive: boolean;
  conditionsJson: Prisma.JsonValue | null;
  createdAt: Date;
  buyerCount: bigint;
}

/**
 * Pricing-tier administration (merchant admin only). All routes require a valid
 * merchant session; mutations are restricted by role. After any change that
 * affects resolved buyer prices, both the catalog cache and the pricing cache
 * for the merchant are invalidated so buyers never see a stale price.
 *
 * Override uniqueness is a functional index (COALESCE(variant,'')), so the bulk
 * upsert uses a raw `ON CONFLICT` statement inside a transaction rather than
 * Prisma's compound-unique upsert. Paths are bare-prefixed to align with the
 * earlier controllers; the `api/v1` segment is part of the route here because
 * the prompt specifies it explicitly for this resource.
 */
@Controller('api/v1/pricing-tiers')
@UseGuards(MerchantSessionGuard, RolesGuard)
export class PricingTiersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly catalog: CatalogService,
    @Inject(REDIS_CACHE) private readonly cache: Redis,
  ) {}

  // ── List ─────────────────────────────────────────────────────────────────

  @Get()
  async list(@Req() req: MerchantAuthenticatedRequest): Promise<PricingTierSummary[]> {
    const merchantId = req.merchant!.merchantId;
    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<TierWithCountRow[]>`
        SELECT
          t.id, t.name, t.type::text AS "type",
          t.base_discount_pct AS "baseDiscountPct",
          t.is_default       AS "isDefault",
          t.min_order_amount AS "minOrderAmount",
          t.priority, t.is_active AS "isActive",
          t.conditions_json  AS "conditionsJson",
          t.created_at       AS "createdAt",
          (SELECT COUNT(*) FROM merchant_buyer_relationships r
             WHERE r.pricing_tier_id = t.id) AS "buyerCount"
        FROM pricing_tiers t
        WHERE t.merchant_id = ${merchantId}::uuid
        ORDER BY t.priority DESC, t.created_at DESC`,
    );
    return rows.map((row) => this.toSummary(row));
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  @Post()
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: MerchantAuthenticatedRequest,
    @Body(new ZodValidationPipe(CreatePricingTierSchema)) dto: CreatePricingTierInput,
  ): Promise<{ id: string }> {
    const merchantId = req.merchant!.merchantId;
    const actorId = req.merchant!.userId;

    const created = await this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, merchantId);

      // Only one default tier per merchant — demote any existing default.
      if (dto.isDefault) {
        await tx.pricingTier.updateMany({
          where: { merchantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const tier = await tx.pricingTier.create({
        data: {
          merchantId,
          name: dto.name,
          type: dto.type,
          baseDiscountPct: dto.baseDiscountPct ?? null,
          isDefault: dto.isDefault,
          minOrderAmount: dto.minOrderAmount ?? null,
          priority: dto.priority,
          isActive: dto.isActive,
          conditionsJson: dto.conditionsJson
            ? (dto.conditionsJson as Prisma.InputJsonValue)
            : Prisma.DbNull,
        },
        select: { id: true },
      });

      await this.audit(tx, merchantId, tier.id, 'created', actorId, {
        name: dto.name,
        type: dto.type,
      });
      return tier;
    });

    await this.invalidate(merchantId);
    return { id: created.id };
  }

  // ── Detail (with paginated overrides) ──────────────────────────────────────

  @Get(':id')
  async detail(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query(new ZodValidationPipe(CursorPaginationSchema)) page: CursorPaginationInput,
  ): Promise<PricingTierDetail> {
    const merchantId = req.merchant!.merchantId;

    const tier = await this.merchantContext.run(merchantId, () =>
      this.prisma.$queryRaw<TierWithCountRow[]>`
        SELECT
          t.id, t.name, t.type::text AS "type",
          t.base_discount_pct AS "baseDiscountPct",
          t.is_default       AS "isDefault",
          t.min_order_amount AS "minOrderAmount",
          t.priority, t.is_active AS "isActive",
          t.conditions_json  AS "conditionsJson",
          t.created_at       AS "createdAt",
          (SELECT COUNT(*) FROM merchant_buyer_relationships r
             WHERE r.pricing_tier_id = t.id) AS "buyerCount"
        FROM pricing_tiers t
        WHERE t.id = ${id}::uuid AND t.merchant_id = ${merchantId}::uuid`,
    );
    const header = tier[0];
    if (!header) {
      throw new NotFoundException({ code: 'PRICING_TIER_NOT_FOUND', message: 'Pricing tier not found' });
    }

    const overrides = await this.listOverrides(merchantId, id, page);
    return { ...this.toSummary(header), conditionsJson: header.conditionsJson, overrides };
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  @Patch(':id')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(UpdatePricingTierSchema)) dto: UpdatePricingTierInput,
  ): Promise<void> {
    const merchantId = req.merchant!.merchantId;
    const actorId = req.merchant!.userId;

    await this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, merchantId);

      const existing = await tx.pricingTier.findFirst({
        where: { id, merchantId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'PRICING_TIER_NOT_FOUND',
          message: 'Pricing tier not found',
        });
      }

      if (dto.isDefault === true) {
        await tx.pricingTier.updateMany({
          where: { merchantId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      const data: Prisma.PricingTierUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.baseDiscountPct !== undefined) data.baseDiscountPct = dto.baseDiscountPct;
      if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
      if (dto.minOrderAmount !== undefined) data.minOrderAmount = dto.minOrderAmount;
      if (dto.priority !== undefined) data.priority = dto.priority;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      if (dto.conditionsJson !== undefined) {
        data.conditionsJson = dto.conditionsJson
          ? (dto.conditionsJson as Prisma.InputJsonValue)
          : Prisma.DbNull;
      }

      await tx.pricingTier.update({ where: { id }, data });
      await this.audit(tx, merchantId, id, 'updated', actorId, dto as Prisma.InputJsonValue);
    });

    await this.invalidate(merchantId);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Roles('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    const merchantId = req.merchant!.merchantId;
    const actorId = req.merchant!.userId;

    await this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, merchantId);

      const existing = await tx.pricingTier.findFirst({
        where: { id, merchantId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'PRICING_TIER_NOT_FOUND',
          message: 'Pricing tier not found',
        });
      }

      const buyerCount = await tx.merchantBuyerRelationship.count({
        where: { merchantId, pricingTierId: id },
      });
      if (buyerCount > 0) {
        throw new ConflictException({
          code: 'TIER_HAS_ACTIVE_BUYERS',
          message: 'Cannot delete a tier with assigned buyers',
          count: buyerCount,
        });
      }

      // Overrides cascade-delete via the FK; remove the tier itself.
      await tx.pricingTier.delete({ where: { id } });
      await this.audit(tx, merchantId, id, 'deleted', actorId, null);
    });

    await this.invalidate(merchantId);
  }

  // ── Bulk overrides ─────────────────────────────────────────────────────────

  @Post(':id/overrides/bulk')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  async bulkOverrides(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(BulkPricingOverrideSchema)) dto: BulkPricingOverrideInput,
  ): Promise<{ upserted: number }> {
    const merchantId = req.merchant!.merchantId;
    const actorId = req.merchant!.userId;

    // Every price strictly greater than 0.01 (Decimal — never float).
    for (const override of dto.overrides) {
      if (new Money(override.price).lessThanOrEqualTo(MIN_OVERRIDE_PRICE)) {
        throw new BadRequestException({
          code: 'INVALID_OVERRIDE_PRICE',
          message: `Override price must be greater than ${MIN_OVERRIDE_PRICE.toFixed(2)}`,
          shopifyProductId: override.shopifyProductId,
        });
      }
    }

    const upserted = await this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, merchantId);

      const tier = await tx.pricingTier.findFirst({
        where: { id, merchantId },
        select: { id: true },
      });
      if (!tier) {
        throw new NotFoundException({
          code: 'PRICING_TIER_NOT_FOUND',
          message: 'Pricing tier not found',
        });
      }

      for (const override of dto.overrides) {
        await tx.$executeRaw`
          INSERT INTO pricing_tier_overrides
            (pricing_tier_id, shopify_product_id, shopify_variant_id, price, compare_at_price, currency)
          VALUES (
            ${id}::uuid,
            ${override.shopifyProductId},
            ${override.shopifyVariantId ?? null},
            ${new Money(override.price).toFixed(2)}::numeric,
            ${override.compareAtPrice ? new Money(override.compareAtPrice).toFixed(2) : null}::numeric,
            ${override.currency}
          )
          ON CONFLICT (pricing_tier_id, shopify_product_id, COALESCE(shopify_variant_id, ''))
          DO UPDATE SET
            price = EXCLUDED.price,
            compare_at_price = EXCLUDED.compare_at_price,
            currency = EXCLUDED.currency`;
      }

      await this.audit(tx, merchantId, id, 'overrides_bulk_upserted', actorId, {
        count: dto.overrides.length,
      });
      return dto.overrides.length;
    });

    await this.invalidate(merchantId);
    return { upserted };
  }

  @Delete(':id/overrides/:overrideId')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOverride(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('overrideId', new ParseUUIDPipe({ version: '4' })) overrideId: string,
  ): Promise<void> {
    const merchantId = req.merchant!.merchantId;
    const actorId = req.merchant!.userId;

    await this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, merchantId);

      const tier = await tx.pricingTier.findFirst({
        where: { id, merchantId },
        select: { id: true },
      });
      if (!tier) {
        throw new NotFoundException({
          code: 'PRICING_TIER_NOT_FOUND',
          message: 'Pricing tier not found',
        });
      }

      const deleted = await tx.pricingTierOverride.deleteMany({
        where: { id: overrideId, pricingTierId: id },
      });
      if (deleted.count === 0) {
        throw new NotFoundException({
          code: 'OVERRIDE_NOT_FOUND',
          message: 'Override not found',
        });
      }

      await this.audit(tx, merchantId, id, 'override_deleted', actorId, { overrideId });
    });

    await this.invalidate(merchantId);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async listOverrides(
    merchantId: string,
    tierId: string,
    params: CursorPaginationInput,
  ): Promise<PaginatedResponse<OverrideSummary>> {
    const cursor = this.decodeCursor(params.cursor);
    const where: Prisma.PricingTierOverrideWhereInput = { pricingTierId: tierId };
    if (cursor) {
      where.OR = [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      ];
    }

    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.pricingTierOverride.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: params.limit + 1,
        select: {
          id: true,
          shopifyProductId: true,
          shopifyVariantId: true,
          price: true,
          compareAtPrice: true,
          currency: true,
          createdAt: true,
        },
      }),
    );

    const hasNextPage = rows.length > params.limit;
    const pageRows = hasNextPage ? rows.slice(0, params.limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const endCursor =
      hasNextPage && last
        ? this.encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null;

    return {
      data: pageRows.map((row) => ({
        id: row.id,
        shopifyProductId: row.shopifyProductId,
        shopifyVariantId: row.shopifyVariantId,
        price: row.price.toFixed(2),
        compareAtPrice: row.compareAtPrice ? row.compareAtPrice.toFixed(2) : null,
        currency: row.currency,
        createdAt: row.createdAt.toISOString(),
      })),
      pageInfo: { hasNextPage, endCursor },
    };
  }

  private toSummary(row: TierWithCountRow): PricingTierSummary {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      baseDiscountPct: row.baseDiscountPct ? row.baseDiscountPct.toFixed(2) : null,
      isDefault: row.isDefault,
      minOrderAmount: row.minOrderAmount ? row.minOrderAmount.toFixed(2) : null,
      priority: row.priority,
      isActive: row.isActive,
      buyerCount: Number(row.buyerCount),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Invalidate both catalog and pricing caches for the merchant after a change. */
  private async invalidate(merchantId: string): Promise<void> {
    await this.catalog.invalidateMerchantCatalog(merchantId);
    const pattern = `pricing:*:${merchantId}:*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.cache.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await this.cache.del(...keys);
      }
    } while (cursor !== '0');
  }

  private async audit(
    tx: PrismaTransaction,
    merchantId: string,
    tierId: string,
    action: string,
    actorId: string,
    newValueJson: Prisma.InputJsonValue | null,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        merchantId,
        entityType: 'pricing_tier',
        entityId: tierId,
        action,
        actorType: 'merchant_user',
        actorId,
        ...(newValueJson !== null ? { newValueJson } : {}),
      },
    });
  }

  private async setTenant(tx: PrismaTransaction, merchantId: string): Promise<void> {
    if (!/^[0-9a-fA-F-]{36}$/.test(merchantId)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'Malformed merchant id' });
    }
    await tx.$executeRawUnsafe(`SET LOCAL app.current_merchant_id = '${merchantId}'`);
  }

  private encodeCursor(cursor: DecodedCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64');
  }

  private decodeCursor(raw: string | undefined): DecodedCursor | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Partial<DecodedCursor>;
      if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
        return { createdAt: parsed.createdAt, id: parsed.id };
      }
    } catch {
      // fall through
    }
    throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Malformed pagination cursor' });
  }
}
