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

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return {
      ok: true as const,
      uid: decoded.uid,
      email: decoded.email ?? null,
      decoded,
    };
  } catch (err: any) {
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
