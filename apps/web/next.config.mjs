/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output for a minimal, self-contained server bundle (Railway/Vercel).
  output: 'standalone',
  // @b2b/shared is a workspace TS package compiled on demand by Next.
  transpilePackages: ['@b2b/shared'],
  images: {
    // Only Shopify product imagery and Clerk avatars are ever rendered remotely.
    remotePatterns: [
      { protocol: 'https', hostname: '**.shopifycdn.com' },
      { protocol: 'https', hostname: 'cdn.shopify.com' },
      { protocol: 'https', hostname: 'img.clerk.com' },
    ],
  },
  experimental: {
    // Server Actions are only ever invoked from our own origins.
    serverActions: {
      allowedOrigins: [
        process.env.PLATFORM_DOMAIN ?? 'localhost:3000',
        ...(process.env.NEXTAUTH_URL ? [new URL(process.env.NEXTAUTH_URL).host] : []),
      ],
    },
  },
  // Explicit server-side env passthrough (NEXT_PUBLIC_* are inlined automatically).
  env: {
    API_BASE_URL: process.env.API_BASE_URL,
    PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN,
  },
  async rewrites() {
    return [
      // Shopify App Proxy surfaces the buyer portal under the merchant's
      // storefront at /apps/wholesale/*. Next route groups cannot resolve that
      // URL directly, so all buyer pages live under /portal/* and we rewrite.
      { source: '/apps/wholesale/:path*', destination: '/portal/:path*' },
    ];
  },
};

export default nextConfig;
