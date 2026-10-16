import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireTherapist } from '@/lib/http/progressAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// GET /api/progress/metrics?clientId=xxx&metricType=MOOD_SCORE&from=ISO&to=ISO
// Fetches a client's progress metrics (optionally filtered), newest first.
export async function GET(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const metricType = searchParams.get('metricType');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    const metrics = await prisma.progressMetric.findMany({
      where: {
        clientId,
        // Therapists may only see metrics they themselves recorded unless
        // they're viewing a shared client roster — narrow to this therapist
        // for privacy by default.
        therapistId: auth.therapist.id,
        ...(metricType ? { metricType } : {}),
        ...(from || to
          ? {
              recordedAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { recordedAt: 'asc' },
    });

    return NextResponse.json({ metrics });
  } catch (error: any) {
    return errorResponse(error, 'Progress metrics GET error');
  }
}

// POST /api/progress/metrics
// Body: { clientId, sessionId?, metricType, value, unit?, notes?, recordedAt? }
// Creates a single progress metric entry for a client.
export async function POST(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;
  const noPlan = await requireActivePlan({ therapistId: auth.therapist.id });
  if (noPlan) return noPlan;

  try {
    const body = await request.json();
    const { clientId, sessionId, metricType, value, unit, notes, recordedAt } = body || {};

    if (!clientId || !metricType || value === undefined || value === null) {
      return NextResponse.json(
        { error: 'clientId, metricType and value are required' },
        { status: 400 }
      );
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return NextResponse.json({ error: 'value must be a number' }, { status: 400 });
    }

    const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const metric = await prisma.progressMetric.create({
      data: {
        clientId,
        therapistId: auth.therapist.id,
        sessionId: sessionId || null,
        metricType,
        value,
        unit: unit || null,
        notes: notes || null,
        recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
      },
    });

    return NextResponse.json({ metric }, { status: 201 });
  } catch (error: any) {
    return errorResponse(error, 'Progress metrics POST error');
  }
}
