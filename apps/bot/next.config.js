/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  transpilePackages: ["@repo/db", "@repo/redis", "@repo/types"],
  serverExternalPackages: ["@prisma/client", "@repo/db"],
};

module.exports = nextConfig;
