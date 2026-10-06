import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';

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
 */
export async function requireAuth(request: Request) {
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
