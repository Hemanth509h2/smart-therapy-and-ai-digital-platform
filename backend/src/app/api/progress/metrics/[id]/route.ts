import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTherapist } from '@/lib/progressAuth';

export const dynamic = 'force-dynamic';

// PATCH /api/progress/metrics/[id]
// Body: any subset of { value, unit, notes, metricType, recordedAt }
// Updates an existing progress metric. Only the therapist who recorded it
// may edit it.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = params;
    const existing = await prisma.progressMetric.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Progress metric not found' }, { status: 404 });
    }
    if (existing.therapistId !== auth.therapist.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { value, unit, notes, metricType, recordedAt } = body || {};

    if (value !== undefined && (typeof value !== 'number' || Number.isNaN(value))) {
      return NextResponse.json({ error: 'value must be a number' }, { status: 400 });
    }

    const metric = await prisma.progressMetric.update({
      where: { id },
      data: {
        ...(value !== undefined ? { value } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(metricType !== undefined ? { metricType } : {}),
        ...(recordedAt !== undefined ? { recordedAt: new Date(recordedAt) } : {}),
      },
    });

    return NextResponse.json({ metric });
  } catch (error: any) {
    console.error('Progress metrics PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/progress/metrics/[id]
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = params;
    const existing = await prisma.progressMetric.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Progress metric not found' }, { status: 404 });
    }
    if (existing.therapistId !== auth.therapist.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.progressMetric.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Progress metrics DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
