import { Router } from 'express';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { errorResponse } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/risk-flags/:id -------------------------------------------------

// PATCH /api/admin/risk-flags/:id { note } — acknowledge an AI risk flag.
router.patch('/admin/risk-flags/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.write');
    if (!auth.ok) return send(res, auth.response);

    const body = req.body;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';

    const before = await prisma.riskFlag.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "We couldn't find this risk flag. It may have been removed." });
    if (before.acknowledgedAt) return res.status(409).json({ error: 'This risk flag has already been acknowledged.' });

    const flag = await prisma.riskFlag.update({
      where: { id: req.params.id },
      data: { acknowledgedAt: new Date(), acknowledgedBy: auth.uid, note: note || null },
    });
    await audit(req, auth, 'risk_flag.acknowledge', { type: 'RiskFlag', id: flag.id }, {
      before: { acknowledgedAt: null },
      after: { acknowledgedAt: flag.acknowledgedAt, note: flag.note },
    });
    return res.json({ flag });
  } catch (e: any) {
    return send(res, errorResponse(e, 'PATCH /api/admin/risk-flags failed', "We couldn't update this risk flag. Please try again."));
  }
}));
