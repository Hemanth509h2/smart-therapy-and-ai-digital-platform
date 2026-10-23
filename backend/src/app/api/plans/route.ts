import { NextResponse } from 'next/server';
import { appDb } from '@/lib/core/db';
import { errorResponse } from '@/lib/http/apiError';

// GET /api/plans — list active subscription plans (therapist + admin facing),
// full rows including `features` (the admin-written card bullets).
// Pass ?all=1 to include inactive plans (admin catalog management).
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('all') === '1';

    const plans = await appDb.plan.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }],
    });

    return NextResponse.json({ plans });
  } catch (error: any) {
    return errorResponse(error, 'Plans GET error');
  }
}
