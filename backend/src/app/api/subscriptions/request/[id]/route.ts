import { NextResponse } from 'next/server';
import { appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// DELETE /api/subscriptions/request/:id — the therapist withdraws their own
// request, while it waits for an admin or for payment. A Cashfree order
// already started for it still activates the plan if it gets paid.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const therapist = await appDb.profileTherapist.findUnique({ where: { userId: auth.uid }, select: { id: true } });
    const req = await appDb.subscriptionRequest.findUnique({ where: { id: params.id }, select: { therapistId: true } });
    if (!therapist || !req || req.therapistId !== therapist.id) {
      return NextResponse.json({ error: "We couldn't find that plan request. It may already have been withdrawn." }, { status: 404 });
    }

    const { count } = await appDb.subscriptionRequest.updateMany({
      where: { id: params.id, status: { in: ['PENDING', 'AWAITING_PAYMENT'] } },
      data: { status: 'CANCELLED', reviewedAt: new Date() },
    });
    if (!count) return NextResponse.json({ error: 'This plan request has already been approved, rejected or withdrawn.' }, { status: 409 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error, 'Subscription request withdraw error');
  }
}
