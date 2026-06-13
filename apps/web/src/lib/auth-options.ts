import jwt from 'jsonwebtoken';
import type { NextAuthOptions, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import type { OAuthConfig } from 'next-auth/providers/oauth';
import type { MerchantRole } from '@b2b/shared';

/**
 * Merchant authentication for the embedded admin dashboard.
 *
 * Tokens are HS256-signed with NEXTAUTH_SECRET (via the custom jwt.encode/decode
 * below) rather than NextAuth's default JWE, so the NestJS API can verify the
 * same token with `jsonwebtoken` in MerchantSessionGuard. The session is a
 * 7-day sliding window: it is re-issued whenever it is within 24h of expiry.
 */

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const ONE_DAY_SECONDS = 24 * 60 * 60;

interface ShopifyProfile {
  sub: string;
  shopifyDomain: string;
  email: string;
}

/** Shape of the Shopify token endpoint response we rely on. */
interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
}

/** Response from the internal merchant upsert endpoint. */
interface MerchantUpsertResult {
  merchantId: string;
  merchantUserId: string;
  shopifyDomain: string;
  role: MerchantRole;
  email: string;
}

/** Extra claims we persist on the JWT and expose on the session. */
interface MerchantClaims {
  merchantId: string;
  merchantUserId: string;
  shopifyDomain: string;
  role: MerchantRole;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const SHOP = process.env.SHOPIFY_SHOP_DOMAIN ?? 'admin.shopify.com';

/**
 * Custom Shopify OAuth provider (PKCE). The exact authorize/token URLs are
 * per-shop; SHOPIFY_SHOP_DOMAIN scopes the merchant install.
 */
const ShopifyProvider: OAuthConfig<ShopifyProfile> = {
  id: 'shopify',
  name: 'Shopify',
  type: 'oauth',
  checks: ['pkce', 'state'],
  clientId: process.env.SHOPIFY_CLIENT_ID,
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
  authorization: {
    url: `https://${SHOP}/admin/oauth/authorize`,
    params: { scope: process.env.SHOPIFY_SCOPES ?? 'read_products,read_orders,write_orders' },
  },
  token: `https://${SHOP}/admin/oauth/access_token`,
  userinfo: {
    // Shopify has no standard userinfo endpoint; derive identity from the shop.
    // The token context is intentionally unused — identity comes from SHOP, not
    // a userinfo call — so the callback takes no args (NextAuth tolerates this).
    async request(): Promise<ShopifyProfile> {
      return {
        sub: SHOP,
        shopifyDomain: SHOP,
        email: `owner@${SHOP}`,
      };
    },
  },
  profile(profile: ShopifyProfile): { id: string; email: string; name: string } {
    return { id: profile.sub, email: profile.email, name: profile.shopifyDomain };
  },
};

export const authOptions: NextAuthOptions = {
  providers: [ShopifyProvider],
  session: { strategy: 'jwt', maxAge: SEVEN_DAYS_SECONDS },
  secret: process.env.NEXTAUTH_SECRET,

  // HS256 tokens that the NestJS API can verify with the shared NEXTAUTH_SECRET.
  jwt: {
    maxAge: SEVEN_DAYS_SECONDS,
    async encode({ token, secret }): Promise<string> {
      const key = Array.isArray(secret) ? secret[0] ?? '' : secret;
      // Strip any prior exp/iat so jsonwebtoken can re-stamp them cleanly.
      const { exp: _exp, iat: _iat, nbf: _nbf, ...claims } = token ?? {};
      void _exp;
      void _iat;
      void _nbf;
      return jwt.sign(claims, key, {
        algorithm: 'HS256',
        expiresIn: SEVEN_DAYS_SECONDS,
        issuer: 'b2b-wholesale-web',
      });
    },
    async decode({ token, secret }): Promise<JWT | null> {
      if (!token) return null;
      const key = Array.isArray(secret) ? secret[0] ?? '' : secret;
      try {
        return jwt.verify(token, key, { algorithms: ['HS256'] }) as JWT;
      } catch {
        return null;
      }
    },
  },

  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-next-auth.session-token'
          : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },

  callbacks: {
    async jwt({ token, account, profile }): Promise<JWT> {
      // Initial sign-in: exchange the Shopify token + upsert the merchant.
      if (account && profile) {
        const shopifyProfile = profile as unknown as ShopifyProfile;
        const result = await upsertMerchant({
          shopifyDomain: shopifyProfile.shopifyDomain,
          shopifyAccessToken: (account.access_token as string | undefined) ?? '',
          email: shopifyProfile.email,
        });
        const claims: MerchantClaims = {
          merchantId: result.merchantId,
          merchantUserId: result.merchantUserId,
          shopifyDomain: result.shopifyDomain,
          role: result.role,
        };
        return {
          ...token,
          sub: result.merchantUserId,
          email: result.email,
          ...claims,
        };
      }

      // Sliding window: re-stamp exp when within 24h of expiry.
      const exp = typeof token.exp === 'number' ? token.exp : 0;
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (exp > 0 && exp - nowSeconds < ONE_DAY_SECONDS) {
        token.exp = nowSeconds + SEVEN_DAYS_SECONDS;
      }
      return token;
    },

    async session({ session, token }): Promise<Session> {
      const claims = token as JWT & Partial<MerchantClaims>;
      return {
        ...session,
        merchantId: claims.merchantId,
        merchantUserId: claims.merchantUserId,
        shopifyDomain: claims.shopifyDomain,
        role: claims.role,
      } as Session;
    },
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },
};

/**
 * Upsert the merchant + owner user in the API. The internal endpoint is
 * authenticated with the shared INTERNAL_API_SECRET (never exposed to the browser).
 */
async function upsertMerchant(input: {
  shopifyDomain: string;
  shopifyAccessToken: string;
  email: string;
}): Promise<MerchantUpsertResult> {
  const apiBase = requiredEnv('INTERNAL_API_URL');
  const response = await fetch(`${apiBase}/internal/merchants/upsert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': requiredEnv('INTERNAL_API_SECRET'),
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Merchant upsert failed: ${response.status}`);
  }
  return (await response.json()) as MerchantUpsertResult;
}
