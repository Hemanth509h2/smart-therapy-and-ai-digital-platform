import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { resolveCurrent, serializeSubscription } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';

// The caller must own the therapist profile or be an ADMIN.
async function mayAccessTherapist(uid: string, therapistId: string) {
  const [therapist, user] = await Promise.all([
    prisma.profileTherapist.findUnique({ where: { id: therapistId }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  return therapist?.userId === uid || user?.role === 'ADMIN';
}

// GET /api/subscriptions?therapistId= — a therapist's current plan (or null for
// free tier), any pending request, and their term history.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const therapistId = searchParams.get('therapistId');
    if (!therapistId) {
      return NextResponse.json({ error: 'therapistId is required' }, { status: 400 });
    }
    if (!(await mayAccessTherapist(auth.uid, therapistId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [subs, pending] = await Promise.all([
      prisma.subscription.findMany({
        where: { therapistId },
        include: { plan: true },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.subscriptionRequest.findFirst({
        where: { therapistId, status: 'PENDING' },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const current = resolveCurrent(subs);

    return NextResponse.json({
      current: serializeSubscription(current),
      pendingRequest: pending
        ? {
            id: pending.id,
            planId: pending.planId,
            planName: pending.plan.name,
            months: pending.months,
            modules: pending.modules,
            status: pending.status,
            createdAt: pending.createdAt,
          }
        : null,
      history: subs.map((s) => serializeSubscription({ ...s })),
    });
  } catch (error: any) {
    return errorResponse(error, 'Subscriptions GET error');
  }
}
