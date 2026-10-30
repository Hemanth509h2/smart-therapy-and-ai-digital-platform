// measurementController.js
//
// GET /api/progress-features/measurement/:clientId
//
// Mounted by src/routes/progress.ts.

import { prisma } from '@/lib/core/db';
import { getClientMetrics } from './measurementService.js';
import { errorResponse } from '@/lib/http/apiError';
import { send } from '@/lib/http/reply';

export async function getMeasurement(req, res) {
  try {
    const { clientId } = req.params;
    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }

    const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const metrics = await getClientMetrics(prisma, clientId);
    return res.json({ metrics });
  } catch (error) {
    return send(res, errorResponse(error, 'measurementController GET'));
  }
}
