/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ingestion is API-only — no pages needed
  reactStrictMode: true,
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  transpilePackages: ["@repo/db", "@repo/redis", "@repo/types"],
};

module.exports = nextConfig;
