// measurementController.js
//
// GET /api/progress-features/measurement/:clientId
//
// This is the actual handler logic. It's imported by the thin Next.js route
// file at src/app/api/progress-features/measurement/[clientId]/route.js —
// Next.js requires the file-based route to exist at that exact path to
// register the endpoint, so that file just re-exports this GET function.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getClientMetrics } from './measurementService.js';
import { errorResponse } from '@/lib/apiError';
import { requireTherapist } from '@/lib/progressAuth';
import { findAccessibleClient } from '@/lib/clientAccess';

export async function GET(request, { params }) {
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;
    const therapistId = auth.therapist.id;

    const { clientId } = params;
    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    // Missing and not-accessible clients get the same 404.
    const client = await findAccessibleClient(prisma, clientId, therapistId);
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const metrics = await getClientMetrics(prisma, client.id, therapistId);
    return NextResponse.json({ metrics });
  } catch (error) {
    return errorResponse(error, 'measurementController GET');
  }
}
