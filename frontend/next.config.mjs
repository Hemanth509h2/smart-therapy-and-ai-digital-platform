// When BACKEND_URL is set (and NEXT_PUBLIC_API_URL is left empty), /api/* is
// proxied to the backend so the browser only ever talks to its own origin.
// Needed on Catalyst, whose gateway rejects CORS preflight (OPTIONS) requests
// with a 400 before they reach the backend app. Read at build time.
const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The external .next cache uses server.js's NODE_PATH to find dependencies.
  // Native ESM imports ignore NODE_PATH; use CommonJS for server externals.
  experimental: { esmExternals: false },
  async rewrites() {
    return backendUrl ? [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }] : [];
  },
};

export default nextConfig;
