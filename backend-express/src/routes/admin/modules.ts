import { Router } from 'express';
import { appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { daysAgo } from '@/lib/admin/adminList';
import { ALL_MODULE_IDS, MODULE_CATEGORIES } from '@/lib/modules/modules';
import { errorResponse } from '@/lib/http/apiError';
import { provisionPreviewRoom } from '@/lib/sessions/session-provisioning';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/modules --------------------------------------------------------

// GET /api/admin/modules — the built-in module library (lib/modules.ts) by
// category, merged with admin overrides (ModuleSetting) and launch counts.
// Launches come from MODULE_LAUNCH usage events, whose `label` is the module id.
router.get('/admin/modules', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'content');
    if (!auth.ok) return send(res, auth.response);

    const [overrides, recent, allTime] = await Promise.all([
      appDb.moduleSetting.findMany(),
      appDb.usageEvent.groupBy({
        by: ['label'],
        where: { type: 'MODULE_LAUNCH', label: { not: null }, createdAt: { gte: daysAgo(30) } },
        _sum: { count: true },
      }),
      appDb.usageEvent.groupBy({ by: ['label'], where: { type: 'MODULE_LAUNCH', label: { not: null } }, _sum: { count: true } }),
    ]);
    const setting = new Map(overrides.map((o) => [o.moduleId, o]));
    const recentBy = new Map(recent.map((r) => [r.label!, r._sum.count ?? 0]));
    const allBy = new Map(allTime.map((r) => [r.label!, r._sum.count ?? 0]));

    const categories = MODULE_CATEGORIES.map((c) => ({
      id: c.id,
      name: c.name,
      desc: c.desc,
      emoji: c.emoji,
      modules: c.modules.map((m) => {
        const s = setting.get(m.id);
        return {
          id: m.id,
          name: m.name,
          emoji: m.emoji,
          desc: m.desc,
          enabled: s?.enabled ?? true,
          featured: s?.featured ?? false,
          updatedAt: s?.updatedAt ?? null,
          updatedBy: s?.updatedBy ?? null,
          launches30d: recentBy.get(m.id) ?? 0,
          launchesAllTime: allBy.get(m.id) ?? 0,
        };
      }),
    }));

    return res.json({ categories });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin modules GET error', "We couldn't load the tool settings. Please try again."));
  }
}));

// PATCH /api/admin/modules — body { moduleId, enabled?, featured? }.
router.patch('/admin/modules', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'content');
    if (!auth.ok) return send(res, auth.response);

    const body = req.body;
    const moduleId = String(body.moduleId || '');
    if (!ALL_MODULE_IDS.includes(moduleId)) {
      return res.status(400).json({ error: "That tool doesn't exist. Refresh the page and try again." });
    }
    const change: { enabled?: boolean; featured?: boolean } = {};
    if (typeof body.enabled === 'boolean') change.enabled = body.enabled;
    if (typeof body.featured === 'boolean') change.featured = body.featured;
    if (!Object.keys(change).length) {
      return res.status(400).json({ error: "Nothing to change. Turn the tool on or off, or change whether it's featured." });
    }

    const existing = await appDb.moduleSetting.findUnique({ where: { moduleId } });
    const before = { enabled: existing?.enabled ?? true, featured: existing?.featured ?? false };
    const updatedBy = auth.email || auth.uid;
    const saved = await appDb.moduleSetting.upsert({
      where: { moduleId },
      create: { moduleId, ...change, updatedBy },
      update: { ...change, updatedBy },
    });

    await audit(req, auth, 'module.update', { type: 'Module', id: moduleId }, {
      before,
      after: { enabled: saved.enabled, featured: saved.featured },
    });

    return res.json({ module: saved });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin modules PATCH error', "We couldn't save the tool settings. Please try again."));
  }
}));

// ---- /api/admin/modules/preview ------------------------------------------------

// POST /api/admin/modules/preview — open the admin's private "Try module"
// room. Modules keep their state in Firestore liveSessions/{id}, which only
// the uids in its allowedUids may use, so the room is provisioned server-side
// like a real session. No session, client or plan is involved.
router.post('/admin/modules/preview', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'content');
    if (!auth.ok) return send(res, auth.response);

    const sessionId = await provisionPreviewRoom(auth.uid);
    return res.json({ sessionId });
  } catch (error: any) {
    return send(res, errorResponse(error, 'admin/modules/preview POST'));
  }
}));
