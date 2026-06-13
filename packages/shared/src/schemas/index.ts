/**
 * Shared Zod schemas — the single source of truth for request validation on
 * BOTH the client (React Hook Form resolver) and the server (NestJS pipe).
 */
import { z } from 'zod';

// ── Primitive helpers ──────────────────────────────────────────────────

/** A monetary string with up to 2 decimal places (kept as string to avoid float drift). */
const moneyString = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, 'Must be a positive amount with up to 2 decimals');

const uuid = z.string().uuid();

// ── Buyer authentication ───────────────────────────────────────────────

export const BuyerLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(200),
  /**
   * The merchant context the buyer is logging into (resolved from the app
   * proxy domain). A buyer account is cross-merchant; the relationship is
   * scoped per merchant.
   */
  merchantId: uuid,
});
export type BuyerLoginInput = z.infer<typeof BuyerLoginSchema>;

export const BuyerRegisterApplicationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  companyName: z.string().trim().min(1).max(255),
  businessType: z.string().trim().max(100).optional(),
  website: z.string().trim().url().max(255).optional(),
  taxId: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(50).optional(),
  estimatedMonthlyOrder: z.string().trim().max(100).optional(),
  message: z.string().trim().max(2000).optional(),
});
export type BuyerRegisterApplicationInput = z.infer<typeof BuyerRegisterApplicationSchema>;

// ── Merchant provisioning (internal) ───────────────────────────────────

/**
 * Body of the internal `POST /internal/merchants/upsert` endpoint, called
 * server-to-server by the web app's NextAuth callback after a Shopify OAuth
 * sign-in. Never reaches the browser; authenticated with INTERNAL_API_SECRET.
 * The access token is stored encrypted at rest by the API.
 */
export const UpsertMerchantSchema = z.object({
  shopifyDomain: z.string().trim().toLowerCase().min(1).max(255),
  shopifyAccessToken: z.string().min(1).max(2000),
  email: z.string().trim().toLowerCase().email().max(255),
});
export type UpsertMerchantInput = z.infer<typeof UpsertMerchantSchema>;

// ── Pricing tiers ──────────────────────────────────────────────────────

export const PricingTierTypeSchema = z.enum([
  'percentage_off',
  'fixed_price_list',
  'volume_breaks',
]);

const VolumeBreakConditionSchema = z.object({
  minQty: z.number().int().min(1, 'minQty must be >= 1'),
  discountPct: z.number().min(0).max(100),
});

/**
 * Pricing tier creation. The cross-field rules for `volume_breaks` are enforced
 * with a superRefine so the same guarantees hold client- and server-side:
 *   - at least one bracket
 *   - minQty strictly ascending
 *   - no overlapping brackets (implied by strict ascension + min>=1)
 */
export const CreatePricingTierSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: PricingTierTypeSchema,
    baseDiscountPct: z.number().min(0).max(100).optional(),
    isDefault: z.boolean().default(false),
    minOrderAmount: moneyString.optional(),
    priority: z.number().int().min(0).default(0),
    isActive: z.boolean().default(true),
    /** Only meaningful (and required) when type === 'volume_breaks'. */
    conditionsJson: z
      .object({
        brackets: z.array(VolumeBreakConditionSchema).min(1),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'volume_breaks') {
      if (!value.conditionsJson || value.conditionsJson.brackets.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['conditionsJson'],
          message: 'volume_breaks tiers require at least one bracket',
        });
        return;
      }
      const brackets = value.conditionsJson.brackets;
      for (let i = 1; i < brackets.length; i += 1) {
        const prev = brackets[i - 1];
        const current = brackets[i];
        // Both are guaranteed present by the loop bounds; assert for the
        // noUncheckedIndexedAccess compiler option.
        if (!prev || !current) continue;
        if (current.minQty <= prev.minQty) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['conditionsJson', 'brackets', i, 'minQty'],
            message: 'Brackets must have strictly ascending, non-overlapping minQty',
          });
        }
      }
    }
    if (value.type === 'percentage_off' && value.baseDiscountPct === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseDiscountPct'],
        message: 'percentage_off tiers require a baseDiscountPct',
      });
    }
  });
export type CreatePricingTierInput = z.infer<typeof CreatePricingTierSchema>;

// ── Bulk ordering (spreadsheet-style) ──────────────────────────────────

export const BulkOrderLineItemSchema = z.object({
  shopifyProductId: z.string().min(1).max(100),
  shopifyVariantId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(1_000_000),
});
export type BulkOrderLineItemInput = z.infer<typeof BulkOrderLineItemSchema>;

export const BulkOrderSchema = z.object({
  /** Server-generated idempotency token; also echoed in the Idempotency-Key header. */
  idempotencyKey: uuid,
  merchantId: uuid,
  lineItems: z.array(BulkOrderLineItemSchema).min(1).max(500),
  notes: z.string().trim().max(2000).optional(),
});
export type BulkOrderInput = z.infer<typeof BulkOrderSchema>;

// ── Buyer approval workflow ────────────────────────────────────────────

export const PaymentTermsSchema = z.enum([
  'immediate',
  'net15',
  'net30',
  'net60',
  'net90',
]);

export const ApproveBuyerSchema = z.object({
  applicationId: uuid,
  pricingTierId: uuid.nullable().optional(),
  paymentTerms: PaymentTermsSchema.default('immediate'),
  creditLimit: moneyString.nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type ApproveBuyerInput = z.infer<typeof ApproveBuyerSchema>;

export const RejectBuyerSchema = z.object({
  applicationId: uuid,
  rejectionReason: z.string().trim().min(1).max(2000),
});
export type RejectBuyerInput = z.infer<typeof RejectBuyerSchema>;

// ── Invoicing ──────────────────────────────────────────────────────────

export const MarkPaidSchema = z.object({
  invoiceId: uuid,
  amount: moneyString,
  paidAt: z.string().datetime().optional(),
  reference: z.string().trim().max(255).optional(),
});
export type MarkPaidInput = z.infer<typeof MarkPaidSchema>;

// ── Cursor pagination ──────────────────────────────────────────────────

export const CursorPaginationSchema = z.object({
  /** Opaque base64 cursor returned by the previous page. */
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorPaginationInput = z.infer<typeof CursorPaginationSchema>;
