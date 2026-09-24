/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ingestion is API-only — no pages needed
  reactStrictMode: true,
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
