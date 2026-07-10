/**
 * Security response headers for every route.
 *
 * frame-ancestors (NOT X-Frame-Options) is the critical one: this app is a
 * Shopify EMBEDDED app rendered inside the admin.shopify.com iframe, so we must
 * ALLOW those origins to frame us while still blocking everyone else (clickjacking
 * defense). X-Frame-Options can only express DENY/SAMEORIGIN and would break
 * embedding, so it is intentionally omitted. The CSP is intentionally scoped to
 * framing/object/base directives so it cannot break Next.js, Clerk, or App Bridge
 * script/style/connect loading (a stricter script-src belongs behind a nonce
 * pipeline, which the API already enforces for its own JSON surface).
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output for a minimal, self-contained server bundle (Railway/Vercel).
  output: "standalone",
  // @b2b/shared is a workspace TS package compiled on demand by Next.
  transpilePackages: ["@b2b/shared"],
  images: {
    // Only Shopify product imagery and Clerk avatars are ever rendered remotely.
    remotePatterns: [
      { protocol: "https", hostname: "**.shopifycdn.com" },
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "img.clerk.com" },
    ],
  },
  experimental: {
    // Server Actions are only ever invoked from our own origins.
    serverActions: {
      allowedOrigins: [
        process.env.PLATFORM_DOMAIN ?? "localhost:3000",
        ...(process.env.NEXTAUTH_URL
          ? [new URL(process.env.NEXTAUTH_URL).host]
          : []),
      ],
    },
  },
  // Explicit server-side env passthrough (NEXT_PUBLIC_* are inlined automatically).
  env: {
    API_BASE_URL: process.env.API_BASE_URL,
    PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      // Shopify App Proxy surfaces the buyer portal under the merchant's
      // storefront at /apps/wholesale/*. Next route groups cannot resolve that
      // URL directly, so all buyer pages live under /portal/* and we rewrite.
      { source: "/apps/wholesale/:path*", destination: "/portal/:path*" },
    ];
  },
};

export default nextConfig;
