import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { appDb } from '@/lib/core/db';
import { safeErrorSummary } from '@/lib/http/apiError';

/**
 * Fixed-window rate limiting, shared across server instances.
 *
 * Route limits (rejectIfLimited / limitByIp) count in the app database's
 * RateLimitBucket table, so on Vercel every function instance sees the same
 * total. Each hit is one atomic INSERT ... ON CONFLICT DO UPDATE. The key is
 * stored only as a SHA-256 hash, so the table holds no uids or IP addresses.
 * Old buckets are deleted by the daily cleanup job.
 *
 * An in-memory count per instance runs alongside: it answers at once when
 * this instance alone is already over the limit, and it is the fallback when
 * the database is slow or unreachable. A database error never blocks a
 * request on its own (the limit then holds per instance only).
 *
 * `hit()` is the in-memory counter on its own, used where a per-instance
 * count is enough (e.g. throttling admin alert emails).
 *
 * Keys are the signed-in uid when the route has one, otherwise the client IP.
 * `req.ip` honours `trust proxy` (set in app.ts): on Vercel and behind Caddy
 * that is the address the proxy saw, not a header the client made up.
 */

interface Window {
  start: number;
  count: number;
}

const buckets = new Map<string, Map<string, Window>>();
let lastSweep = Date.now();

export interface LimitOptions {
  /** Bucket name, e.g. 'support'. Each name counts separately. */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface LimitResult {
  limited: boolean;
  retryAfterSeconds: number;
}

/** Counts one hit for `key` in this instance's memory and says whether it is over the limit. */
export function hit(opts: LimitOptions, key: string, now = Date.now()): LimitResult {
  sweep(now);
  let bucket = buckets.get(opts.name);
  if (!bucket) buckets.set(opts.name, (bucket = new Map()));
  const w = bucket.get(key);
  if (!w || now - w.start >= opts.windowMs) {
    bucket.set(key, { start: now, count: 1 });
    return { limited: opts.limit < 1, retryAfterSeconds: Math.ceil(opts.windowMs / 1000) };
  }
  w.count++;
  return {
    limited: w.count > opts.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((w.start + opts.windowMs - now) / 1000)),
  };
}

// Drop expired windows now and then so the maps don't grow without bound.
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const bucket of buckets.values()) {
    for (const [key, w] of bucket) {
      // The longest window we use is a day.
      if (now - w.start > 24 * 60 * 60 * 1000) bucket.delete(key);
    }
  }
}

export function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// A slow database must not hold the request up for long.
const DB_TIMEOUT_MS = 1500;
let lastDbErrorLog = 0;

function hashKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

/** One atomic increment of the shared bucket; returns the new count. */
async function incrementShared(opts: LimitOptions, key: string, windowStart: Date): Promise<number> {
  const rows = await appDb.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("name", "key", "windowStart", "count")
    VALUES (${opts.name}, ${hashKey(key)}, ${windowStart}, 1)
    ON CONFLICT ("name", "key", "windowStart")
    DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  return Number(rows[0]?.count ?? 1);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('rate limit store timed out')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Counts one hit across all instances. Falls back to this instance's
 * in-memory count when the database can't answer in time.
 */
export async function hitShared(opts: LimitOptions, key: string, now = Date.now()): Promise<LimitResult> {
  const local = hit(opts, key, now);
  // This instance alone is already over: the shared total is at least as high.
  if (local.limited) return local;

  const windowStartMs = Math.floor(now / opts.windowMs) * opts.windowMs;
  try {
    const count = await withTimeout(incrementShared(opts, key, new Date(windowStartMs)), DB_TIMEOUT_MS);
    return {
      limited: count > opts.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStartMs + opts.windowMs - now) / 1000)),
    };
  } catch (e) {
    if (now - lastDbErrorLog > 60_000) {
      lastDbErrorLog = now;
      console.error('[rate-limit] shared store unavailable, using per-instance limits:', safeErrorSummary(e));
    }
    return local;
  }
}

const TOO_MANY = 'Too many requests. Please wait a little and try again.';

/** Sends the 429 response; resolves true if it did. */
export async function rejectIfLimited(res: Response, opts: LimitOptions, key: string, message = TOO_MANY): Promise<boolean> {
  const r = await hitShared(opts, key);
  if (!r.limited) return false;
  res.set('Retry-After', String(r.retryAfterSeconds));
  res.status(429).json({ error: message, code: 'RATE_LIMITED', retryAfter: r.retryAfterSeconds });
  return true;
}

/** Express middleware limiting by client IP, for routes without a signed-in user. */
export function limitByIp(opts: LimitOptions, message?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (await rejectIfLimited(res, opts, clientIp(req), message)) return;
    } catch (e) {
      // Never fail a request because the limiter broke.
      console.error('[rate-limit] limiter error:', safeErrorSummary(e));
    }
    next();
  };
}

/** For tests only. */
export function resetRateLimits() {
  buckets.clear();
}
