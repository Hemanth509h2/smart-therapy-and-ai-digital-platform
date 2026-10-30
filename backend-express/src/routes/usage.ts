import { Router } from 'express';
import { prisma, appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/usage ----------------------------------------------------------------

// The caller must own the therapist profile or be an ADMIN.
async function mayAccessTherapist(uid: string, therapistId: string) {
  const [therapist, user] = await Promise.all([
    appDb.profileTherapist.findUnique({ where: { id: therapistId }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  return therapist?.userId === uid || user?.role === 'ADMIN';
}

const ALLOWED_TYPES = ['AI_ANALYSIS', 'TRANSCRIPTION', 'MODULE_LAUNCH'];

// POST /api/usage — log a resource-usage event for a therapist.
// Body: { therapistId (ProfileTherapist.id), type, label?, sessionId?, count? }
router.post('/usage', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const { therapistId, type, label, sessionId, count } = req.body;

    if (!therapistId || !ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: "We couldn't record this usage. Refresh the page and try again." });
    }
    if (!(await mayAccessTherapist(auth.uid, therapistId))) {
      return send(res, notYourProfile('this therapist profile'));
    }

    // Ignore unknown therapists rather than erroring (logging must never break UX),
    // and store nothing for one an admin excluded from usage tracking.
    const therapist = await appDb.profileTherapist.findUnique({ where: { id: therapistId }, select: { trackUsage: true } });
    if (!therapist?.trackUsage) {
      return res.json({ ok: false });
    }

    const n = Number(count);
    await appDb.usageEvent.create({
      data: {
        therapistId,
        type,
        label: label ?? null,
        sessionId: sessionId ?? null,
        count: Number.isFinite(n) && n > 0 ? Math.round(n) : 1,
      },
    });

    return res.json({ ok: true });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Usage log error'));
  }
}));
