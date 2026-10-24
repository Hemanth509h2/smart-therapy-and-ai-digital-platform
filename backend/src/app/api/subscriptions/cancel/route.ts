import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/http/apiAuth';
import { appDb } from '@/lib/core/db';
import { resolveCurrent, serializeSubscription } from '@/lib/billing/subscriptions';

export const dynamic = 'force-dynamic';

// POST /api/subscriptions/cancel — the signed-in therapist cancels (or undoes
// cancelling) their current plan. Body: { undo?: boolean }
//
// Cancelling does not end access: the term was paid for, so it stays ACTIVE
// until currentPeriodEnd and simply isn't renewed. No refund is issued.
// (An admin "cancel" in /api/admin/subscriptions/[id] still ends it at once.)
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { undo } = await request.json().catch(() => ({}));

    const therapist = await appDb.profileTherapist.findUnique({ where: { userId: auth.uid } });
    if (!therapist) {
      return NextResponse.json({ error: 'Only therapists have plans.' }, { status: 403 });
    }

    const subs = await appDb.subscription.findMany({
      where: { therapistId: therapist.id },
      include: { plan: true },
    });
    const current = resolveCurrent(subs);
    if (!current) {
      return NextResponse.json({ error: 'You have no active plan to cancel.' }, { status: 404 });
    }

    const updated = await appDb.subscription.update({
      where: { id: current.id },
      data: { cancelledAt: undo ? null : current.cancelledAt ?? new Date() },
      include: { plan: true },
    });

    return NextResponse.json({ current: serializeSubscription(updated) });
  } catch (error: any) {
    console.error('Subscription cancel error:', error);
    return NextResponse.json(
      { error: "We couldn't update your plan cancellation. Please try again." },
      { status: 500 }
    );
  }
}
