import { Router } from 'express';
import { prisma } from '@/lib/core/db';
import { therapistIdForUser } from '@/lib/core/links';
import { requireAuth } from '@/lib/http/apiAuth';
import { requireTherapist } from '@/lib/http/progressAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';
import { handle, queryParams, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/notes ----------------------------------------------------------------

// Session notes belong to the session's therapist; admins may read them too.
async function mayAccessSession(uid: string, sessionId: string) {
  const [session, user, therapistId] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionId }, select: { therapistId: true } }),
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
    therapistIdForUser(uid),
  ]);
  return (!!session && session.therapistId === therapistId) || user?.role === 'ADMIN';
}


router.get('/notes', handle(async (req, res) => {
  try {
    const searchParams = queryParams(req);
    const sessionId = searchParams.get('sessionId');
    const clientId = searchParams.get('clientId');

    // Every session note this therapist wrote for one client (client profile).
    if (clientId) {
      const auth = await requireTherapist(req);
      if (!auth.ok) return send(res, auth.response);
      const notes = await prisma.therapistNote.findMany({
        where: { therapistId: auth.therapist.id, session: { clientId } },
        include: { session: { select: { id: true, scheduledAt: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ notes });
    }

    if (!sessionId) {
      return res.status(400).json({ error: 'Choose a session or client to see its notes.' });
    }
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);
    if (!(await mayAccessSession(auth.uid, sessionId))) {
      return send(res, notYourProfile("this session's notes"));
    }

    const notes = await prisma.therapistNote.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ notes });
  } catch (error: any) {
    return send(res, errorResponse(error, 'notes GET'));
  }
}));

router.post('/notes', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const { sessionId, therapistId, content, isPrivate } = req.body;
    // Only the session's own therapist may write its notes.
    const session = sessionId
      ? await prisma.session.findUnique({ where: { id: sessionId }, select: { therapistId: true } })
      : null;
    if (!session || session.therapistId !== therapistId || session.therapistId !== (await therapistIdForUser(auth.uid))) {
      return send(res, notYourProfile('this session'));
    }
    if (typeof therapistId === 'string') {
      const noPlan = await requireActivePlan({ therapistId }, 'save session notes');
      if (noPlan) return send(res, noPlan);
    }

    const note = await prisma.therapistNote.create({
      data: {
        sessionId,
        therapistId,
        content,
        isPrivate: isPrivate ?? true,
      },
    });

    return res.json({ note });
  } catch (error: any) {
    return send(res, errorResponse(error, 'notes POST'));
  }
}));
