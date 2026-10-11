import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { audit } from '@/lib/audit';
import { parseFeatures, parsePlanLimits } from '@/lib/subscriptions';

export const dynamic = 'force-dynamic';

// GET /api/admin/plans — list all plans (active + inactive) for catalog mgmt,
// each with subscriberCount (current active terms), requestCount (all plan
// requests ever) and pendingRequestCount.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'billing.read');
    if (!auth.ok) return auth.response;
    const now = new Date();
    const [plans, subs, reqs, pending] = await Promise.all([
      prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }] }),
      prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: 'ACTIVE', currentPeriodEnd: { gt: now } },
        _count: { _all: true },
      }),
      prisma.subscriptionRequest.groupBy({ by: ['planId'], _count: { _all: true } }),
      prisma.subscriptionRequest.groupBy({ by: ['planId'], where: { status: 'PENDING' }, _count: { _all: true } }),
    ]);
    const count = (rows: { planId: string; _count: { _all: number } }[], id: string) =>
      rows.find((r) => r.planId === id)?._count._all ?? 0;

    return NextResponse.json({
      plans: plans.map((p) => ({
        ...p,
        subscriberCount: count(subs, p.id),
        requestCount: count(reqs, p.id),
        pendingRequestCount: count(pending, p.id),
      })),
    });
  } catch (error: any) {
    console.error('Admin plans GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/admin/plans — create a plan.
// Body: { name, description?, priceMonthly?, durationMonths?, toolQuota?, sortOrder?, features?,
//         maxClients?, maxSessionsPerMonth?, maxAiReportsPerMonth? }
// toolQuota / limits null or empty ⇒ unlimited. features: up to 10 card bullets.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return auth.response;
    const body = await request.json();
    const name = String(body.name || '').trim();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    const features = parseFeatures(body.features);
    if (typeof features === 'string') return NextResponse.json({ error: features }, { status: 400 });

    const limits = parsePlanLimits(body);
    if (typeof limits === 'string') return NextResponse.json({ error: limits }, { status: 400 });

    const quotaRaw = body.toolQuota;
    const toolQuota =
      quotaRaw === null || quotaRaw === '' || quotaRaw === undefined
        ? null
        : Math.max(1, Number(quotaRaw));

    const plan = await prisma.plan.create({
      data: {
        name,
        description: body.description?.trim() || null,
        priceMonthly: Math.max(0, Number(body.priceMonthly) || 0),
        durationMonths: Math.max(1, Number(body.durationMonths) || 1),
        toolQuota,
        sortOrder: Number(body.sortOrder) || 0,
        isActive: body.isActive === undefined ? true : Boolean(body.isActive),
        features: features ?? [],
        ...limits,
      },
    });

    await audit(request, auth, 'plan.create', { type: 'Plan', id: plan.id }, { after: plan });
    return NextResponse.json({ plan });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A plan with that name already exists.' }, { status: 409 });
    }
    console.error('Admin plans POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
