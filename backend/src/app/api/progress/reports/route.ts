import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireTherapist } from '@/lib/http/progressAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// GET /api/progress/reports?clientId=xxx
export async function GET(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    if (!clientId) {
      return NextResponse.json({ error: 'Choose a client to see their progress reports.' }, { status: 400 });
    }

    const reports = await prisma.progressReport.findMany({
      where: { clientId, therapistId: auth.therapist.id },
      include: { progressNotes: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ reports });
  } catch (error: any) {
    return errorResponse(error, 'Progress reports GET error');
  }
}

// POST /api/progress/reports
// Body: { clientId, title?, periodStart, periodEnd, summary, status? }
// Creates a progress report. Automatically snapshots the client's metrics
// recorded by this therapist within [periodStart, periodEnd].
export async function POST(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;
  const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'save progress reports');
  if (noPlan) return noPlan;

  try {
    const body = await request.json();
    const { clientId, title, periodStart, periodEnd, summary, status } = body || {};

    if (!clientId || !periodStart || !periodEnd || !summary) {
      return NextResponse.json(
        { error: 'Choose the start and end dates and write a summary for the report.' },
        { status: 400 }
      );
    }

    const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
    if (!client) {
      return NextResponse.json({ error: "We couldn't find that client. They may have been removed." }, { status: 404 });
    }

    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const metricsInPeriod = await prisma.progressMetric.findMany({
      where: {
        clientId,
        therapistId: auth.therapist.id,
        recordedAt: { gte: start, lte: end },
      },
    });

    // Aggregate: average value per metricType, plus count of entries.
    const snapshot: Record<string, { average: number; count: number }> = {};
    for (const m of metricsInPeriod) {
      if (!snapshot[m.metricType]) snapshot[m.metricType] = { average: 0, count: 0 };
      snapshot[m.metricType].average =
        (snapshot[m.metricType].average * snapshot[m.metricType].count + m.value) /
        (snapshot[m.metricType].count + 1);
      snapshot[m.metricType].count += 1;
    }

    const report = await prisma.progressReport.create({
      data: {
        clientId,
        therapistId: auth.therapist.id,
        title: title || 'Progress Report',
        periodStart: start,
        periodEnd: end,
        summary,
        status: status === 'FINAL' ? 'FINAL' : 'DRAFT',
        metricsSnapshot: snapshot,
      },
    });

    return NextResponse.json({ report }, { status: 201 });
  } catch (error: any) {
    return errorResponse(error, 'Progress reports POST error');
  }
}
