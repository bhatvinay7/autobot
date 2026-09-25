/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  transpilePackages: ["@repo/db", "@repo/redis", "@repo/types", "@repo/ui"],
};

module.exports = nextConfig;
