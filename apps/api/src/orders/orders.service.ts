import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { addDays } from "date-fns";
import * as Sentry from "@sentry/node";
import type {
  BulkOrderInput,
  DecodedCursor,
  PaginatedResponse,
  PaymentTerms,
  ResolvedOrderLine,
} from "@b2b/shared";
import {
  PrismaService,
  type PrismaTransaction,
} from "../prisma/prisma.service";
import { MerchantContextService } from "../prisma/merchant-context.service";
import { PricingService } from "../pricing/pricing.service";
import { ShopifyApiService } from "../shopify/shopify-api.service";
import { PAYMENT_TERMS_DAYS } from "../workers/worker-helpers";
import type { ShopifyDraftOrderInput } from "../shopify/shopify.types";

/** Banker's-rounding Decimal — all order money math is deterministic. */
const Money = Decimal.clone({
  rounding: Decimal.ROUND_HALF_EVEN,
  precision: 40,
});
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CREDIT_CAS_RETRIES = 3;
const SERIALIZABLE_RETRIES = 3;

/** Result returned to the buyer after a successful bulk-order placement. */
export interface OrderCreatedResult {
  orderId: string;
  shopifyOrderNumber: string;
  subtotal: string;
  total: string;
  currency: string;
  paymentTerms: PaymentTerms;
  dueDate: string | null;
  estimatedInvoiceDelivery: string;
  containsBackOrder: boolean;
  backOrderItems: string[];
}

/** Compact order row for list views (merchant + buyer). */
export interface OrderSummary {
  id: string;
  shopifyOrderNumber: string | null;
  buyerCompanyName: string | null;
  status: string;
  /** Shopify sync state — drives the merchant list "Sync Status" column. */
  syncStatus: string;
  /** Number of distinct line items on the order. */
  itemCount: number;
  subtotal: string;
  total: string;
  currency: string;
  paymentTerms: PaymentTerms | null;
  dueDate: string | null;
  createdAt: string;
  invoiceStatus: string | null;
  invoiceDueDate: string | null;
}

/** A single line on a full order detail view. */
export interface OrderLineDetail {
  shopifyVariantId: string | null;
  shopifyProductId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  appliedTierType: string | null;
  discountPct: string | null;
  currency: string;
}

/** Full order detail (header + line items + invoice summary) for `GET /orders/:id`. */
export interface OrderDetail {
  id: string;
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  buyerId: string;
  buyerCompanyName: string | null;
  status: string;
  syncStatus: string;
  subtotal: string;
  taxAmount: string;
  shippingAmount: string;
  total: string;
  currency: string;
  paymentTerms: PaymentTerms | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  // Part 2/3: back-order flag + fulfillment tracking (surfaced in the buyer portal).
  containsBackOrder: boolean;
  trackingNumber: string | null;
  trackingUrl: string | null;
  fulfillmentService: string | null;
  shippedAt: string | null;
  estimatedDeliveryAt: string | null;
  lineItems: OrderLineDetail[];
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    dueDate: string;
    total: string;
    amountPaid: string;
  } | null;
}

export interface CursorPaginationParams {
  cursor?: string;
  limit: number;
}

