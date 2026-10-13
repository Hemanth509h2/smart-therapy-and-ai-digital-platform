import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTherapist } from '@/lib/progressAuth';
import { findAccessibleClient } from '@/lib/clientAccess';
import { errorResponse } from '@/lib/apiError';

export const dynamic = 'force-dynamic';

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

// GET /api/progress/notes?clientId=xxx&reportId=yyy
export async function GET(request: Request) {
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const reportId = searchParams.get('reportId');

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    const notes = await prisma.progressNote.findMany({
      where: {
        clientId,
        therapistId: auth.therapist.id,
        ...(reportId ? { reportId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ notes });
  } catch (error: any) {
    return errorResponse(error, 'Progress notes GET error');
  }
}

// POST /api/progress/notes
// Body: { clientId, content, reportId?, isPrivate? }
export async function POST(request: Request) {
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { clientId, content, reportId, isPrivate } = body || {};

    if (!clientId || !content) {
      return NextResponse.json({ error: 'clientId and content are required' }, { status: 400 });
    }
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }
    // IDs must be plain strings before reaching Prisma (an object would be read
    // as a filter). Validated trimmed; passed through unchanged.
    if (!isNonEmptyString(clientId)) {
      return NextResponse.json({ error: 'clientId must be a non-empty string' }, { status: 400 });
    }
    if (reportId != null && !isNonEmptyString(reportId)) {
      return NextResponse.json(
        { error: 'reportId must be a non-empty string when provided' },
        { status: 400 }
      );
    }

    // Only the therapist's own clients (direct or session-linked). Missing and
    // inaccessible clients get the same 404, before anything is written.
    const client = await findAccessibleClient(prisma, clientId, auth.therapist.id);
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // An optional report must be this therapist's report about this client.
    // Checked here so a bad id is a 404, not a foreign-key failure.
    if (reportId) {
      const report = await prisma.progressReport.findFirst({
        where: { id: reportId, therapistId: auth.therapist.id, clientId: client.id },
        select: { id: true },
      });
      if (!report) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
    }

    const note = await prisma.progressNote.create({
      data: {
        clientId: client.id,
        // Always the verified therapist; any therapistId in the body is ignored.
        therapistId: auth.therapist.id,
        reportId: reportId || null,
        content,
        isPrivate: isPrivate === false ? false : true,
      },
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (error: any) {
    return errorResponse(error, 'Progress notes POST error');
  }
}
