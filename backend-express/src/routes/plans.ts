import { Router } from 'express';
import { appDb } from '@/lib/core/db';
import { errorResponse } from '@/lib/http/apiError';
import { handle, queryParams, send } from '@/lib/http/reply';
import { requireAdmin } from '@/lib/http/apiAuth';

export const router = Router();

// ---- /api/plans ----------------------------------------------------------------

// GET /api/plans — list active subscription plans (therapist + admin facing),
// full rows including `features` (the admin-written card bullets).
// Pass ?all=1 to include inactive plans (admin catalog management; admins only).

router.get('/plans', handle(async (req, res) => {
  try {
    const searchParams = queryParams(req);
    const includeInactive = searchParams.get('all') === '1';
    if (includeInactive) {
      const admin = await requireAdmin(req, 'billing.read');
      if (!admin.ok) return send(res, admin.response);
    }

    const plans = await appDb.plan.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }],
    });

    return res.json({ plans });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Plans GET error'));
  }
}));