export interface OrderFilters {
  status?: string;
  buyerId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Sentinel for an optimistic-lock (version CAS) miss — drives the retry loop. */
class CreditCasMiss extends Error {}

/** Snapshot of the relationship after credit has been reserved. */
interface ReservedRelationship {
  relationshipId: string;
  paymentTerms: PaymentTerms;
  pricingTierId: string | null;
}

interface RelationshipRow {
  id: string;
  approvalStatus: string;
  paymentTerms: PaymentTerms;
  pricingTierId: string | null;
  creditLimit: Prisma.Decimal | null;
  creditUsed: Prisma.Decimal;
  creditVersion: number;
}

/**
 * Order domain — buyer bulk ordering with financial-grade safety.
 *
 * `createBulkOrder` never trusts client prices: it re-resolves every line through
 * {@link PricingService} (the system of record), reserves credit with an
 * optimistic version CAS, pushes the order to Shopify (with compensating
 * delete/release on failure), then persists locally inside a SERIALIZABLE
 * transaction that retries on serialization conflicts. Request-replay idempotency
 * is enforced upstream by IdempotencyMiddleware (which caches the full
 * OrderCreatedResult under the Idempotency-Key for 24h); the key is carried here
 * for audit/tracing and to tag the Shopify draft.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
    private readonly pricing: PricingService,
    private readonly shopify: ShopifyApiService,
  ) {}

  async createBulkOrder(
    buyerId: string,
    merchantId: string,
    dto: BulkOrderInput,
    idempotencyKey: string,
    discountCodesService?: any, // Injected via controller
    inventoryService?: any, // Injected via controller
  ): Promise<OrderCreatedResult> {
    this.assertUuid(merchantId);
    this.assertUuid(buyerId);

    // Step 3 (part): merchant must be active with a valid trial or subscription.
    const merchant = await this.loadActiveMerchant(merchantId);

    // Step 4: SERVER-SIDE PRICING — the only prices that count. Client values
    // in the DTO are never read for money; only product/variant ids + quantity.
    const resolved = await this.pricing.resolveOrderLinePricing(
      buyerId,
      merchantId,
      dto.lineItems.map((li) => ({
        shopifyVariantId: li.shopifyVariantId,
        quantity: li.quantity,
      })),
    );
    if (resolved.length === 0) {
      throw new BadRequestException({
        code: "EMPTY_ORDER",
        message: "Order has no line items",
      });
    }

    const currency = resolved[0]?.currency ?? "USD";
    let subtotal = this.sumLineTotals(resolved);

    // Part 2 of 4: Validate discount code if provided
    let discountCodeId: string | null = null;
    let discountAmount = new Money(0);
    if (dto.discountCode && discountCodesService) {
      const validation = await discountCodesService.validateCode(
        merchantId,
        dto.discountCode,
        subtotal,
      );
      if (!validation.valid) {
        throw new BadRequestException({
          code: "INVALID_DISCOUNT_CODE",
          reason: validation.invalidReason,
        });
      }
      discountCodeId = validation.code!.id;
      discountAmount = validation.discountAmount!;
      subtotal = validation.discountedTotal!;
    }

    // Part 2 of 4: Check inventory and back-order status
    let containsBackOrder = false;
    const backOrderItems: string[] = [];
    if (inventoryService) {
      const variantIds = resolved.map((line) => line.shopifyVariantId);
      const inventory = await inventoryService.getInventoryForVariants(
        merchantId,
        merchant.shopifyAccessToken,
        variantIds,
      );

      for (const line of resolved) {
        const level = inventory.get(line.shopifyVariantId);
        if (level && level.status === "out_of_stock") {
          if (!level.allowsBackOrder) {
            throw new BadRequestException({
              code: "OUT_OF_STOCK_ITEMS",
              items: [
                {
                  shopifyVariantId: line.shopifyVariantId,
                  productTitle: line.productTitle,
                  variantTitle: line.variantTitle,
                },
              ],
            });
          }
          containsBackOrder = true;
          backOrderItems.push(line.shopifyVariantId);
        }
      }
    }

    // Steps 2 + 6: FOR SHARE the relationship (blocks concurrent approval /
    // suspension changes) and reserve credit with an optimistic version CAS.
    const reserved = await this.verifyAndReserveCredit(
      merchantId,
      buyerId,
      subtotal,
    );

    const paymentTerms = reserved.paymentTerms;
    const dueDate = this.computeDueDate(paymentTerms);

    // Step 5: minimum order check against the resolved (server) subtotal (after discount).
    await this.enforceMinimumOrder(
      merchantId,
      reserved.pricingTierId,
      subtotal,
    );

    // Steps 7–9: create + complete the Shopify draft order. Any failure releases
    // the reserved credit so a rejected order never consumes the buyer's limit.
    let shopifyOrderId: string;
    let shopifyOrderNumber: string;
    try {
      const draftInput = this.buildDraftOrderInput(
        resolved,
        currency,
        dto.notes,
        idempotencyKey,
      );
      const draft = await this.shopify.createDraftOrder(
        merchant.shopifyDomain,
        merchant.shopifyAccessToken,
        draftInput,
      );
      const draftOrderId = String(draft.id);
      try {
        const order = await this.shopify.completeDraftOrder(
          merchant.shopifyDomain,
          merchant.shopifyAccessToken,
          draftOrderId,
        );
        shopifyOrderId = String(order.id);
        shopifyOrderNumber = String(order.order_number);
      } catch (completeError) {
        await this.deleteDraftBestEffort(
          merchant.shopifyDomain,
          merchant.shopifyAccessToken,
          draftOrderId,
        );
        throw completeError;
      }
    } catch (shopifyError) {
      await this.releaseCredit(merchantId, buyerId, subtotal);
      throw shopifyError;
    }

    // Step 10: persist locally in a SERIALIZABLE transaction (retries on 40001).
    // The credit reservation from step 6 is authoritative — the transaction
    // records the order against it and does not re-charge credit.
    let orderId: string;
    try {
      orderId = await this.persistOrder({
        merchantId,
        buyerId,
        shopifyOrderId,
        shopifyOrderNumber,
        subtotal,
        currency,
        paymentTerms,
        dueDate,
        pricingTierIdAtOrder: reserved.pricingTierId,
        notes: dto.notes ?? null,
        lines: resolved,
        discountCodeId,
        discountAmount,
        containsBackOrder,
      });

      // Apply discount code usage increment inside transaction
      if (discountCodeId && discountCodesService) {
        await discountCodesService.applyCodeToOrder(discountCodeId);
      }
    } catch (persistError) {
      // The order exists in Shopify but could not be recorded locally. Release the
      // reserved credit and flag for reconciliation (a Shopify cancel endpoint is
      // out of scope of the current ShopifyApiService).
      await this.releaseCredit(merchantId, buyerId, subtotal);
      Sentry.captureException(persistError, {
        level: "fatal",
        tags: {
          component: "orders",
          stage: "persist",
          syncStatus: "shopify_orphan",
        },
        extra: { merchantId, buyerId, shopifyOrderId, idempotencyKey },
      });
      this.logger.error(
        `Order persist failed for Shopify order ${shopifyOrderId} (shopify_orphan): ${(persistError as Error).message}`,
      );
      if (this.isSerializationFailure(persistError)) {
        throw new ConflictException({
          code: "SERIALIZATION_FAILURE",
          message:
            "Order could not be recorded due to a write conflict; please retry",
        });
      }
      throw persistError;
    }

    // Step 11: audit (quantities + variant ids only — never prices).
    await this.writeOrderAudit(merchantId, buyerId, orderId, resolved);

    return {
      orderId,
      shopifyOrderNumber,
      subtotal: subtotal.toFixed(2),
      total: subtotal.toFixed(2),
      currency,
      paymentTerms,
      dueDate: dueDate ? dueDate.toISOString() : null,
      estimatedInvoiceDelivery: "within 60 seconds",
      containsBackOrder,
      backOrderItems,
    };
  }

  // ── Merchant orders list (cursor paginated) ─────────────────────────────

  async getOrdersForMerchant(
    merchantId: string,
    params: CursorPaginationParams & OrderFilters,
  ): Promise<PaginatedResponse<OrderSummary>> {
    this.assertUuid(merchantId);
    const cursor = this.decodeCursor(params.cursor);
    const where: Prisma.OrderWhereInput = { merchantId };
    if (params.status)
      where.status = params.status as Prisma.OrderWhereInput["status"];
    if (params.buyerId) where.buyerId = params.buyerId;
    const createdAt = this.dateRange(params.dateFrom, params.dateTo);
    if (createdAt) where.createdAt = createdAt;
    if (cursor) {
      where.OR = [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      ];
    }

    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: params.limit + 1,
        select: this.orderSelect(),
      }),
    );
    return this.toPage(rows, params.limit);
  }

  async getOrdersForBuyer(
    buyerId: string,
    merchantId: string,
    params: CursorPaginationParams,
  ): Promise<PaginatedResponse<OrderSummary>> {
    this.assertUuid(merchantId);
    this.assertUuid(buyerId);
    const cursor = this.decodeCursor(params.cursor);
    // Application-layer scoping (WHERE buyerId AND merchantId) AND RLS both apply.
    const where: Prisma.OrderWhereInput = { merchantId, buyerId };
    if (cursor) {
      where.OR = [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      ];
    }

    const rows = await this.merchantContext.run(merchantId, () =>
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: params.limit + 1,
        select: this.orderSelect(),
      }),
    );
    return this.toPage(rows, params.limit);
  }

  // ── Single order detail ─────────────────────────────────────────────────

  /**
   * Full order detail for a single order. Scoped to the merchant (application
   * `where` + RLS); when `buyerId` is supplied (buyer portal) ownership is
   * enforced too. Throws `ORDER_NOT_FOUND` when nothing matches the scope.
   */
  async getOrderDetail(
    merchantId: string,
    orderId: string,
    buyerId?: string,
  ): Promise<OrderDetail> {
    this.assertUuid(merchantId);
    this.assertUuid(orderId);
    if (buyerId) this.assertUuid(buyerId);

    const where: Prisma.OrderWhereInput = { id: orderId, merchantId };
    if (buyerId) where.buyerId = buyerId;

    const order = await this.merchantContext.run(merchantId, () =>
      this.prisma.order.findFirst({
        where,
        select: {
          id: true,
          shopifyOrderId: true,
          shopifyOrderNumber: true,
          buyerId: true,
          status: true,
          syncStatus: true,
          subtotal: true,
          taxAmount: true,
          shippingAmount: true,
          total: true,
          currency: true,
          paymentTerms: true,
          dueDate: true,
          notes: true,
          createdAt: true,
          containsBackOrder: true,
          trackingNumber: true,
          trackingUrl: true,
          fulfillmentService: true,
          shippedAt: true,
          estimatedDeliveryAt: true,
          buyer: { select: { companyName: true } },
          lineItems: {
            select: {
              shopifyVariantId: true,
              shopifyProductId: true,
              productTitle: true,
              variantTitle: true,
              sku: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
              appliedTierType: true,
              discountPct: true,
              currency: true,
            },
          },
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              dueDate: true,
              total: true,
              amountPaid: true,
            },
          },
        },
      }),
    );
    if (!order) {
      throw new NotFoundException({
        code: "ORDER_NOT_FOUND",
        message: "Order not found",
      });
    }

    return {
      id: order.id,
      shopifyOrderId: order.shopifyOrderId,
      shopifyOrderNumber: order.shopifyOrderNumber,
      buyerId: order.buyerId,
      buyerCompanyName: order.buyer?.companyName ?? null,
      status: order.status,
      syncStatus: order.syncStatus,
      subtotal: order.subtotal.toFixed(2),
      taxAmount: order.taxAmount.toFixed(2),
      shippingAmount: order.shippingAmount.toFixed(2),
      total: order.total.toFixed(2),
      currency: order.currency,
      paymentTerms: order.paymentTerms,
      dueDate: order.dueDate ? order.dueDate.toISOString() : null,
      notes: order.notes,
      createdAt: order.createdAt.toISOString(),
      containsBackOrder: order.containsBackOrder,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      fulfillmentService: order.fulfillmentService,
      shippedAt: order.shippedAt ? order.shippedAt.toISOString() : null,
      estimatedDeliveryAt: order.estimatedDeliveryAt
        ? order.estimatedDeliveryAt.toISOString()
        : null,
      lineItems: order.lineItems.map((li) => ({
        shopifyVariantId: li.shopifyVariantId,
        shopifyProductId: li.shopifyProductId,
        productTitle: li.productTitle,
        variantTitle: li.variantTitle,
        sku: li.sku,
        quantity: li.quantity,
        unitPrice: li.unitPrice.toFixed(2),
        lineTotal: li.lineTotal.toFixed(2),
        appliedTierType: li.appliedTierType,
        discountPct: li.discountPct ? li.discountPct.toFixed(2) : null,
        currency: li.currency,
      })),
      invoice: order.invoice
        ? {
            id: order.invoice.id,
            invoiceNumber: order.invoice.invoiceNumber,
            status: order.invoice.status,
            dueDate: order.invoice.dueDate.toISOString(),
            total: order.invoice.total.toFixed(2),
            amountPaid: order.invoice.amountPaid.toFixed(2),
          }
        : null,
    };
  }

  // ── Pricing / totals helpers ────────────────────────────────────────────

  private sumLineTotals(lines: ResolvedOrderLine[]): Decimal {
    return lines
      .reduce((acc, line) => acc.plus(new Money(line.lineTotal)), new Money(0))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  }

  private computeDueDate(paymentTerms: PaymentTerms): Date | null {
    const days = PAYMENT_TERMS_DAYS[paymentTerms];
    return days > 0 ? addDays(new Date(), days) : null;
  }

  private async enforceMinimumOrder(
    merchantId: string,
    pricingTierId: string | null,
    subtotal: Decimal,
  ): Promise<void> {
    if (!pricingTierId) return;
    const tier = await this.merchantContext.run(merchantId, () =>
      this.prisma.pricingTier.findUnique({
        where: { id: pricingTierId },
        select: { minOrderAmount: true },
      }),
    );
    if (!tier?.minOrderAmount) return;
    const minimum = new Money(tier.minOrderAmount.toString());
    if (subtotal.lessThan(minimum)) {
      throw new BadRequestException({
        code: "MINIMUM_ORDER_NOT_MET",
        message: `Order subtotal ${subtotal.toFixed(2)} is below the minimum of ${minimum.toFixed(2)}`,
        minimumAmount: minimum.toFixed(2),
        currentAmount: subtotal.toFixed(2),
      });
    }
  }

  private buildDraftOrderInput(
    lines: ResolvedOrderLine[],
    currency: string,
    notes: string | undefined,
    idempotencyKey: string,
  ): ShopifyDraftOrderInput {
    return {
      line_items: lines.map((line) => {
        const variantId = Number(line.shopifyVariantId);
        if (!Number.isSafeInteger(variantId)) {
          throw new BadRequestException({
            code: "INVALID_VARIANT_ID",
            message: `Variant id ${line.shopifyVariantId} is not a valid Shopify id`,
          });
        }
        // Provide our resolved unit price so Shopify uses the system-of-record
        // price, not the storefront price.
        return {
          variant_id: variantId,
          quantity: line.quantity,
          price: line.unitPrice,
          ...(line.sku ? { sku: line.sku } : {}),
        };
      }),
      currency,
      note: notes ?? undefined,
      tags: `wholesale-portal,idem:${idempotencyKey}`,
    };
  }

  // ── Credit reservation (FOR SHARE + optimistic CAS) ─────────────────────

  private async verifyAndReserveCredit(
    merchantId: string,
    buyerId: string,
    orderTotal: Decimal,
  ): Promise<ReservedRelationship> {
    for (let attempt = 0; attempt < CREDIT_CAS_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.setTenant(tx, merchantId);

          const rows = await tx.$queryRaw<RelationshipRow[]>`
            SELECT id,
                   approval_status   AS "approvalStatus",
                   payment_terms     AS "paymentTerms",
                   pricing_tier_id   AS "pricingTierId",
                   credit_limit      AS "creditLimit",
                   credit_used       AS "creditUsed",
                   credit_version    AS "creditVersion"
            FROM merchant_buyer_relationships
            WHERE merchant_id = ${merchantId}::uuid AND buyer_id = ${buyerId}::uuid
            FOR SHARE`;

          const rel = rows[0];
          if (!rel) {
            throw new ForbiddenException({
              code: "NO_RELATIONSHIP",
              message: "No relationship with this merchant",
            });
          }
          if (rel.approvalStatus === "suspended") {
            throw new ForbiddenException({
              code: "BUYER_SUSPENDED",
              message: "Account suspended",
            });
          }
          if (rel.approvalStatus !== "approved") {
            throw new ForbiddenException({
              code: "BUYER_NOT_APPROVED",
              message: "Account not approved",
            });
          }

          if (rel.creditLimit !== null) {
            const limit = new Money(rel.creditLimit.toString());
            const used = new Money(rel.creditUsed.toString());
            if (used.plus(orderTotal).greaterThan(limit)) {
              throw new BadRequestException({
                code: "CREDIT_LIMIT_EXCEEDED",
                message: "This order would exceed the available credit limit",
                creditLimit: limit.toFixed(2),
                creditUsed: used.toFixed(2),
                orderTotal: orderTotal.toFixed(2),
              });
            }
          }

          const updated = await tx.$executeRaw`
            UPDATE merchant_buyer_relationships
            SET credit_used = credit_used + ${orderTotal.toFixed(2)}::numeric,
                credit_version = credit_version + 1,
                updated_at = NOW()
            WHERE id = ${rel.id}::uuid AND credit_version = ${rel.creditVersion}`;
          if (updated === 0) {
            throw new CreditCasMiss();
          }

          return {
            relationshipId: rel.id,
            paymentTerms: rel.paymentTerms,
            pricingTierId: rel.pricingTierId,
          };
        });
      } catch (error) {
        if (error instanceof CreditCasMiss) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException({
      code: "CONCURRENT_MODIFICATION",
      message: "Credit limit was modified concurrently; please retry",
    });
  }

  /** Best-effort credit release used when the order fails after reservation. */
  private async releaseCredit(
    merchantId: string,
    buyerId: string,
    amount: Decimal,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.setTenant(tx, merchantId);
        await tx.$executeRaw`
          UPDATE merchant_buyer_relationships
          SET credit_used = GREATEST(credit_used - ${amount.toFixed(2)}::numeric, 0),
              credit_version = credit_version + 1,
              updated_at = NOW()
          WHERE merchant_id = ${merchantId}::uuid AND buyer_id = ${buyerId}::uuid`;
      });
    } catch (error) {
      Sentry.captureException(error, {
        level: "error",
        tags: { component: "orders", stage: "credit_release" },
        extra: { merchantId, buyerId, amount: amount.toFixed(2) },
      });
      this.logger.error(
        `Failed to release reserved credit: ${(error as Error).message}`,
      );
    }
  }

  // ── Order persistence (SERIALIZABLE + retry) ────────────────────────────

  private async persistOrder(params: {
    merchantId: string;
    buyerId: string;
    shopifyOrderId: string;
    shopifyOrderNumber: string;
    subtotal: Decimal;
    currency: string;
    paymentTerms: PaymentTerms;
    dueDate: Date | null;
    pricingTierIdAtOrder: string | null;
    notes: string | null;
    lines: ResolvedOrderLine[];
    discountCodeId?: string | null;
    discountAmount?: Decimal;
    containsBackOrder?: boolean;
  }): Promise<string> {
    const subtotalStr = params.subtotal.toFixed(2);
    const discountAmountStr = params.discountAmount?.toFixed(2) ?? "0";
    for (let attempt = 0; attempt < SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await this.setTenant(tx, params.merchantId);

            const order = await tx.order.upsert({
              where: { shopifyOrderId: params.shopifyOrderId },
              update: {
                subtotal: subtotalStr,
                taxAmount: "0",
                shippingAmount: "0",
                total: subtotalStr,
                currency: params.currency,
                paymentTerms: params.paymentTerms,
                dueDate: params.dueDate,
                status: "confirmed",
                syncStatus: "synced",
                pricingTierIdAtOrder: params.pricingTierIdAtOrder,
                notes: params.notes,
                discountCodeId: params.discountCodeId ?? null,
                discountAmount: discountAmountStr,
                containsBackOrder: params.containsBackOrder ?? false,
              },
              create: {
                merchantId: params.merchantId,
                buyerId: params.buyerId,
                shopifyOrderId: params.shopifyOrderId,
                shopifyOrderNumber: params.shopifyOrderNumber,
                subtotal: subtotalStr,
                taxAmount: "0",
                shippingAmount: "0",
                total: subtotalStr,
                currency: params.currency,
                paymentTerms: params.paymentTerms,
                dueDate: params.dueDate,
                status: "confirmed",
                syncStatus: "synced",
                pricingTierIdAtOrder: params.pricingTierIdAtOrder,
                notes: params.notes,
                discountCodeId: params.discountCodeId ?? null,
                discountAmount: discountAmountStr,
                containsBackOrder: params.containsBackOrder ?? false,
              },
              select: { id: true },
            });

            await tx.orderLineItem.deleteMany({ where: { orderId: order.id } });
            await tx.orderLineItem.createMany({
              data: params.lines.map((line) => ({
                orderId: order.id,
                shopifyVariantId: line.shopifyVariantId,
                shopifyProductId: line.shopifyProductId,
                productTitle: line.productTitle,
                variantTitle: line.variantTitle,
                sku: line.sku,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                lineTotal: line.lineTotal,
                appliedTierType: line.appliedTierType,
                discountPct: line.discountPct,
                currency: line.currency,
              })),
            });

            return order.id;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          this.isSerializationFailure(error) &&
          attempt < SERIALIZABLE_RETRIES - 1
        ) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
        throw error;
      }
    }
    // Unreachable: the loop returns or throws on the final attempt.
    throw new ConflictException({
      code: "SERIALIZATION_FAILURE",
      message: "Order could not be recorded after retries",
    });
  }

  private async writeOrderAudit(
    merchantId: string,
    buyerId: string,
    orderId: string,
    lines: ResolvedOrderLine[],
  ): Promise<void> {
    try {
      await this.merchantContext.run(merchantId, () =>
        this.prisma.auditLog.create({
          data: {
            merchantId,
            entityType: "order",
            entityId: orderId,
            action: "created",
            actorType: "buyer",
            actorId: buyerId,
            newValueJson: {
              lineItems: lines.map((line) => ({
                shopifyVariantId: line.shopifyVariantId,
                quantity: line.quantity,
              })),
            },
          },
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to write order audit log: ${(error as Error).message}`,
      );
    }
  }

  // ── Shopify compensation ────────────────────────────────────────────────

  private async deleteDraftBestEffort(
    domain: string,
    token: string,
    draftOrderId: string,
  ): Promise<void> {
    try {
      await this.shopify.deleteDraftOrder(domain, token, draftOrderId);
    } catch (deleteError) {
      Sentry.captureException(deleteError, {
        level: "fatal",
        tags: {
          component: "orders",
          stage: "draft_cleanup",
          syncStatus: "shopify_orphan",
        },
        extra: { domain, draftOrderId },
      });
      this.logger.error(
        `Failed to delete orphaned Shopify draft ${draftOrderId}: ${(deleteError as Error).message}`,
      );
    }
  }

  // ── Data loading ────────────────────────────────────────────────────────

  private async loadActiveMerchant(
    merchantId: string,
  ): Promise<{ shopifyDomain: string; shopifyAccessToken: string }> {
    const merchant = await this.merchantContext.runAsSystem(() =>
      this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: {
          shopifyDomain: true,
          shopifyAccessToken: true,
          isActive: true,
          trialEndsAt: true,
          subscriptionPaddleId: true,
        },
      }),
    );
    if (!merchant || !merchant.isActive) {
      throw new ForbiddenException({
        code: "MERCHANT_INACTIVE",
        message: "Merchant account is inactive",
      });
    }
    const trialActive =
      merchant.trialEndsAt !== null &&
      merchant.trialEndsAt.getTime() > Date.now();
    const hasSubscription = Boolean(merchant.subscriptionPaddleId);
    if (!trialActive && !hasSubscription) {
      throw new ForbiddenException({
        code: "SUBSCRIPTION_REQUIRED",
        message:
          "Merchant trial has expired and no active subscription is present",
      });
    }
    return {
      shopifyDomain: merchant.shopifyDomain,
      shopifyAccessToken: merchant.shopifyAccessToken,
    };
  }

  private orderSelect(): Prisma.OrderSelect {
    return {
      id: true,
      shopifyOrderNumber: true,
      status: true,
      syncStatus: true,
      subtotal: true,
      total: true,
      currency: true,
      paymentTerms: true,
      dueDate: true,
      createdAt: true,
      buyer: { select: { companyName: true } },
      invoice: { select: { status: true, dueDate: true } },
      _count: { select: { lineItems: true } },
    };
  }

  private toPage(
    rows: Array<{
      id: string;
      shopifyOrderNumber: string | null;
      status: string;
      syncStatus: string;
      subtotal: Prisma.Decimal;
      total: Prisma.Decimal;
      currency: string;
      paymentTerms: PaymentTerms | null;
      dueDate: Date | null;
      createdAt: Date;
      buyer: { companyName: string } | null;
      invoice: { status: string; dueDate: Date } | null;
      _count: { lineItems: number };
    }>,
    limit: number,
  ): PaginatedResponse<OrderSummary> {
    const hasNextPage = rows.length > limit;
    const page = hasNextPage ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const endCursor =
      hasNextPage && last
        ? this.encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null;

    return {
      data: page.map((row) => ({
        id: row.id,
        shopifyOrderNumber: row.shopifyOrderNumber,
        buyerCompanyName: row.buyer?.companyName ?? null,
        status: row.status,
        syncStatus: row.syncStatus,
        itemCount: row._count.lineItems,
        subtotal: row.subtotal.toFixed(2),
        total: row.total.toFixed(2),
        currency: row.currency,
        paymentTerms: row.paymentTerms,
        dueDate: row.dueDate ? row.dueDate.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        invoiceStatus: row.invoice?.status ?? null,
        invoiceDueDate: row.invoice?.dueDate
          ? row.invoice.dueDate.toISOString()
          : null,
      })),
      pageInfo: { hasNextPage, endCursor },
    };
  }

  // ── Cursor + small utilities ────────────────────────────────────────────

  private encodeCursor(cursor: DecodedCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
  }

  private decodeCursor(raw: string | undefined): DecodedCursor | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(raw, "base64").toString("utf8"),
      ) as Partial<DecodedCursor>;
      if (
        typeof parsed.createdAt === "string" &&
        typeof parsed.id === "string"
      ) {
        return { createdAt: parsed.createdAt, id: parsed.id };
      }
    } catch {
      // fall through to the invalid-cursor error
    }
    throw new BadRequestException({
      code: "INVALID_CURSOR",
      message: "Malformed pagination cursor",
    });
  }

  private dateRange(
    from: string | undefined,
    to: string | undefined,
  ): Prisma.DateTimeFilter | undefined {
    const filter: Prisma.DateTimeFilter = {};
    if (from) filter.gte = new Date(from);
    if (to) filter.lte = new Date(to);
    return filter.gte || filter.lte ? filter : undefined;
  }

  private async setTenant(
    tx: PrismaTransaction,
    merchantId: string,
  ): Promise<void> {
    this.assertUuid(merchantId);
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_merchant_id = '${merchantId}'`,
    );
  }

  private assertUuid(value: string): void {
    if (!UUID_RE.test(value)) {
      throw new BadRequestException({
        code: "INVALID_ID",
        message: `Malformed id: ${value}`,
      });
    }
  }

  private isSerializationFailure(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2034: write conflict / deadlock; raw 40001: serialization failure.
      if (error.code === "P2034") return true;
      const dbCode = (error.meta as { code?: string } | undefined)?.code;
      if (dbCode === "40001") return true;
    }
    return false;
  }

  private backoffMs(attempt: number): number {
    return 2 ** attempt * 25 + Math.floor(Math.random() * 25);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
