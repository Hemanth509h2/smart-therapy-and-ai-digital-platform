import { NextResponse } from 'next/server';
import type { AdminRole, UserStatus } from '@prisma/client';
import { adminAuth } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/db';
import { can, type AdminPermission } from '@/lib/adminRoles';

/**
 * Verifies the Firebase ID token sent by the client in the
 * `Authorization: Bearer <idToken>` header.
 *
 * The returned uid/email come from the VERIFIED token. Route handlers must
 * use these values and never trust uid/email sent in the query string or
 * request body — those are forgeable by any anonymous client.
 *
 * Usage inside a route handler:
 *
 *   const auth = await requireAuth(request);
 *   if (!auth.ok) return auth.response;
 *   const { uid } = auth;
 *
 * Suspended accounts (User.status = SUSPENDED) are rejected with 403.
 */
export async function requireAuth(request: Request) {
  const auth = await verifyIdentity(request);
  if (!auth.ok) return auth;
  const blocked = await accountBlock(auth.uid);
  if (blocked) return { ok: false as const, response: blocked };
  return auth;
}

// Account status is checked on every authenticated request, so cache it
// briefly per process. Suspending calls invalidateAccountStatus() so the
// instance that handled it applies it at once; others within STATUS_TTL_MS.
const STATUS_TTL_MS = 30_000;
const LAST_SEEN_EVERY_MS = 5 * 60_000;
const statusCache = new Map<string, { status: UserStatus | null; at: number; seenAt: number }>();

export function invalidateAccountStatus(uid: string) {
  statusCache.delete(uid);
}

async function accountBlock(uid: string) {
  const now = Date.now();
  let entry = statusCache.get(uid);
  if (!entry || now - entry.at > STATUS_TTL_MS) {
    try {
      const user = await prisma.user.findUnique({ where: { id: uid }, select: { status: true } });
      entry = { status: user?.status ?? null, at: now, seenAt: entry?.seenAt ?? 0 };
      statusCache.set(uid, entry);
    } catch (err: any) {
      // Fail open: if the DB is unreachable the route's own queries fail too.
      console.warn(`[auth] account status check failed for ${uid}: ${err?.message}`);
      return null;
    }
  }
  if (entry.status === 'SUSPENDED') {
    return NextResponse.json(
      { error: 'This account has been suspended. Contact support.', code: 'ACCOUNT_SUSPENDED' },
      { status: 403 }
    );
  }
  if (entry.status && now - entry.seenAt > LAST_SEEN_EVERY_MS) {
    entry.seenAt = now;
    prisma.user.update({ where: { id: uid }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return null;
}

async function verifyIdentity(request: Request) {
  // DEV-ONLY bypass: when AUTH_DISABLED=true in .env, token verification is
  // skipped and identity is taken from the x-dev-uid header (sent by the
  // frontend's apiFetch). Needed when the local network blocks Node's access
  // to Google APIs. NEVER enable in production — routes then trust
  // client-supplied identity again.
  if (process.env.AUTH_DISABLED === 'true') {
    const uid = request.headers.get('x-dev-uid') || new URL(request.url).searchParams.get('uid');
    const email = request.headers.get('x-dev-email');
    if (!uid) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: 'AUTH_DISABLED: missing x-dev-uid header' },
          { status: 401 }
        ),
      };
    }
    return { ok: true as const, uid, email, decoded: null };
  }

  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    console.warn(`[auth] 401 ${request.url} — missing Authorization: Bearer <idToken>`);
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Missing Authorization: Bearer <idToken> header' },
        { status: 401 }
      ),
    };
  }

  // verifyIdToken fetches Google's signing certs on first use; on slow/flaky
  // networks that fetch can time out, so retry network-looking failures a
  // couple of times before rejecting. Genuinely invalid tokens fail fast.
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      return {
        ok: true as const,
        uid: decoded.uid,
        email: decoded.email ?? null,
        decoded,
      };
    } catch (err: any) {
      lastErr = err;
      const code = String(err?.errorInfo?.code || err?.code || '');
      const msg = String(err?.message || '');
      const isNetwork =
        code.includes('network') ||
        msg.includes('fetch failed') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ENETUNREACH') ||
        msg.includes('EAI_AGAIN');
      if (!isNetwork) break;
      console.warn(`[auth] token verification attempt ${attempt} failed (${code || msg}); retrying…`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  {
    const err = lastErr;
    console.warn(`[auth] 401 ${request.url} — token verification failed: ${err?.code || err?.message}`);
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Invalid or expired authentication token' },
        { status: 401 }
      ),
    };
  }
}

/**
 * requireAuth + DB role check: only users whose User row has role 'ADMIN'
 * may proceed. Use for every /api/admin/* handler, passing the permission
 * the handler needs (see lib/adminRoles.ts); omit it only for endpoints every
 * admin role may use. Admin APIs are also rate limited per admin.
 */
export async function requireAdmin(request: Request, permission?: AdminPermission) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth;

  if (rateLimited(auth.uid)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 }),
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.uid },
    select: { role: true, admin: { select: { adminRole: true } } },
  });
  if (user?.role !== 'ADMIN') {
    console.warn(`[auth] 403 ${request.url} — uid ${auth.uid} is not an ADMIN`);
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      ),
    };
  }
  // Admins created before roles existed have no ProfileAdmin row: treat as
  // SUPER_ADMIN, matching the column default.
  const adminRole: AdminRole = user.admin?.adminRole ?? 'SUPER_ADMIN';
  if (permission && !can(adminRole, permission)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Your admin role does not allow this.', code: 'ADMIN_FORBIDDEN' },
        { status: 403 }
      ),
    };
  }
  return { ok: true as const, uid: auth.uid, email: auth.email, adminRole, decoded: auth.decoded };
}

export type AdminAuth = Extract<Awaited<ReturnType<typeof requireAdmin>>, { ok: true }>;

// Fixed one-minute window per admin. In-memory, so per server instance — a
// brake on runaway scripts and stolen tokens, not a precise quota.
const RATE_LIMIT_PER_MIN = 300;
const rateWindows = new Map<string, { start: number; count: number }>();

function rateLimited(uid: string) {
  const now = Date.now();
  const w = rateWindows.get(uid);
  if (!w || now - w.start > 60_000) {
    rateWindows.set(uid, { start: now, count: 1 });
    return false;
  }
  w.count++;
  return w.count > RATE_LIMIT_PER_MIN;
}

/**
 * Step-up check for destructive admin actions (removing admins, suspending
 * accounts, refunds): the admin must have signed in within `maxAgeMinutes`.
 * The frontend answers REAUTH_REQUIRED by asking for the password again.
 * Skipped under AUTH_DISABLED (no token to inspect).
 */
export function requireRecentLogin(auth: { decoded: any }, maxAgeMinutes = 15) {
  const authTime = Number(auth.decoded?.auth_time);
  if (!auth.decoded || !authTime) return null;
  if (Date.now() / 1000 - authTime <= maxAgeMinutes * 60) return null;
  return NextResponse.json(
    { error: 'Please confirm your password to continue.', code: 'REAUTH_REQUIRED' },
    { status: 401 }
  );
}
