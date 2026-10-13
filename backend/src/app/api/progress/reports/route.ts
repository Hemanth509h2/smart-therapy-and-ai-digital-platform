import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTherapist } from '@/lib/progressAuth';
import { findAccessibleClient } from '@/lib/clientAccess';
import { errorResponse } from '@/lib/apiError';

export const dynamic = 'force-dynamic';

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

// GET /api/progress/reports?clientId=xxx
export async function GET(request: Request) {
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    const reports = await prisma.progressReport.findMany({
      where: { clientId, therapistId: auth.therapist.id },
      // Only this therapist's notes about this client, even if another
      // therapist's note — or a note about a different client — was ever linked
      // to one of these reports. Every report returned has clientId === clientId
      // (outer where), so this matches each report's own client.
      include: { progressNotes: { where: { therapistId: auth.therapist.id, clientId } } },
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
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { clientId, title, periodStart, periodEnd, summary, status } = body || {};

    if (!clientId || !periodStart || !periodEnd || !summary) {
      return NextResponse.json(
        { error: 'clientId, periodStart, periodEnd and summary are required' },
        { status: 400 }
      );
    }
    // clientId must be a plain string before reaching Prisma (an object would be
    // read as a filter). Validated trimmed; passed through unchanged.
    if (!isNonEmptyString(clientId)) {
      return NextResponse.json({ error: 'clientId must be a non-empty string' }, { status: 400 });
    }

    // Same parsing as before (anything `new Date()` accepts), validated before
    // any database lookup.
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json(
        { error: 'periodStart and periodEnd must be valid dates' },
        { status: 400 }
      );
    }
    if (start > end) {
      return NextResponse.json(
        { error: 'periodStart must not be after periodEnd' },
        { status: 400 }
      );
    }

    // Only the therapist's own clients (direct or session-linked). Missing and
    // inaccessible clients get the same 404, before the snapshot read or write.
    const client = await findAccessibleClient(prisma, clientId, auth.therapist.id);
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const metricsInPeriod = await prisma.progressMetric.findMany({
      where: {
        clientId: client.id,
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
        clientId: client.id,
        // Always the verified therapist; any therapistId in the body is ignored.
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
