import { Router } from 'express';
import { logError } from '@/lib/http/apiError'
import { appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/modules/settings -----------------------------------------------------

// GET /api/modules/settings — admin module overrides for the therapist app:
// which modules are switched off globally and which are featured.
router.get('/modules/settings', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const rows = await appDb.moduleSetting.findMany({
      where: { OR: [{ enabled: false }, { featured: true }] },
      select: { moduleId: true, enabled: true, featured: true },
    });
    return res.json({
      disabled: rows.filter((r) => !r.enabled).map((r) => r.moduleId),
      featured: rows.filter((r) => r.enabled && r.featured).map((r) => r.moduleId),
    });
  } catch (error: any) {
    logError('Module settings GET error', error);
    return res.status(500).json({ error: "We couldn't load your tool settings. Refresh the page to try again." });
  }
}));
