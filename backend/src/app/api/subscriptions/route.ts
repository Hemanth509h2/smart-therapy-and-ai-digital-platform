import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { resolveCurrent, serializeSubscription } from '@/lib/billing/subscriptions';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';
import { getSetting } from '@/lib/core/settings';

// The caller must own the therapist profile or be an ADMIN.
async function mayAccessTherapist(uid: string, therapistId: string) {
  const [therapist, user] = await Promise.all([
    appDb.profileTherapist.findUnique({ where: { id: therapistId }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  return therapist?.userId === uid || user?.role === 'ADMIN';
}

// GET /api/subscriptions?therapistId= — a therapist's current plan (or null for
// free tier), any open request (waiting for an admin, or approved and waiting
// for payment, with its price), whether plans need approval before payment,
// and their term history.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const therapistId = searchParams.get('therapistId');
    if (!therapistId) {
      return NextResponse.json({ error: "Your therapist profile hasn't loaded yet. Refresh the page and try again." }, { status: 400 });
    }
    if (!(await mayAccessTherapist(auth.uid, therapistId))) {
      return notYourProfile("this therapist's plan");
    }

    const [subs, pending, approvalRequired] = await Promise.all([
      appDb.subscription.findMany({
        where: { therapistId },
        include: { plan: true },
        orderBy: { startedAt: 'desc' },
      }),
      appDb.subscriptionRequest.findFirst({
        where: { therapistId, status: { in: ['PENDING', 'AWAITING_PAYMENT'] } },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      }),
      getSetting('billing.approvalBeforePayment'),
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
            couponCode: pending.couponCode,
            subtotal: pending.subtotal ?? pending.plan.priceMonthly * pending.months,
            discount: pending.discount ?? 0,
            total: pending.total ?? pending.plan.priceMonthly * pending.months,
            createdAt: pending.createdAt,
            reviewedAt: pending.reviewedAt,
          }
        : null,
      approvalRequired,
      history: subs.map((s) => serializeSubscription({ ...s })),
    });
  } catch (error: any) {
    return errorResponse(error, 'Subscriptions GET error');
  }
}
