import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed merchant-context token — the production-safe tenant carrier for the
 * buyer portal.
 *
 * The buyer portal talks to the API cross-origin with Bearer auth only
 * (`credentials: 'omit'`), so a cookie set on the storefront/web origin can
 * never reach the API. Instead, after the Edge middleware verifies a Shopify
 * App-Proxy signature, it mints one of these tokens and the browser replays it
 * on every API call as the `X-Merchant-Context` header. The API verifies the
 * HMAC and resolves the shop domain → merchantId server-side.
 *
 * The token is NOT an authorization grant. Possession only attests "this client
 * arrived through a validly-signed App-Proxy entry for shop X". Authorization is
 * still enforced downstream by {@link ClerkBuyerGuard}, which requires the
 * verified Clerk user to hold an APPROVED relationship with the resolved
 * merchant. A forged or replayed shop therefore yields NO_RELATIONSHIP, never
 * access. The signing secret is `SHOPIFY_CLIENT_SECRET` — the same trust root
 * that signs the App-Proxy request, so the token merely re-attests it.
 *
 * Wire format (compact, dependency-free, Edge- and Node-compatible):
 *   base64url(JSON{ shop, iat, exp }) + "." + base64url(HMAC_SHA256(payload, secret))
 *
 * `iat`/`exp` are unix seconds. The signature covers the EXACT payload segment
 * bytes (not the re-serialized object) so verification never depends on key
 * ordering or whitespace.
 */

/** Default token lifetime. Re-minted on every signed proxied navigation. */
export const MERCHANT_CONTEXT_TTL_SECONDS = 24 * 60 * 60;

/** Claims carried by a verified merchant-context token. */
export interface MerchantContextClaims {
  /** The Shopify shop domain (e.g. `acme.myshopify.com`), lower-cased. */
  shop: string;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expiry, unix seconds. */
  exp: number;
}

function base64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/**
 * Mint a signed merchant-context token (Node side). The Edge middleware mints
 * the same format with Web Crypto; this exists for tests and any server-side
 * minting. `nowSeconds` is injectable purely so tests are deterministic.
 */
export function signMerchantContextToken(
  shop: string,
  secret: string,
  ttlSeconds: number = MERCHANT_CONTEXT_TTL_SECONDS,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const claims: MerchantContextClaims = {
    shop: shop.trim().toLowerCase(),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  const payload = base64urlEncode(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Verify a merchant-context token and return its claims, or `null` if the token
 * is missing, malformed, has a bad signature, or has expired. Never throws — the
 * caller maps `null` to the appropriate 401 so a malformed header can never leak
 * a stack trace or distinguish failure modes to an attacker.
 */
export function verifyMerchantContextToken(
  token: string | null | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): MerchantContextClaims | null {
  if (!token || typeof token !== 'string') return null;

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  // Recompute the signature over the payload segment and compare in constant time.
  const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url');
  const expectedBuf = Buffer.from(expectedSig);
  const providedBuf = Buffer.from(providedSig);
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return null;
  }

  let claims: MerchantContextClaims;
  try {
    const parsed: unknown = JSON.parse(base64urlDecode(payload));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as MerchantContextClaims).shop !== 'string' ||
      typeof (parsed as MerchantContextClaims).iat !== 'number' ||
      typeof (parsed as MerchantContextClaims).exp !== 'number'
    ) {
      return null;
    }
    claims = parsed as MerchantContextClaims;
  } catch {
    return null;
  }

  if (!claims.shop || claims.exp <= nowSeconds) return null;
  return claims;
}
