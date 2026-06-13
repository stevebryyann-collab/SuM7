/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @b2b/shared is a workspace TS package compiled on demand by Next.
  transpilePackages: ['@b2b/shared'],
  experimental: {
    // Server actions / external packages can be added per feature task.
  },
};

export default nextConfig;
