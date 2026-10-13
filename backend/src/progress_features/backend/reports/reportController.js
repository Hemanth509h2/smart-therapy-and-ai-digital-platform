// reportController.js
//
// GET /api/progress-features/reports/:clientId
// Streams a generated PDF back to the browser as a download.
//
// Like measurementController.js, this is the real logic, imported by the
// thin Next.js route file at
// src/app/api/progress-features/reports/[clientId]/route.js.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateClientReportPdf } from './reportService.js';
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

    // Missing and not-accessible clients get the same 404, before any PDF work.
    const client = await findAccessibleClient(prisma, clientId, therapistId);
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const pdfBuffer = await generateClientReportPdf(prisma, client, therapistId);

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="progress-report-${clientId}.pdf"`,
      },
    });
  } catch (error) {
    return errorResponse(error, 'reportController GET');
  }
}
