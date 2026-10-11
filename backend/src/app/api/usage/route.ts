import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';

// The caller must own the therapist profile or be an ADMIN.
async function mayAccessTherapist(uid: string, therapistId: string) {
  const [therapist, user] = await Promise.all([
    prisma.profileTherapist.findUnique({ where: { id: therapistId }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  return therapist?.userId === uid || user?.role === 'ADMIN';
}

const ALLOWED_TYPES = ['AI_ANALYSIS', 'TRANSCRIPTION', 'MODULE_LAUNCH'];

// POST /api/usage — log a resource-usage event for a therapist.
// Body: { therapistId (ProfileTherapist.id), type, label?, sessionId?, count? }
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { therapistId, type, label, sessionId, count } = await request.json();

    if (!therapistId || !ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: 'therapistId and a valid type are required' }, { status: 400 });
    }
    if (!(await mayAccessTherapist(auth.uid, therapistId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Ignore unknown therapists rather than erroring (logging must never break UX).
    const therapist = await prisma.profileTherapist.findUnique({ where: { id: therapistId }, select: { id: true } });
    if (!therapist) {
      return NextResponse.json({ ok: false });
    }

    const n = Number(count);
    await prisma.usageEvent.create({
      data: {
        therapistId,
        type,
        label: label ?? null,
        sessionId: sessionId ?? null,
        count: Number.isFinite(n) && n > 0 ? Math.round(n) : 1,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Usage log error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
