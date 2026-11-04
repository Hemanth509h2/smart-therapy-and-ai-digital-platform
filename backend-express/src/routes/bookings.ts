import { Router } from 'express';
import { prisma, appDb } from '@/lib/core/db';
import { withTherapists } from '@/lib/core/links';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { requireAuth } from '@/lib/http/apiAuth';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';
import { handle, queryParams, send } from '@/lib/http/reply';
import { clientOfTherapist } from '@/lib/core/ownership';
import { optNumber, reqDate } from '@/lib/http/validate';

export const router = Router();

// ---- /api/bookings -------------------------------------------------------------

// The caller must own the referenced therapist/client profile or be an ADMIN.
async function mayAccess(uid: string, ref: { therapistId?: string | null; clientId?: string | null }) {
  const [therapist, client, user] = await Promise.all([
    ref.therapistId
      ? appDb.profileTherapist.findUnique({ where: { id: ref.therapistId }, select: { userId: true } })
      : null,
    ref.clientId
      ? prisma.profileClient.findUnique({ where: { id: ref.clientId }, select: { userId: true } })
      : null,
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  if (user?.role === 'ADMIN') return true;
  return ref.therapistId ? therapist?.userId === uid : client?.userId === uid;
}


router.get('/bookings', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const searchParams = queryParams(req);
    const therapistId = searchParams.get('therapistId');
    const clientId = searchParams.get('clientId');
    if ((therapistId || clientId) && !(await mayAccess(auth.uid, { therapistId, clientId }))) {
      return send(res, notYourProfile('these bookings'));
    }

    if (therapistId) {
      const bookings = await prisma.booking.findMany({
        where: { therapistId },
        include: {
          client: true,
        },
        orderBy: { dateTime: 'asc' },
      });
      return res.json({ bookings });
    }

    if (clientId) {
      const bookings = await prisma.booking.findMany({
        where: { clientId },
        orderBy: { dateTime: 'asc' },
      });
      return res.json({ bookings: await withTherapists(bookings) });
    }

    return res.status(400).json({ error: 'Choose whose bookings to show.' });
  } catch (error: any) {
    return send(res, errorResponse(error, 'bookings GET'));
  }
}));

router.post('/bookings', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const { therapistId, clientId, dateTime, duration } = req.body;
    if (!therapistId || !(await mayAccess(auth.uid, { therapistId }))) {
      return send(res, notYourProfile('this therapist profile'));
    }
    const when = reqDate(dateTime, 'The booking date');
    const minutes = optNumber(duration, 'The duration (minutes)', 5, 600);
    // Only this therapist's own clients.
    if (!(await clientOfTherapist(therapistId, clientId))) {
      return res.status(404).json({ error: "We couldn't find that client. They may have been removed." });
    }
    const noPlan = await requireActivePlan({ therapistId }, 'book a session');
    if (noPlan) return send(res, noPlan);

    const booking = await prisma.booking.create({
      data: {
        therapistId,
        clientId,
        dateTime: when,
        duration: minutes ? Math.round(minutes) : 50,
      },
    });

    return res.json({ booking });
  } catch (error: any) {
    return send(res, errorResponse(error, 'bookings POST'));
  }
}));
