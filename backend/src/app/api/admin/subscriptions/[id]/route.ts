import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { addMonths } from '@/lib/subscriptions';

// PATCH /api/admin/subscriptions/[id] — manage an existing term.
// Body: { action: 'renew' | 'cancel' | 'reactivate', months? }
// renew: extends currentPeriodEnd by `months`, bumps renewalCount, marks renewed.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { action, months } = await request.json();

    const sub = await prisma.subscription.findUnique({ where: { id: params.id } });
    if (!sub) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });

    if (action === 'cancel') {
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'CANCELLED' },
      });
      return NextResponse.json({ subscription: updated });
    }

    if (action === 'renew') {
      const addMo = Math.max(1, Math.min(36, Number(months) || sub.months || 1));
      const now = new Date();
      // Extend from the later of now / current end so renewals don't lose time.
      const base = sub.currentPeriodEnd.getTime() > now.getTime() ? sub.currentPeriodEnd : now;
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          months: addMo,
          currentPeriodEnd: addMonths(base, addMo),
          renewedAt: now,
          renewalCount: { increment: 1 },
        },
      });
      return NextResponse.json({ subscription: updated });
    }

    if (action === 'reactivate') {
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE' },
      });
      return NextResponse.json({ subscription: updated });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Subscription PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
