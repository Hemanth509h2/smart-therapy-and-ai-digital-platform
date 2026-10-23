import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/http/apiAuth';
import { prisma } from '@/lib/core/db';
import { therapistForUser } from '@/lib/core/links';

/**
 * Verifies the caller's identity (Firebase ID token, or the AUTH_DISABLED
 * dev bypass) via requireAuth, then confirms the corresponding user is an
 * active THERAPIST with a ProfileTherapist row.
 *
 * Usage inside a route handler:
 *
 *   const auth = await requireTherapist(request);
 *   if (!auth.ok) return auth.response;
 *   const { therapist } = auth;
 */
export async function requireTherapist(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth;

  const [user, therapist] = await Promise.all([
    prisma.user.findUnique({ where: { id: auth.uid }, select: { role: true } }),
    therapistForUser(auth.uid),
  ]);

  if (!user || user.role !== 'THERAPIST' || !therapist) {
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
    uid: auth.uid,
    therapist,
  };
}
