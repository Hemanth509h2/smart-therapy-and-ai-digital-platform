import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveCurrent, serializeSubscription } from '@/lib/subscriptions';

// GET /api/admin/subscriptions — every professional with their current plan
// (months / period end / renewed) plus all pending plan requests to review.
export async function GET() {
  try {
    const [therapists, requests] = await Promise.all([
      prisma.profileTherapist.findMany({
        include: {
          user: { select: { email: true } },
          subscriptions: { include: { plan: true }, orderBy: { startedAt: 'desc' } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.subscriptionRequest.findMany({
        where: { status: 'PENDING' },
        include: { plan: true, therapist: { include: { user: { select: { email: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const professionals = therapists.map((t) => {
      const current = resolveCurrent(t.subscriptions);
      return {
        therapistId: t.id,
        name: `${t.firstName} ${t.lastName}`.trim(),
        email: t.user?.email ?? '',
        allModulesAllowed: t.allModulesAllowed,
        moduleAccessCount: t.moduleAccess.length,
        current: serializeSubscription(current),
        termCount: t.subscriptions.length,
      };
    });

    const pending = requests.map((r) => ({
      id: r.id,
      therapistId: r.therapistId,
      therapistName: `${r.therapist.firstName} ${r.therapist.lastName}`.trim(),
      email: r.therapist.user?.email ?? '',
      planId: r.planId,
      planName: r.plan.name,
      toolQuota: r.plan.toolQuota,
      months: r.months,
      modules: r.modules,
      note: r.note,
      createdAt: r.createdAt,
    }));

    return NextResponse.json({ professionals, requests: pending });
  } catch (error: any) {
    console.error('Admin subscriptions GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
