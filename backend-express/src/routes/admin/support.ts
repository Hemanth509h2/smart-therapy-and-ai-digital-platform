import { Router } from 'express';
import type { Prisma, TicketStatus } from '@prisma/client';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { dateRange, listParams } from '@/lib/admin/adminList';
import { errorResponse } from '@/lib/http/apiError';
import { audit } from '@/lib/admin/audit';
import { mailConfigured, sendMail } from '@/lib/core/mail';
import { getSetting } from '@/lib/core/settings';
import { handle, reply, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/support --------------------------------------------------------

const STATUSES: TicketStatus[] = ['OPEN', 'PENDING', 'RESOLVED'];

// GET /api/admin/support — helpdesk tickets.
// ?status=OPEN&category=Billing&assignee=<uid>|me|none&q=<ref/email/subject>&from&to&page
// counts = tickets per status for the other filters (for the status tabs).
router.get('/admin/support', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'support');
    if (!auth.ok) return send(res, auth.response);

    const { sp, page, pageSize, skip, take, sort, dir, q, from, to } = listParams(req, {
      sortable: ['createdAt', 'updatedAt'],
      defaultSort: 'createdAt',
    });
    const status = sp.get('status') as TicketStatus | null;
    const category = sp.get('category');
    const assignee = sp.get('assignee');

    const base: Prisma.SupportTicketWhereInput = {
      createdAt: dateRange(from, to),
      ...(category ? { category } : {}),
      ...(assignee === 'none' ? { assigneeUid: null } : assignee ? { assigneeUid: assignee === 'me' ? auth.uid : assignee } : {}),
      ...(q
        ? {
            OR: [
              { ref: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { subject: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const where: Prisma.SupportTicketWhereInput = { ...base, ...(status && STATUSES.includes(status) ? { status } : {}) };

    const [tickets, total, byStatus, admins] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: { [sort]: dir },
        skip,
        take,
        select: {
          id: true, ref: true, userId: true, name: true, email: true, role: true, category: true, subject: true,
          status: true, assigneeUid: true, createdAt: true, updatedAt: true,
          _count: { select: { replies: true } },
        },
      }),
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      // For the assignee filter / labels.
      prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true, email: true } }),
    ]);

    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TicketStatus, number>;
    for (const b of byStatus) counts[b.status] = b._count._all;
    const adminEmail = new Map(admins.map((a) => [a.id, a.email]));

    return res.json({
      tickets: tickets.map(({ _count, ...t }) => ({
        ...t,
        replies: _count.replies,
        assigneeEmail: t.assigneeUid ? adminEmail.get(t.assigneeUid) ?? null : null,
      })),
      total,
      page,
      pageSize,
      counts,
      admins,
    });
  } catch (e: any) {
    return send(res, errorResponse(e, 'GET /api/admin/support failed', "We couldn't load support tickets. Please try again."));
  }
}));

// ---- /api/admin/support/:id ----------------------------------------------------

// GET /api/admin/support/:id — ticket with its reply thread (oldest first).
router.get('/admin/support/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'support');
    if (!auth.ok) return send(res, auth.response);

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) return res.status(404).json({ error: "We couldn't find this support ticket. It may have been deleted." });

    const assignee = ticket.assigneeUid
      ? await prisma.user.findUnique({ where: { id: ticket.assigneeUid }, select: { email: true } })
      : null;
    return res.json({ ticket: { ...ticket, assigneeEmail: assignee?.email ?? null } });
  } catch (e: any) {
    return send(res, errorResponse(e, 'GET /api/admin/support/[id] failed', "We couldn't load this support ticket. Please try again."));
  }
}));

// PATCH /api/admin/support/:id { status?, assigneeUid? (null = unassign) }
router.patch('/admin/support/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'support');
    if (!auth.ok) return send(res, auth.response);

    const body = req.body;
    const data: { status?: TicketStatus; assigneeUid?: string | null } = {};
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Choose a valid status: Open, Pending or Resolved.' });
      data.status = body.status;
    }
    if (body.assigneeUid !== undefined) {
      if (body.assigneeUid === null || body.assigneeUid === '') data.assigneeUid = null;
      else {
        const admin = await prisma.user.findFirst({ where: { id: String(body.assigneeUid), role: 'ADMIN' }, select: { id: true } });
        if (!admin) return res.status(400).json({ error: 'Tickets can only be assigned to an admin.' });
        data.assigneeUid = admin.id;
      }
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to change.' });

    const before = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, select: { status: true, assigneeUid: true } });
    if (!before) return res.status(404).json({ error: "We couldn't find this support ticket. It may have been deleted." });

    const ticket = await prisma.supportTicket.update({ where: { id: req.params.id }, data });
    await audit(req, auth, 'ticket.update', { type: 'SupportTicket', id: ticket.id }, {
      before,
      after: { status: ticket.status, assigneeUid: ticket.assigneeUid },
    });
    return res.json({ ticket });
  } catch (e: any) {
    return send(res, errorResponse(e, 'PATCH /api/admin/support/[id] failed', "We couldn't update this support ticket. Please try again."));
  }
}));

// ---- /api/admin/support/:id/replies --------------------------------------------

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// POST /api/admin/support/:id/replies { body, internal }
// Internal notes are only stored. Public replies are emailed to the user and
// move the ticket to PENDING (waiting on the user).
router.post('/admin/support/:id/replies', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'support');
    if (!auth.ok) return send(res, auth.response);

    const payload = req.body;
    const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 20_000) : '';
    const internal = payload.internal === true;
    if (!body) return res.status(400).json({ error: 'Write a reply before sending.' });

    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket) return res.status(404).json({ error: "We couldn't find this support ticket. It may have been deleted." });

    let reply = await prisma.supportReply.create({
      data: { ticketId: ticket.id, authorUid: auth.uid, authorEmail: auth.email ?? null, body, internal },
    });

    let emailError: string | null = null;
    if (!internal) {
      try {
        if (!mailConfigured()) throw new Error("Email isn't set up on the server yet, so nothing was sent. Ask whoever manages hosting to set it up.");
        await sendMail('support', {
          to: ticket.email,
          replyTo: await getSetting('support.email'),
          subject: `Re: ${ticket.subject} [${ticket.ref}]`,
          text: `${body}\n\n— STAAD Support\nTicket ${ticket.ref}`,
          html: `<div style="font-family:system-ui,Arial,sans-serif;color:#1f2937;line-height:1.5">
            <p style="white-space:pre-wrap">${escapeHtml(body)}</p>
            <p style="color:#6b7280">— STAAD Support<br/>Ticket ${escapeHtml(ticket.ref)}</p></div>`,
        });
        reply = await prisma.supportReply.update({ where: { id: reply.id }, data: { emailed: true } });
      } catch (e: any) {
        emailError = e?.message || 'Email failed';
        console.error(`Reply on ticket ${ticket.ref} saved but the email failed:`, emailError);
      }
      await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: 'PENDING' } });
    }

    await audit(req, auth, 'ticket.reply', { type: 'SupportTicket', id: ticket.id }, {
      after: { replyId: reply.id, internal, emailed: reply.emailed },
    });
    return res.json({ reply, emailError });
  } catch (e: any) {
    return send(res, errorResponse(e, 'POST /api/admin/support/[id]/replies failed', "We couldn't save your reply. Please try again."));
  }
}));
