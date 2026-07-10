import type { NextAuthOptions, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import jwt from "jsonwebtoken";
import type { MerchantRole } from "@b2b/shared/types";
import type { UpsertMerchantInput } from "@b2b/shared/schemas";
import { ShopifyProvider, normalizeShopDomain } from "./shopify-provider";
import {
  DEMO_EMAIL,
  DEMO_MERCHANT_CLAIMS,
  DEMO_MERCHANT_USER_ID,
  DEMO_PROVIDER_ID,
  isDemoEnabled,
} from "@/lib/dev/demo";

/** Seconds in the merchant session lifetime (7 days). */
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Re-issue the API token when it is within 24h of expiry (sliding window). */
const SLIDING_REFRESH_THRESHOLD_SECONDS = 24 * 60 * 60;

/** Server-only env accessor that fails loudly when a required secret is absent. */
function serverEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required server env var: ${name}`);
  }
  return value;
}

/** Shape of the API's /internal/merchants/upsert response. */
interface MerchantUpsertResult {
  merchantId: string;
  merchantUserId: string;
  shopifyDomain: string;
  role: MerchantRole;
  email: string;
}

/** The merchant claims we persist on the NextAuth JWT between requests. */
interface MerchantClaims {
  merchantId: string;
  merchantUserId: string;
  shopifyDomain: string;
  role: MerchantRole;
  email: string;
}

/**
 * Mint the HS256 API token the NestJS merchant-session guard verifies. The guard
 * checks signature against NEXTAUTH_SECRET (HS256) and reads exactly these
 * claims; we keep its lifetime aligned with the NextAuth session.
 */
function signApiToken(claims: MerchantClaims): string {
  return jwt.sign(claims, serverEnv("NEXTAUTH_SECRET"), {
    algorithm: "HS256",
    expiresIn: SESSION_TTL_SECONDS,
  });
}

/** True when the existing API token is missing or within 24h of expiry. */
function shouldRefreshApiToken(token: JWT): boolean {
  const apiToken = token.apiToken;
  if (typeof apiToken !== "string") return true;
  try {
    const decoded = jwt.decode(apiToken) as { exp?: number } | null;
    if (!decoded?.exp) return true;
    const secondsToExpiry = decoded.exp - Math.floor(Date.now() / 1000);
    return secondsToExpiry <= SLIDING_REFRESH_THRESHOLD_SECONDS;
  } catch {
    return true;
  }
}

/**
 * NextAuth v4 configuration for MERCHANT authentication only. Buyers never touch
 * this — they authenticate through Clerk (see the buyer auth pages). The flow:
 *
 *   1. Shopify OAuth (PKCE) authenticates the shop and yields an access token.
 *   2. `signIn` calls the API's internal upsert endpoint (X-Internal-Secret) to
 *      provision/refresh the merchant + owner user, capturing the resolved ids.
 *   3. `jwt` persists the merchant claims and (re)signs the HS256 API token with
 *      a 7-day sliding window.
 *   4. `session` exposes merchantId/shopifyDomain/role and the API token to the
 *      client so {@link merchantFetch} can attach it as a Bearer credential.
 */
/**
 * Build the NextAuth options at REQUEST time, not module-load time.
 *
 * Every secret here is read via {@link serverEnv}, which throws when absent. If
 * this object were a top-level `const`, `next build` — which imports route
 * modules to collect page data WITHOUT production secrets — would throw during
 * the build (see the same rationale in `@/lib/env`). Exposing a factory keeps
 * all secret reads deferred to the first request, where the env is populated.
 */
export function buildAuthOptions(shopDomainParam?: string): NextAuthOptions {
  const providers: NextAuthOptions["providers"] = [];

  // Shopify OAuth (production merchant auth). In production the credentials are
  // required, so `serverEnv` enforces their presence exactly as before. In
  // development we register it only when both creds are configured, so a
  // developer can use the demo login below WITHOUT a Shopify app set up.
  const shopifyClientId = isDemoEnabled()
    ? process.env.SHOPIFY_CLIENT_ID
    : serverEnv("SHOPIFY_CLIENT_ID");
  const shopifyClientSecret = isDemoEnabled()
    ? process.env.SHOPIFY_CLIENT_SECRET
    : serverEnv("SHOPIFY_CLIENT_SECRET");
  // Shopify OAuth is per-shop: the authorize/token endpoints live on the
  // merchant's own `*.myshopify.com` domain. We resolve + validate it from the
  // request's `shop` param and only register the provider when it is a valid
  // store domain, so a request without a resolvable shop can never emit an
  // authorize URL pointing at an unresolved placeholder host.
  const shopDomain = normalizeShopDomain(shopDomainParam);
  if (shopifyClientId && shopifyClientSecret && shopDomain) {
    providers.push(
      ShopifyProvider({
        clientId: shopifyClientId,
        clientSecret: shopifyClientSecret,
        scopes:
          process.env.SHOPIFY_SCOPES ??
          "read_products,write_orders,read_orders,read_customers",
        shopDomain,
      }),
    );
  }

  // DEV ONLY: a Credentials provider that mints a demo merchant session with no
  // Shopify OAuth and no backend. Registered only outside production, so the
  // production provider list is exactly the Shopify provider above.
  if (isDemoEnabled()) {
    providers.push(
      CredentialsProvider({
        id: DEMO_PROVIDER_ID,
        name: "Demo Merchant",
        credentials: {},
        authorize() {
          // No verification: this provider exists only in development. The
          // returned user carries the demo claims the jwt callback expects.
          return {
            id: DEMO_MERCHANT_USER_ID,
            email: DEMO_EMAIL,
            merchantClaims: { ...DEMO_MERCHANT_CLAIMS },
          };
        },
      }),
    );
  }

  return {
    secret: serverEnv("NEXTAUTH_SECRET"),
    session: { strategy: "jwt", maxAge: SESSION_TTL_SECONDS },
    // Hardened cookies: __Secure- prefix + Secure in production. This is a
    // Shopify EMBEDDED app rendered inside the admin.shopify.com iframe, where
    // the app origin is third-party — a SameSite=Strict/Lax cookie is NOT sent
    // in that cross-site iframe, which silently breaks merchant auth (App Store
    // blocker). Production therefore uses SameSite=None + Secure (the standard
    // embedded-app setting); dev stays Lax because Secure cookies (required by
    // SameSite=None) cannot be set over http://localhost.
    useSecureCookies: process.env.NODE_ENV === "production",
    cookies: {
      sessionToken: {
        name:
          process.env.NODE_ENV === "production"
            ? "__Secure-next-auth.session-token"
            : "next-auth.session-token",
        options: {
          httpOnly: true,
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
          path: "/",
          secure: process.env.NODE_ENV === "production",
        },
      },
    },
    providers,
    pages: {
      signIn: "/merchant-login",
      error: "/merchant-login",
    },
    callbacks: {
      /**
       * Provision the merchant via the API's internal upsert endpoint. The Shopify
       * access token + resolved domain come from the OAuth account; on success the
       * resolved merchant ids are stashed on the OAuth `profile` for the jwt step.
       */
      async signIn({ account, profile, user }) {
        // DEV ONLY: the demo Credentials provider is pre-authorized; its claims are
        // already on `user` (see authorize()), ready for the jwt callback.
        if (account?.provider === DEMO_PROVIDER_ID && isDemoEnabled())
          return true;

        if (account?.provider !== "shopify") return false;
        const shopifyDomain =
          (profile as { shopifyDomain?: string } | undefined)?.shopifyDomain ??
          (account.shop as string | undefined);
        const accessToken = account.access_token;
        if (!shopifyDomain || !accessToken) return false;

        const body: UpsertMerchantInput = {
          shopifyDomain: shopifyDomain.toLowerCase(),
          shopifyAccessToken: accessToken,
          email: (user?.email ?? `owner@${shopifyDomain}`).toLowerCase(),
        };

        const res = await fetch(
          `${serverEnv("API_BASE_URL").replace(/\/$/, "")}/internal/merchants/upsert`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-Secret": serverEnv("INTERNAL_API_SECRET"),
            },
            body: JSON.stringify(body),
            cache: "no-store",
          },
        );
        if (!res.ok) return false;

        const result = (await res.json()) as MerchantUpsertResult;
        // Stash for the jwt callback (NextAuth merges this onto `user`).
        (user as unknown as Record<string, unknown>).merchantClaims = {
          merchantId: result.merchantId,
          merchantUserId: result.merchantUserId,
          shopifyDomain: result.shopifyDomain,
          role: result.role,
          email: result.email,
        } satisfies MerchantClaims;
        return true;
      },

      async jwt({ token, user }) {
        // First call after sign-in: copy the resolved claims onto the token.
        const fresh = (user as unknown as Record<string, unknown> | undefined)
          ?.merchantClaims as MerchantClaims | undefined;
        if (fresh) {
          token.merchantId = fresh.merchantId;
          token.merchantUserId = fresh.merchantUserId;
          token.shopifyDomain = fresh.shopifyDomain;
          token.role = fresh.role;
          token.email = fresh.email;
        }

        // Sliding window: (re)sign the API token when missing or near expiry.
        if (
          typeof token.merchantId === "string" &&
          typeof token.merchantUserId === "string" &&
          typeof token.shopifyDomain === "string" &&
          typeof token.role === "string" &&
          shouldRefreshApiToken(token)
        ) {
          token.apiToken = signApiToken({
            merchantId: token.merchantId,
            merchantUserId: token.merchantUserId,
            shopifyDomain: token.shopifyDomain,
            role: token.role as MerchantRole,
            email: (token.email as string | undefined) ?? "",
          });
        }
        return token;
      },

      session({ session, token }): Session {
        session.merchantId = token.merchantId as string | undefined;
        session.shopifyDomain = token.shopifyDomain as string | undefined;
        session.role = token.role as MerchantRole | undefined;
        session.accessToken = token.apiToken as string | undefined;
        return session;
      },
    },
  };
}
