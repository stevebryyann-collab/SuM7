import type { OAuthConfig, OAuthUserConfig } from "next-auth/providers/oauth";

/**
 * A `*.myshopify.com` store domain. Shopify OAuth is per-shop: the authorize and
 * token endpoints live on the store's own domain, so we build them at request
 * time from a domain we have validated.
 */
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Validate + normalize a shop domain to its canonical `*.myshopify.com` form.
 *
 * This is a security boundary, not a convenience: the returned value is
 * interpolated into the OAuth authorize/token URLs, so an unvalidated value
 * would let a caller point the token exchange (which carries the app's client
 * secret) at an arbitrary host — an SSRF/secret-exfiltration vector. Anything
 * that is not exactly a single-label `<store>.myshopify.com` is rejected.
 */
export function normalizeShopDomain(
  input: string | undefined | null,
): string | null {
  if (typeof input !== "string") return null;
  let host = input.trim().toLowerCase();
  if (host.length === 0) return null;
  // Accept a bare handle ("acme") or a full URL ("https://acme.myshopify.com/…").
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  } else {
    // Strip any path/query a caller may have appended to a bare domain.
    host = host.split("/")[0] ?? host;
  }
  if (!host.includes(".")) host = `${host}.myshopify.com`;
  return SHOP_DOMAIN_RE.test(host) ? host : null;
}

/**
 * The profile we synthesize from a Shopify OAuth exchange. Shopify's OAuth does
 * not return a standard OIDC userinfo document, so the `signIn` callback (in
 * auth-options) is what actually provisions the merchant; this provider exists
 * to drive the authorization-code + PKCE handshake and capture the shop domain
 * and access token.
 */
export interface ShopifyProfile {
  /** The `*.myshopify.com` domain, taken from the `shop` request parameter. */
  shopifyDomain: string;
  /** The permanent Admin API access token returned by the token endpoint. */
  accessToken: string;
  /** Primary email for the shop owner (resolved via the upsert response). */
  email: string;
}

/**
 * Shopify OAuth provider for NextAuth v4 with PKCE.
 *
 * Why NextAuth v4 (not v5) and why Shopify OAuth: this is a Shopify embedded
 * app. App Bridge issues short-lived session tokens that Clerk cannot verify,
 * so merchant auth MUST be NextAuth + Shopify OAuth (a Shopify platform
 * requirement, not a preference). v5 breaks the PKCE flow Shopify needs.
 *
 * The concrete `shop` domain is resolved per-request (from the `shop` query
 * param on the NextAuth authorize/callback URL) and passed in here, so the
 * authorize/token URLs point at the merchant's own store rather than an
 * unresolved `__shop__` placeholder. The domain MUST already be validated by
 * {@link normalizeShopDomain} — it is interpolated directly into those URLs.
 */
export function ShopifyProvider(
  options: OAuthUserConfig<ShopifyProfile> & {
    scopes: string;
    shopDomain: string;
  },
): OAuthConfig<ShopifyProfile> {
  const { scopes, shopDomain, ...rest } = options;
  return {
    id: "shopify",
    name: "Shopify",
    type: "oauth",
    version: "2.0",
    checks: ["pkce", "state"],
    // Per-shop endpoints, built from the request-time validated shop domain.
    authorization: {
      url: `https://${shopDomain}/admin/oauth/authorize`,
      params: { scope: scopes },
    },
    token: `https://${shopDomain}/admin/oauth/access_token`,
    // Shopify has no userinfo endpoint; the profile is assembled by signIn.
    userinfo: {
      async request() {
        return {} as Record<string, unknown>;
      },
    },
    profile(profile) {
      return {
        id: profile.shopifyDomain,
        email: profile.email,
        name: profile.shopifyDomain,
      };
    },
    // clientId/clientSecret + any overrides come from `rest`.
    ...rest,
  };
}
