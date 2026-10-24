import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/risk-flags/:id { note } — acknowledge an AI risk flag.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'people.write');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';

    const before = await prisma.riskFlag.findUnique({ where: { id: params.id } });
    if (!before) return NextResponse.json({ error: "We couldn't find this risk flag. It may have been removed." }, { status: 404 });
    if (before.acknowledgedAt) return NextResponse.json({ error: 'This risk flag has already been acknowledged.' }, { status: 409 });

    const flag = await prisma.riskFlag.update({
      where: { id: params.id },
      data: { acknowledgedAt: new Date(), acknowledgedBy: auth.uid, note: note || null },
    });
    await audit(request, auth, 'risk_flag.acknowledge', { type: 'RiskFlag', id: flag.id }, {
      before: { acknowledgedAt: null },
      after: { acknowledgedAt: flag.acknowledgedAt, note: flag.note },
    });
    return NextResponse.json({ flag });
  } catch (e: any) {
    return errorResponse(e, 'PATCH /api/admin/risk-flags failed', "We couldn't update this risk flag. Please try again.");
  }
}
