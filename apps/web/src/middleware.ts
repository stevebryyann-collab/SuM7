import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Edge middleware. Three concerns, kept strictly separated:
 *
 *   1. App-Proxy entry (buyer): when Shopify proxies a storefront request it
 *      appends an HMAC `signature`. We verify it against SHOPIFY_CLIENT_SECRET,
 *      then persist the resolved shop as `__merchant_domain` / `__merchant_id`
 *      cookies so the buyer portal (and the ClerkBuyerGuard on the API) can scope
 *      the tenant. Unsigned proxy requests are rejected.
 *
 *   2. Merchant routes: gated by the NextAuth JWT (decrypted at the edge with
 *      NEXTAUTH_SECRET). No/invalid session ⇒ redirect to /merchant-login.
 *
 *   3. Buyer routes: gated by the presence of a Clerk session cookie. Full token
 *      verification + the approval check happen server-side in the API guard;
 *      here we only bounce obviously-unauthenticated visitors to /buyer-login.
 */

const MERCHANT_PREFIXES = [
  '/dashboard',
  '/buyers',
  '/orders',
  '/invoices',
  '/pricing',
  '/analytics',
  '/settings',
];
// All buyer-portal pages live under /portal/* (served via the App-Proxy rewrite
// /apps/wholesale/* → /portal/*), so they never collide with the merchant routes.
const BUYER_PREFIXES = ['/portal'];

/** Signed merchant-context token lifetime (24h; re-minted on each proxied entry). */
const MERCHANT_CTX_TTL_SECONDS = 24 * 60 * 60;

function isMerchantPath(pathname: string): boolean {
  return MERCHANT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isBuyerPath(pathname: string): boolean {
  return BUYER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Constant-time hex string comparison. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** base64url-encode bytes (no padding) — matches Node's `Buffer.toString('base64url')`. */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Mint a signed merchant-context token (Edge runtime, Web Crypto). Wire format
 * is identical to the API's `verifyMerchantContextToken`:
 *   base64url(JSON{shop,iat,exp}) + "." + base64url(HMAC_SHA256(payload, secret))
 * The browser replays this as `X-Merchant-Context` so the cross-origin API can
 * resolve the tenant without a cross-domain cookie.
 */
async function signMerchantContextToken(
  shop: string,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const claims = { shop: shop.trim().toLowerCase(), iat, exp: iat + ttlSeconds };
  const payload = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${base64url(new Uint8Array(sig))}`;
}

/** Verify a Shopify App-Proxy signature over the request's query params. */
async function verifyAppProxySignature(url: URL, secret: string): Promise<string | null> {
  const params = new URLSearchParams(url.search);
  const signature = params.get('signature');
  const shop = params.get('shop');
  if (!signature || !shop) return null;
  params.delete('signature');

  // Shopify concatenates sorted `key=value` pairs with NO separator.
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const message = sorted.map(([k, v]) => `${k}=${v}`).join('');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const computed = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqualHex(computed, signature) ? shop : null;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, searchParams } = req.nextUrl;

  // ── 1. App-Proxy entry (buyer) ──────────────────────────────────────────
  // Presence of a `signature` query param signals a fresh proxied entry.
  if (searchParams.has('signature')) {
    const secret = process.env.SHOPIFY_CLIENT_SECRET ?? '';
    const shop = secret ? await verifyAppProxySignature(req.nextUrl, secret) : null;
    if (!shop) {
      return new NextResponse('Invalid app proxy signature', { status: 401 });
    }
    const response = NextResponse.next();
    // __merchant_domain (httpOnly) keeps the verified shop for server reads.
    response.cookies.set('__merchant_domain', shop, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    // __merchant_ctx is the SIGNED tenant carrier. The cross-origin API cannot
    // read web-origin cookies, so the browser replays this token as the
    // `X-Merchant-Context` header (buyerFetch) and server components read it for
    // white-label branding. It is httpOnly:false ON PURPOSE — it carries no
    // authority on its own (the API still requires an approved Clerk relationship)
    // and the client must be able to read it to attach the header. `secret` is
    // truthy here (an empty secret would have failed verification above).
    const ctx = await signMerchantContextToken(shop, secret, MERCHANT_CTX_TTL_SECONDS);
    response.cookies.set('__merchant_ctx', ctx, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: MERCHANT_CTX_TTL_SECONDS,
    });
    return response;
  }

  // ── 2. Merchant routes (NextAuth) ───────────────────────────────────────
  if (isMerchantPath(pathname)) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.merchantId) {
      const loginUrl = new URL('/merchant-login', req.url);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // ── 3. Buyer routes (Clerk) ─────────────────────────────────────────────
  if (isBuyerPath(pathname)) {
    const hasClerkSession = req.cookies.has('__session') || req.cookies.has('__clerk_db_jwt');
    if (!hasClerkSession) {
      const loginUrl = new URL('/buyer-login', req.url);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

/**
 * Run on the portal routes only. Static assets, the NextAuth API handler, Clerk
 * internals and the auth pages themselves are excluded so redirects never loop.
 */
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/buyers/:path*',
    '/orders/:path*',
    '/invoices/:path*',
    '/pricing/:path*',
    '/analytics/:path*',
    '/settings/:path*',
    '/portal/:path*',
  ],
};
