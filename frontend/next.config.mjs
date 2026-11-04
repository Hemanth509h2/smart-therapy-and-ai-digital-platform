// When BACKEND_URL is set (and NEXT_PUBLIC_API_URL is left empty), /api/* is
// proxied to the backend so the browser only ever talks to its own origin.
// Needed on Catalyst, whose gateway rejects CORS preflight (OPTIONS) requests
// with a 400 before they reach the backend app. Read at build time.
const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Content-Security-Policy
//
// Every origin the app loads from, so the browser refuses anything else (an
// injected script tag pointing at an attacker's server, a stolen-data beacon,
// framing by another site). Origins that differ per deployment come from the
// same NEXT_PUBLIC_* values the app uses, read at build time.
//
// script-src keeps 'unsafe-inline': the App Router writes its page data as
// inline <script> tags, and the only alternative, a per-request nonce, needs a
// proxy and would make every page server-rendered on demand (almost all pages
// here are prebuilt static pages). Script sources are otherwise limited to our
// own origin plus the few hosts listed. 'wasm-unsafe-eval' lets the
// self-hosted MediaPipe face model run; plain eval stays blocked in production
// (no Lottie animation uses expressions, the only eval in our libraries).
// ---------------------------------------------------------------------------
const isDev = process.env.NODE_ENV !== 'production';

/** The origin of a URL from env, or null when unset/invalid. */
function originOf(url) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}
/** https://x -> wss://x and http://x -> ws://x (and the reverse), for sockets. */
function socketTwin(origin) {
  if (!origin) return null;
  if (origin.startsWith('https://')) return origin.replace('https://', 'wss://');
  if (origin.startsWith('http://')) return origin.replace('http://', 'ws://');
  if (origin.startsWith('wss://')) return origin.replace('wss://', 'https://');
  if (origin.startsWith('ws://')) return origin.replace('ws://', 'http://');
  return null;
}

const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL);
const sttOrigin = originOf(process.env.NEXT_PUBLIC_STT_RELAY_URL);
const livekitOrigin = originOf(process.env.NEXT_PUBLIC_LIVEKIT_URL);
const firebaseAuthDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  ? `https://${process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}`
  : null;

const csp = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    ...(isDev ? ["'unsafe-eval'"] : []), // React Refresh in `next dev` only
    'https://sdk.cashfree.com', // Cashfree checkout SDK (lib/cashfree.ts)
    'https://apis.google.com', // Firebase "Sign in with Google" popup helper
    'https://va.vercel-scripts.com', // Vercel Web Analytics (after consent)
  ],
  'style-src': ["'self'", "'unsafe-inline'", 'https://*.cashfree.com'],
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https://cdn.jsdelivr.net', // Noto emoji in the Drag & Drop Sorting module
    'https://*.cashfree.com',
  ],
  'font-src': ["'self'", 'data:', 'https://esm.sh'], // esm.sh: whiteboard fonts
  'media-src': ["'self'", 'blob:', 'data:'],
  'connect-src': [
    "'self'",
    apiOrigin,
    sttOrigin,
    socketTwin(sttOrigin),
    livekitOrigin,
    socketTwin(livekitOrigin),
    // Firebase Auth and Firestore
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://firestore.googleapis.com',
    'https://*.cashfree.com',
    'https://esm.sh',
    'https://cdn.jsdelivr.net',
    'https://va.vercel-scripts.com',
    ...(isDev ? ['ws://localhost:*', 'ws://127.0.0.1:*'] : []), // dev reload
  ],
  'frame-src': [firebaseAuthDomain, 'https://*.firebaseapp.com', 'https://*.cashfree.com'],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'form-action': ["'self'", 'https://*.cashfree.com'],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
};
const contentSecurityPolicy = [
  ...Object.entries(csp).map(([directive, sources]) =>
    [directive, ...[...new Set(sources.filter(Boolean))]].join(' ')
  ),
  // On an https site, fetch every http:// subresource over https instead.
  // Skipped when the API itself is plain http (a local production run), which
  // the upgrade would break.
  ...(!isDev && !apiOrigin?.startsWith('http://') ? ['upgrade-insecure-requests'] : []),
].join('; ');

// Security headers on every page and asset.
// - Cashfree's checkout opens as a modal but may submit or redirect to its own
//   domain, hence form-action and payment allow *.cashfree.com.
// - camera, microphone and screen sharing are needed by the session room;
//   the app itself only asks after the "Before you join" choice.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), ' +
      'payment=(self "https://*.cashfree.com"), geolocation=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Dockerfile sets NEXT_OUTPUT=standalone; other hosts keep `next start`.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // The external .next cache uses server.js's NODE_PATH to find dependencies.
  // Native ESM imports ignore NODE_PATH; use CommonJS for server externals.
  experimental: { esmExternals: false },
  // Don't advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,
  // Next 16's `next dev` otherwise writes an AGENTS.md into the project.
  agentRules: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return backendUrl ? [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }] : [];
  },
};

export default nextConfig;
