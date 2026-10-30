import type { Request, RequestHandler, Response } from 'express';

/**
 * Wraps a route handler. The handler must finish by sending (`return
 * res.json(...)`, `return send(res, reply)`) or return nothing: returning a
 * Reply without sending it is a type error here instead of a request that
 * never answers.
 */
export function handle(
  fn: (req: Request<Record<string, string>>, res: Response) => Promise<Response | void> | Response | void
): RequestHandler {
  return fn as unknown as RequestHandler;
}

/**
 * A JSON response decided by a shared helper (auth checks, plan checks, error
 * mapping) for the route handler to send. Helpers return one instead of
 * writing to `res` themselves so the route keeps control of its own flow:
 *
 *   const auth = await requireAuth(req);
 *   if (!auth.ok) return send(res, auth.response);
 */
export interface Reply {
  status: number;
  body: unknown;
}

export function reply(body: unknown, status = 200): Reply {
  return { status, body };
}

export function send(res: Response, r: Reply) {
  return res.status(r.status).json(r.body);
}

/** The request's query string as URLSearchParams: `get` returns the first
 *  value or null, the same as `new URL(request.url).searchParams`. */
export function queryParams(req: Request): URLSearchParams {
  const i = req.originalUrl.indexOf('?');
  return new URLSearchParams(i === -1 ? '' : req.originalUrl.slice(i + 1));
}

/** Request path without the query string: query strings can carry
 *  credentials and must not land in server logs. */
export function logPath(req: Request): string {
  return req.originalUrl.split('?')[0];
}
