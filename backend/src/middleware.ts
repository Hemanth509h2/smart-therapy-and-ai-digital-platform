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

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Cron-Secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export const config = {
  matcher: '/api/:path*',
};
