import express, { type NextFunction, type Request, type Response } from 'express';
import { cors } from '@/middleware/cors';
import { apiRouter } from '@/routes';
import { errorResponse } from '@/lib/http/apiError';
import { logPath, send } from '@/lib/http/reply';
import { accessLog } from '@/lib/http/accessLog';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind exactly one proxy (Vercel's edge, or Caddy in Docker): trust the
  // X-Forwarded-* values that proxy added, for req.protocol and req.ip. Only
  // one hop, so an X-Forwarded-For sent by the client itself can't choose the
  // IP that rate limits are keyed on.
  app.set('trust proxy', 1);

  // Security headers on every response. The API only returns JSON, so the
  // content policy allows nothing to load and nothing to frame it. No
  // Cross-Origin-Resource-Policy: the website on another origin reads these
  // responses through CORS.
  app.use((_req, res, next) => {
    res.set({
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    });
    next();
  });

  // Request logging: one line per HTTP request, written when the response
  // finishes. Logs the path only (see logPath).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.originalUrl.startsWith('/favicon')) return;
      console.log(`[api] ${req.method} ${logPath(req)} → ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  app.use('/api', cors);

  // The Cashfree webhook verifies its signature over the exact raw body, so it
  // gets the body as text. body-parser skips a body that was already read, so
  // the JSON parser below leaves it alone.
  app.use('/api/payments/cashfree/webhook', express.text({ type: '*/*', limit: '1mb' }));
  // No route needs more than a few hundred KB (the largest are a session
  // report and a support message); a small cap keeps oversized bodies from
  // tying up the server. Larger bodies get a 413.
  app.use(express.json({ limit: '1mb' }));
  // Routes destructure req.body; a request without a JSON body gets {}.
  app.use((req, _res, next) => {
    req.body ??= {};
    next();
  });

  // Backend only serves /api/*; give the root URL a friendly status response.
  app.get('/', (_req, res) => {
    res.json({ name: 'staad-backend', status: 'ok', api: '/api' });
  });

  // Security access log for authenticated calls (see lib/http/accessLog.ts).
  app.use('/api', accessLog);
  app.use('/api', apiRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Errors thrown outside a route's own try/catch, and malformed JSON bodies
  // (body-parser throws a SyntaxError, which errorResponse maps to 400).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    send(res, errorResponse(err, 'express'));
  });

  return app;
}
