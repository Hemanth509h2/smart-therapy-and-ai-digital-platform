/** @type {import('next').NextConfig} */
const nextConfig = {
  // The external .next cache uses server.js's NODE_PATH to find dependencies.
  // Native ESM imports ignore NODE_PATH; use CommonJS for server externals.
  experimental: { esmExternals: false },
};

export default nextConfig;
