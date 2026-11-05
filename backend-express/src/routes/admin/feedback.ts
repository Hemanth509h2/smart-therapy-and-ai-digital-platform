import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { listParams } from '@/lib/admin/adminList';
import { errorResponse } from '@/lib/http/apiError';
import { audit } from '@/lib/admin/audit';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/feedback -------------------------------------------------------

// GET /api/admin/feedback — bug reports (support tickets from the top bar's
// "Report a problem") and therapists' after-call session feedback, in one
// newest-first list. ?type=all|bug|session&q=<text>&page&pageSize
//
// The two come from different tables, so each is read newest-first up to the
// end of the requested page and the merged list is cut to that page.
router.get('/admin/feedback', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'support');
    if (!auth.ok) return send(res, auth.response);

    const { sp, page, pageSize, q } = listParams(req, { sortable: ['createdAt'], defaultSort: 'createdAt' });
    const type = sp.get('type') === 'bug' || sp.get('type') === 'session' ? sp.get('type') : 'all';
    const upTo = page * pageSize;

    const bugWhere: Prisma.SupportTicketWhereInput = {
      category: 'Bug report',
      ...(q
        ? {
            OR: [
              { subject: { contains: q, mode: 'insensitive' } },
              { message: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { ref: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const feedbackWhere: Prisma.SessionFeedbackWhereInput = q ? { comment: { contains: q, mode: 'insensitive' } } : {};
    const since = new Date(Date.now() - 30 * 86_400_000);

    const [bugs, bugTotal, feedback, feedbackTotal, openBugs, recent] = await Promise.all([
      type === 'session' ? [] : prisma.supportTicket.findMany({ where: bugWhere, orderBy: { createdAt: 'desc' }, take: upTo }),
      type === 'session' ? 0 : prisma.supportTicket.count({ where: bugWhere }),
      type === 'bug'
        ? []
        : prisma.sessionFeedback.findMany({
            where: feedbackWhere,
            orderBy: { createdAt: 'desc' },
            take: upTo,
            include: { session: { select: { id: true, therapistId: true, scheduledAt: true, startedAt: true, endedAt: true } } },
          }),
      type === 'bug' ? 0 : prisma.sessionFeedback.count({ where: feedbackWhere }),
      prisma.supportTicket.count({ where: { category: 'Bug report', status: { not: 'RESOLVED' } } }),
      prisma.sessionFeedback.aggregate({ where: { createdAt: { gte: since } }, _avg: { rating: true }, _count: true }),
    ]);

    const therapistIds = [...new Set(feedback.map((f) => f.session.therapistId))];
    const therapists = therapistIds.length
      ? await appDb.profileTherapist.findMany({
          where: { id: { in: therapistIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nameOf = new Map(therapists.map((t) => [t.id, `${t.firstName} ${t.lastName}`.trim()]));

    const items = [
      ...bugs.map((b) => ({
        kind: 'bug' as const,
        id: b.id,
        createdAt: b.createdAt,
        ref: b.ref,
        from: b.name || b.email,
        email: b.email,
        role: b.role,
        subject: b.subject,
        message: b.message,
        status: b.status,
      })),
      ...feedback.map((f) => ({
        kind: 'session' as const,
        id: f.id,
        createdAt: f.createdAt,
        from: nameOf.get(f.session.therapistId) || 'A therapist',
        rating: f.rating,
        callQuality: f.callQuality,
        comment: f.comment,
        sessionId: f.session.id,
        sessionAt: f.session.startedAt ?? f.session.scheduledAt,
        minutes:
          f.session.startedAt && f.session.endedAt
            ? Math.max(0, Math.round((f.session.endedAt.getTime() - f.session.startedAt.getTime()) / 60000))
            : null,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice((page - 1) * pageSize, upTo);

    // Feedback comments are free text from therapists and may mention a client.
    if (items.some((i) => i.kind === 'session')) {
      await audit(req, auth, 'phi.reveal', { type: 'SessionFeedback' }, { after: { scope: 'feedback.list', page } });
    }

    return res.json({
      items,
      total: bugTotal + feedbackTotal,
      counts: { bug: bugTotal, session: feedbackTotal },
      summary: {
        openBugs,
        feedback30d: recent._count,
        avgRating30d: recent._avg.rating == null ? null : Math.round(recent._avg.rating * 10) / 10,
      },
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin feedback list error'));
  }
}));
