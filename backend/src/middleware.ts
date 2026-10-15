import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * The frontend is deployed separately, so every API response needs CORS
 * headers. Authenticated requests carry the Firebase ID token in the
 * Authorization header, so no cookies/credentials are involved.
 */
export function middleware(request: NextRequest) {
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
  }
  const response = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    response.headers.set(k, v);
  }
  return response;
}
// Frontends allowed to call the API from the browser: comma-separated
// ALLOWED_ORIGINS, e.g. "https://app.example.com,http://localhost:3000".
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.has(origin);
}

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  return {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,X-Cron-Secret,x-dev-uid,x-dev-email',
    'Access-Control-Max-Age': '86400',
  };
}

export const config = {
  matcher: '/api/:path*',
};
