import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveCurrent, serializeSubscription } from '@/lib/subscriptions';

// GET /api/subscriptions?therapistId= — a therapist's current plan (or null for
// free tier), any pending request, and their term history.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const therapistId = searchParams.get('therapistId');
    if (!therapistId) {
      return NextResponse.json({ error: 'therapistId is required' }, { status: 400 });
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
    console.error('Subscriptions GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
