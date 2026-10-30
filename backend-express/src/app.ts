import express, { type NextFunction, type Request, type Response } from 'express';
import { cors } from '@/middleware/cors';
import { apiRouter } from '@/routes';
import { errorResponse } from '@/lib/http/apiError';
import { logPath, send } from '@/lib/http/reply';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a proxy (Docker, load balancer): use X-Forwarded-* for req.protocol.
  app.set('trust proxy', true);

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
  app.use(express.json({ limit: '10mb' }));
  // Routes destructure req.body; a request without a JSON body gets {}.
  app.use((req, _res, next) => {
    req.body ??= {};
    next();
  });

  // Backend only serves /api/*; give the root URL a friendly status response.
  app.get('/', (_req, res) => {
    res.json({ name: 'staad-backend', status: 'ok', api: '/api' });
  });

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
