import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// GET /api/plans — list active subscription plans (therapist + admin facing).
// Pass ?all=1 to include inactive plans (admin catalog management).
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('all') === '1';

    const plans = await prisma.plan.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }],
    });

    return NextResponse.json({ plans });
  } catch (error: any) {
    console.error('Plans GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
