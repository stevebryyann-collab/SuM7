import type { OAuthConfig, OAuthUserConfig } from 'next-auth/providers/oauth';

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
 * The `shop` (shopify_domain) is carried through the `state` parameter and read
 * back in the `signIn` callback. Per-shop authorize/token URLs are resolved
 * from that domain at request time via the `authorization`/`token` request hooks.
 */
export function ShopifyProvider(
  options: OAuthUserConfig<ShopifyProfile> & { scopes: string },
): OAuthConfig<ShopifyProfile> {
  const { scopes, ...rest } = options;
  return {
    id: 'shopify',
    name: 'Shopify',
    type: 'oauth',
    version: '2.0',
    checks: ['pkce', 'state'],
    // Per-shop endpoints. The concrete shop domain is injected via the
    // `shop` URL param that App Bridge/install redirects include; NextAuth
    // forwards extra params from the sign-in call into `authorization.params`.
    authorization: {
      url: 'https://__shop__/admin/oauth/authorize',
      params: { scope: scopes },
    },
    token: 'https://__shop__/admin/oauth/access_token',
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
