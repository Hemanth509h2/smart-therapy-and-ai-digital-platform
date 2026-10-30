import type { NextFunction, Request, Response } from 'express';

/**
 * The frontend is deployed separately, so every API response needs CORS
 * headers. Authenticated requests carry the Firebase ID token in the
 * Authorization header, so no cookies/credentials are involved.
 */
export function cors(req: Request, res: Response, next: NextFunction) {
  res.set(corsHeaders(req));
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

// Frontends allowed to call the API from the browser: comma-separated
// ALLOWED_ORIGINS, e.g. "https://app.example.com,http://localhost:3000".
// Read on first use: server.ts loads .env before any request arrives.
let allowedOrigins: Set<string> | null = null;

function isAllowedOrigin(origin: string): boolean {
  allowedOrigins ??= new Set(
    (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
  return allowedOrigins.has(origin);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.get('origin') ?? '';
  return {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Cron-Secret,x-dev-uid,x-dev-email',
    'Access-Control-Max-Age': '86400',
  };
}
