import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTherapist } from '@/lib/progressAuth';
import { findAccessibleClient } from '@/lib/clientAccess';
import { errorResponse } from '@/lib/apiError';

export const dynamic = 'force-dynamic';

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

// GET /api/progress/metrics?clientId=xxx&metricType=MOOD_SCORE&from=ISO&to=ISO
// Fetches a client's progress metrics (optionally filtered), newest first.
export async function GET(request: Request) {
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;

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
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;

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
    // IDs must be plain strings before reaching Prisma (an object would be read
    // as a filter). Validated trimmed; passed through unchanged.
    if (!isNonEmptyString(clientId)) {
      return NextResponse.json({ error: 'clientId must be a non-empty string' }, { status: 400 });
    }
    if (sessionId != null && !isNonEmptyString(sessionId)) {
      return NextResponse.json(
        { error: 'sessionId must be a non-empty string when provided' },
        { status: 400 }
      );
    }

    // Same parsing as before (anything `new Date()` accepts); reject only values
    // it can't parse, instead of letting Prisma fail with a 500.
    const recordedAtDate = recordedAt ? new Date(recordedAt) : new Date();
    if (Number.isNaN(recordedAtDate.getTime())) {
      return NextResponse.json({ error: 'recordedAt must be a valid date' }, { status: 400 });
    }

    // Only the therapist's own clients (direct or session-linked). Missing and
    // inaccessible clients get the same 404, before anything is written.
    const client = await findAccessibleClient(prisma, clientId, auth.therapist.id);
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // An optional session must be this therapist's session with this client.
    if (sessionId) {
      const session = await prisma.session.findFirst({
        where: { id: sessionId, therapistId: auth.therapist.id, clientId: client.id },
        select: { id: true },
      });
      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }
    }

    const metric = await prisma.progressMetric.create({
      data: {
        clientId: client.id,
        // Always the verified therapist; any therapistId in the body is ignored.
        therapistId: auth.therapist.id,
        sessionId: sessionId || null,
        metricType,
        value,
        unit: unit || null,
        notes: notes || null,
        recordedAt: recordedAtDate,
      },
    });

    return NextResponse.json({ metric }, { status: 201 });
  } catch (error: any) {
    return errorResponse(error, 'Progress metrics POST error');
  }
}
