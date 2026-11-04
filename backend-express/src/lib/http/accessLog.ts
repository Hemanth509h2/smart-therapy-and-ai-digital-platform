import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@/lib/core/db';
import { safeErrorSummary } from '@/lib/http/apiError';

// Security access log (DPDP Rules 2025, rule 6): who called which API route,
// on which resource, when, from where, and with what result, kept for a year
// so unauthorised access can be detected and investigated. Never stores
// request or response bodies. Rows land in the AccessLog table (HIPAA
// database) and are deleted after ACCESS_LOG_DAYS by the daily retention job.

/** Kept a year and a month, then deleted (see cleanup-transcripts.ts). */
export const ACCESS_LOG_DAYS = 395;

const AUTH_UID = Symbol('staad.accessLog.uid');
// The same call repeated within this window (e.g. the lobby polling every few
// seconds) is stored once. Per server instance.
const COLLAPSE_MS = 10 * 60_000;
const MAX_REMEMBERED = 5_000;
const recent = new Map<string, number>();

/** Called by requireAuth once the caller's identity is verified. */
export function markAuthenticated(req: Request, uid: string) {
  (req as unknown as Record<symbol, string>)[AUTH_UID] = uid;
}

function authenticatedUid(req: Request): string | undefined {
  return (req as unknown as Record<symbol, string | undefined>)[AUTH_UID];
}

function clip(value: string | undefined, max: number) {
  return value ? value.slice(0, max) : null;
}

/** Express middleware: records authenticated API calls after they finish. */
export function accessLog(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    const uid = authenticatedUid(req);
    if (!uid) return;

    // The route template, not the raw URL, so ids and query strings (which can
    // carry tokens) stay out of the route column.
    const route = `${req.baseUrl}${typeof req.route?.path === 'string' ? req.route.path : ''}` || 'unmatched';
    const firstParam = Object.values(req.params ?? {})[0];
    const resourceId = typeof firstParam === 'string' ? firstParam.slice(0, 200) : null;
    const status = res.statusCode;

    const now = Date.now();
    const key = `${uid}|${req.method}|${route}|${resourceId ?? ''}|${status}`;
    const last = recent.get(key);
    if (last !== undefined && now - last < COLLAPSE_MS) return;
    recent.set(key, now);
    if (recent.size > MAX_REMEMBERED) {
      for (const [k, at] of recent) if (now - at >= COLLAPSE_MS) recent.delete(k);
      if (recent.size > MAX_REMEMBERED) recent.clear();
    }

    prisma.accessLog
      .create({
        data: {
          uid: uid.slice(0, 128),
          method: req.method,
          route: route.slice(0, 200),
          resourceId,
          status,
          ip: clip(req.ip, 64),
          userAgent: clip(req.get('user-agent'), 300),
        },
      })
      .catch((e) => console.error('[access-log] could not record:', safeErrorSummary(e)));
  });
  next();
}
