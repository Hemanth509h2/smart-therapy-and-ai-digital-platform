import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/db';

/**
 * Verifies the Firebase ID token sent by the client in the
 * `Authorization: Bearer <idToken>` header, then confirms the corresponding
 * user is an active THERAPIST with a ProfileTherapist row.
 *
 * Usage inside a route handler:
 *
 *   const auth = await requireTherapist(request);
 *   if (!auth.ok) return auth.response;
 *   const { therapist } = auth;
 */
export async function requireTherapist(request: Request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Missing Authorization: Bearer <idToken> header' },
        { status: 401 }
      ),
    };
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token);
  } catch (err: any) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Invalid or expired authentication token' },
        { status: 401 }
      ),
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.uid },
    include: { therapist: true },
  });

  if (!user || user.role !== 'THERAPIST' || !user.therapist) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Only authenticated therapists may access progress tracking' },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true as const,
    uid: decoded.uid,
    therapist: user.therapist,
  };
}
