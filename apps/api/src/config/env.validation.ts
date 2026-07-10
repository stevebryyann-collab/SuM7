/**
 * Joi validation for every environment variable the API consumes. ConfigModule
 * runs this at boot; a missing or malformed variable aborts startup rather than
 * failing later at the call site (fail fast, fail loud).
 */
import * as Joi from "joi";

/** Strongly-typed view over the validated configuration. */
export interface AppConfig {
  NODE_ENV: "development" | "test" | "production";
  API_PORT: number;
  PLATFORM_DOMAIN: string;
  INTERNAL_API_SECRET: string;

  DATABASE_URL: string;
  DATABASE_DIRECT_URL: string;

  REDIS_CACHE_URL: string;
  REDIS_QUEUE_URL: string;

  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;

  NEXTAUTH_SECRET: string;

  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_WEBHOOK_SECRET: string;

  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  S3_BUCKET_NAME: string;
  S3_REGION: string;
  S3_KMS_KEY_ARN: string;

  PADDLE_API_KEY: string;
  PADDLE_WEBHOOK_SECRET: string;
  PADDLE_ENV: "sandbox" | "production";
  PADDLE_STARTER_PRICE_ID: string;
  PADDLE_GROWTH_PRICE_ID: string;
  PADDLE_PRO_PRICE_ID: string;
  PADDLE_GMV_PRICE_ID: string;
  PADDLE_CHECKOUT_URL: string;

  RESEND_API_KEY: string;
  RESEND_FROM_ADDRESS: string;

  ENCRYPTION_KEY_V1: string;
  ENCRYPTION_KEY_V2?: string;
  CURRENT_ENCRYPTION_KEY_VERSION: number;

  RESOLVE_API_KEY: string;
  RESOLVE_WEBHOOK_SECRET: string;
  RESOLVE_API_BASE_URL: string;

  OTEL_EXPORTER_OTLP_ENDPOINT: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  SENTRY_DSN: string;

  ALLOWED_ORIGINS: string;
}

/**
 * A 32-byte base64 key (AES-256). Validates decoded length so a too-short key
 * can never silently weaken encryption.
 */
const base64Key32 = Joi.string()
  .base64()
  .custom((value: string, helpers) => {
    if (Buffer.from(value, "base64").length !== 32) {
      return helpers.error("any.invalid");
    }
    return value;
  }, "32-byte base64 key")
  .messages({ "any.invalid": "must decode to exactly 32 bytes" });

export const envValidationSchema = Joi.object({
  // ── Runtime ──
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  API_PORT: Joi.number().port().default(3001),
  PLATFORM_DOMAIN: Joi.string().hostname().required(),
  INTERNAL_API_SECRET: Joi.string().min(32).required(),

  // ── Database ──
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgresql", "postgres"] })
    .required(),
  DATABASE_DIRECT_URL: Joi.string()
    .uri({ scheme: ["postgresql", "postgres"] })
    .required(),

  // ── Redis ──
  REDIS_CACHE_URL: Joi.string()
    .uri({ scheme: ["redis", "rediss"] })
    .required(),
  REDIS_QUEUE_URL: Joi.string()
    .uri({ scheme: ["redis", "rediss"] })
    .required(),

  // ── Shopify ──
  SHOPIFY_CLIENT_ID: Joi.string().required(),
  SHOPIFY_CLIENT_SECRET: Joi.string().required(),

  // ── Merchant authentication (NextAuth + Shopify OAuth) ──
  // The web app signs merchant session tokens (HS256) with this secret; the API
  // MerchantSessionGuard verifies them against the same value.
  NEXTAUTH_SECRET: Joi.string().min(32).required(),

  // ── Buyer authentication (Clerk) ──
  CLERK_SECRET_KEY: Joi.string().pattern(/^sk_/, "clerk secret key").required(),
  CLERK_PUBLISHABLE_KEY: Joi.string()
    .pattern(/^pk_/, "clerk publishable key")
    .required(),
  CLERK_WEBHOOK_SECRET: Joi.string()
    .pattern(/^whsec_/, "clerk webhook secret")
    .required(),

  // ── AWS S3 ──
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  S3_BUCKET_NAME: Joi.string().required(),
  S3_REGION: Joi.string().required(),
  S3_KMS_KEY_ARN: Joi.string()
    .pattern(/^arn:aws:kms:/, "KMS ARN")
    .required(),

  // ── Paddle ──
  // Paddle API keys and webhook secrets have no fixed prefix, so no prefix
  // pattern is enforced here.
  PADDLE_API_KEY: Joi.string().required(),
  PADDLE_WEBHOOK_SECRET: Joi.string().required(),
  PADDLE_ENV: Joi.string().valid("sandbox", "production").default("sandbox"),
  PADDLE_STARTER_PRICE_ID: Joi.string().required(),
  PADDLE_GROWTH_PRICE_ID: Joi.string().required(),
  PADDLE_PRO_PRICE_ID: Joi.string().required(),
  PADDLE_GMV_PRICE_ID: Joi.string().required(),
  PADDLE_CHECKOUT_URL: Joi.string().uri().required(),

  // ── Email ──
  RESEND_API_KEY: Joi.string().required(),
  RESEND_FROM_ADDRESS: Joi.string().email().required(),

  // ── Field encryption ──
  ENCRYPTION_KEY_V1: base64Key32.required(),
  ENCRYPTION_KEY_V2: base64Key32.optional(),
  CURRENT_ENCRYPTION_KEY_VERSION: Joi.number().integer().min(1).default(1),

  // ── BNPL (Resolve) ──
  RESOLVE_API_KEY: Joi.string().required(),
  RESOLVE_WEBHOOK_SECRET: Joi.string().required(),
  RESOLVE_API_BASE_URL: Joi.string()
    .uri()
    .default("https://app.resolvepay.com/api"),

  // ── Observability ──
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().required(),
  OTEL_EXPORTER_OTLP_HEADERS: Joi.string().allow("").optional(),
  SENTRY_DSN: Joi.string().uri().required(),

  // ── CORS ──
  ALLOWED_ORIGINS: Joi.string().required(),
})
  // Cross-field: the active key version must actually be present in the env.
  .custom((value: Record<string, unknown>, helpers) => {
    const version = Number(value.CURRENT_ENCRYPTION_KEY_VERSION);
    const keyName = `ENCRYPTION_KEY_V${version}`;
    if (!value[keyName]) {
      return helpers.error("any.custom", {
        message: `CURRENT_ENCRYPTION_KEY_VERSION=${version} but ${keyName} is not set`,
      });
    }
    return value;
  }, "active encryption key presence");
