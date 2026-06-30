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

/** Business-type options (single source of truth for the form Select + API). */
export const BUSINESS_TYPE_OPTIONS = [
  'Retailer',
  'Distributor',
  'Wholesaler',
  'Manufacturer',
  'Other',
] as const;

/** Estimated-monthly-order ranges (single source of truth for the form + API). */
export const ESTIMATED_MONTHLY_ORDER_OPTIONS = [
  'Under $5,000',
  '$5K–$20K',
  '$20K–$50K',
  'Over $50K',
] as const;

/**
 * Buyer registration application — the single source of truth for BOTH the React
 * Hook Form resolver and the NestJS pipe.
 *
 * `email` is OPTIONAL here: the buyer is already Clerk-authenticated when they
 * apply, so the API sources the address from the verified Clerk identity rather
 * than trusting a form field. `businessType` and `estimatedMonthlyOrder` are
 * REQUIRED selects constrained to the option lists above. Free-form text fields
 * keep their own messages so the same copy renders on client and server.
 */
export const BuyerRegisterApplicationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  companyName: z.string({ required_error: 'Company name is required' })
    .trim()
    .min(1, 'Company name is required')
    .max(255),
  businessType: z.enum(BUSINESS_TYPE_OPTIONS, {
    required_error: 'Please select a business type',
    invalid_type_error: 'Please select a business type',
  }),
  website: z.union([
    z.literal(''),
    z.string().trim().url('Please enter a valid URL').max(255),
  ]).optional(),
  taxId: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(50).optional(),
  estimatedMonthlyOrder: z.enum(ESTIMATED_MONTHLY_ORDER_OPTIONS, {
    required_error: 'Please select an estimated order range',
    invalid_type_error: 'Please select an estimated order range',
  }),
  message: z.string().trim().max(500, 'Message must be 500 characters or fewer').optional(),
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

// ── Pricing tier overrides (bulk upsert) ───────────────────────────────

/** A single per-variant price override within a bulk upsert. */
export const PricingOverrideSchema = z.object({
  shopifyProductId: z.string().trim().min(1).max(100),
  shopifyVariantId: z.string().trim().min(1).max(100).nullable().optional(),
  /** Must be strictly greater than 0.01 — enforced server-side with Decimal too. */
  price: moneyString,
  compareAtPrice: moneyString.nullable().optional(),
  currency: z.string().trim().length(3).default('USD'),
});
export type PricingOverrideInput = z.infer<typeof PricingOverrideSchema>;

/** Bulk override payload — at most 500 overrides per request. */
export const BulkPricingOverrideSchema = z.object({
  overrides: z.array(PricingOverrideSchema).min(1).max(500),
});
export type BulkPricingOverrideInput = z.infer<typeof BulkPricingOverrideSchema>;

/** Partial update for a pricing tier (PATCH). All fields optional. */
export const UpdatePricingTierSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    baseDiscountPct: z.number().min(0).max(100).nullable().optional(),
    isDefault: z.boolean().optional(),
    minOrderAmount: moneyString.nullable().optional(),
    priority: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    conditionsJson: z
      .object({
        brackets: z.array(VolumeBreakConditionSchema).min(1),
      })
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdatePricingTierInput = z.infer<typeof UpdatePricingTierSchema>;

// ── Billing ────────────────────────────────────────────────────────────

export const SubscriptionTierSchema = z.enum(['starter', 'growth', 'pro']);

/** Body for POST /billing/subscribe, /billing/change-tier and /billing/change-plan. */
export const BillingTierSchema = z.object({
  tier: SubscriptionTierSchema,
});
export type BillingTierInput = z.infer<typeof BillingTierSchema>;

/** Alias used by the Stage 4 billing page (`POST /billing/change-plan`). */
export const ChangePlanSchema = BillingTierSchema;
export type ChangePlanInput = BillingTierInput;

// ── Merchant settings (Stage 4) ────────────────────────────────────────

/** Owner email-notification preferences. */
export const NotificationPrefsSchema = z.object({
  newApplication: z.boolean(),
  invoiceOverdue: z.boolean(),
  paymentReceived: z.boolean(),
});
export type NotificationPrefsInput = z.infer<typeof NotificationPrefsSchema>;

/**
 * Body for `PUT /api/v1/settings`. The whole settings object is sent on every
 * save (both the Invoice and Notifications save buttons submit the full set),
 * so all fields are required. `invoicePrefix` affects future invoices only and
 * is limited to 8 chars of letters/digits/dashes; `paymentInstructions` (≤500)
 * is rendered on every invoice and may be cleared to null.
 */
export const UpdateMerchantSettingsSchema = z.object({
  invoicePrefix: z
    .string()
    .trim()
    .min(1)
    .max(8)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits and dashes only (max 8)'),
  paymentInstructions: z.string().trim().max(500).nullable().default(null),
  notifications: NotificationPrefsSchema,
});
export type UpdateMerchantSettingsInput = z.infer<typeof UpdateMerchantSettingsSchema>;

// ── Team management (Stage 4 — owner only) ─────────────────────────────

/** Assignable (non-owner) team roles. Ownership cannot be reassigned via the UI. */
export const TeamMemberRoleSchema = z.enum(['admin', 'staff']);
export type TeamMemberRole = z.infer<typeof TeamMemberRoleSchema>;

/** Body for `PATCH /api/v1/team/:id` — change a member's role. */
export const UpdateTeamMemberSchema = z.object({
  role: TeamMemberRoleSchema,
});
export type UpdateTeamMemberInput = z.infer<typeof UpdateTeamMemberSchema>;

/** Body for `POST /api/v1/team/invite` (v1 stub — no email is actually sent). */
export const InviteTeamMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  role: TeamMemberRoleSchema,
});
export type InviteTeamMemberInput = z.infer<typeof InviteTeamMemberSchema>;

// ── Analytics export ───────────────────────────────────────────────────

/** Allowed `?type=` values for `GET /api/v1/analytics/export`. */
export const AnalyticsExportTypeSchema = z.enum(['orders', 'invoices', 'buyers', 'gdpr']);
export type AnalyticsExportType = z.infer<typeof AnalyticsExportTypeSchema>;

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
  /** Optional discount code to apply to the order. */
  discountCode: z.string().trim().max(50).optional(),
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

/**
 * Partial update for an approved buyer's per-merchant relationship (PATCH
 * /buyers/:buyerId). All fields optional; at least one required. `pricingTierId`
 * nullable to clear the tier (fall back to the merchant default); `creditLimit`
 * nullable to remove a limit; `notes` nullable to clear internal notes.
 */
export const UpdateBuyerSchema = z
  .object({
    pricingTierId: uuid.nullable().optional(),
    paymentTerms: PaymentTermsSchema.optional(),
    creditLimit: moneyString.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateBuyerInput = z.infer<typeof UpdateBuyerSchema>;

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
