import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { parsePlanLimits } from '@/lib/subscriptions';

// GET /api/admin/plans — list all plans (active + inactive) for catalog mgmt.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    const plans = await prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }],
    });
    return NextResponse.json({ plans });
  } catch (error: any) {
    console.error('Admin plans GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/admin/plans — create a plan.
// Body: { name, description?, priceMonthly?, durationMonths?, toolQuota?, sortOrder?,
//         maxClients?, maxSessionsPerMonth?, maxAiReportsPerMonth? }
// toolQuota / limits null or empty ⇒ unlimited.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    const body = await request.json();
    const name = String(body.name || '').trim();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

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
        ...limits,
      },
    });

    return NextResponse.json({ plan });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A plan with that name already exists.' }, { status: 409 });
    }
    console.error('Admin plans POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
