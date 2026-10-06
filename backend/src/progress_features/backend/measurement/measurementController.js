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

export async function GET(request, { params }) {
  try {
    const { clientId } = params;
    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const metrics = await getClientMetrics(prisma, clientId);
    return NextResponse.json({ metrics });
  } catch (error) {
    console.error('measurementController GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
