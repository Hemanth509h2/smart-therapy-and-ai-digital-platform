// reportController.js
//
// GET /api/progress-features/reports/:clientId
// Streams a generated PDF back to the browser as a download.
//
// Mounted by src/routes/progress.ts.

import { prisma } from '@/lib/core/db';
import { generateClientReportPdf } from './reportService.js';
import { errorResponse } from '@/lib/http/apiError';
import { send } from '@/lib/http/reply';

export async function getReport(req, res) {
  try {
    const { clientId } = req.params;
    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }

    const pdfBuffer = await generateClientReportPdf(prisma, clientId);

    return res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="progress-report-${clientId}.pdf"`,
      })
      .send(pdfBuffer);
  } catch (error) {
    return send(res, errorResponse(error, 'reportController GET'));
  }
}
