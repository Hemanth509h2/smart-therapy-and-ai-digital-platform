import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { can } from '@/lib/admin/adminRoles';
import { listParams } from '@/lib/admin/adminList';
import { therapistsById, usersById } from '@/lib/core/links';
import { errorResponse } from '@/lib/http/apiError';
import { handle, queryParams, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/clients --------------------------------------------------------

const initial = (s: string | null | undefined) => (s?.trim() ? `${s.trim()[0].toUpperCase()}.` : '');
const maskName = (first: string, last: string) => [initial(first), initial(last)].filter(Boolean).join(' ') || '—';

// GET /api/admin/clients — every client across therapists.
// ?q= (name / email), ?therapistId=, ?invite=claimed|direct, ?status=ACTIVE|SUSPENDED,
// ?sort=createdAt|name|sessions, ?reveal=1 (needs phi.read; audited as phi.reveal).
// Names are masked to initials unless revealed. Search still matches full names.
router.get('/admin/clients', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.read');
    if (!auth.ok) return send(res, auth.response);
    const { sp, skip, take, sort, dir, q } = listParams(req, {
      sortable: ['createdAt', 'name', 'sessions'],
      defaultSort: 'createdAt',
    });

    const reveal = sp.get('reveal') === '1';
    if (reveal && !can(auth.adminRole, 'phi.read')) {
      return res.status(403).json({ error: "Your admin role doesn't allow viewing full client details. Ask a super admin if you need access.", code: 'ADMIN_FORBIDDEN' });
    }

    const and: Prisma.ProfileClientWhereInput[] = [];
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      and.push({
        OR: [
          { user: { email: { contains: q, mode: 'insensitive' } } },
          { parentEmail: { contains: q, mode: 'insensitive' } },
          // Every word must hit the first or last name ("asha kumar").
          { AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }] })) },
        ],
      });
    }
    const therapistId = sp.get('therapistId');
    if (therapistId) and.push({ therapistId });
    const invite = sp.get('invite');
    if (invite === 'claimed') and.push({ claimedInvites: { some: {} } });
    else if (invite === 'direct') and.push({ claimedInvites: { none: {} } });
    const status = sp.get('status');
    if (status === 'ACTIVE' || status === 'SUSPENDED') and.push({ user: { status } });
    const where: Prisma.ProfileClientWhereInput = and.length ? { AND: and } : {};

    const orderBy: Prisma.ProfileClientOrderByWithRelationInput[] =
      sort === 'name'
        ? [{ firstName: dir }, { lastName: dir }]
        : sort === 'sessions'
          ? [{ sessions: { _count: dir } }]
          : [{ createdAt: dir }];

    const [rows, total] = await Promise.all([
      prisma.profileClient.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          createdAt: true,
          therapistId: true,
          user: { select: { status: true } },
          _count: { select: { sessions: true, claimedInvites: true } },
        },
      }),
      prisma.profileClient.count({ where }),
    ]);

    const ids = rows.map((r) => r.id);
    const [last, therapists] = await Promise.all([
      ids.length
        ? prisma.session.groupBy({ by: ['clientId'], where: { clientId: { in: ids } }, _max: { scheduledAt: true } })
        : [],
      therapistsById(rows.map((r) => r.therapistId), { id: true, firstName: true, lastName: true }),
    ]);
    const lastBy = new Map(last.map((l) => [l.clientId, l._max.scheduledAt]));
    const therapistOf = (id: string | null) => {
      const t = id ? therapists.get(id) : undefined;
      return t ? { id: t.id, name: `${t.firstName} ${t.lastName}`.trim() } : null;
    };

    if (reveal && ids.length) {
      await audit(req, auth, 'phi.reveal', { type: 'ProfileClient' }, { after: { scope: 'clients.list', clientIds: ids } });
    }

    return res.json({
      clients: rows.map((r) => ({
        id: r.id,
        name: reveal ? `${r.firstName} ${r.lastName}`.trim() : maskName(r.firstName, r.lastName),
        masked: !reveal,
        therapist: therapistOf(r.therapistId),
        sessions: r._count.sessions,
        lastSession: lastBy.get(r.id) ?? null,
        inviteStatus: r._count.claimedInvites > 0 ? 'CLAIMED' : 'DIRECT',
        status: r.user?.status ?? 'ACTIVE',
        createdAt: r.createdAt,
      })),
      total,
      revealed: reveal,
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin clients list error', "We couldn't load the client list. Please try again."));
  }
}));

// ---- /api/admin/clients/:id ----------------------------------------------------

const therapistName = (t: { firstName: string; lastName: string }) => `${t.firstName} ${t.lastName}`.trim();

// GET /api/admin/clients/[id] — one client: therapist, sessions and progress
// record counts. Name masked and clinical/contact fields omitted unless
// ?reveal=1 (needs phi.read; audited as phi.reveal).
router.get('/admin/clients/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.read');
    if (!auth.ok) return send(res, auth.response);
    const reveal = queryParams(req).get('reveal') === '1';
    if (reveal && !can(auth.adminRole, 'phi.read')) {
      return res.status(403).json({ error: "Your admin role doesn't allow viewing full client details. Ask a super admin if you need access.", code: 'ADMIN_FORBIDDEN' });
    }

    const client = await prisma.profileClient.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { email: true, status: true, suspendedAt: true, lastSeenAt: true } },
        sessions: { orderBy: { scheduledAt: 'desc' } },
        claimedInvites: { select: { id: true, status: true, createdAt: true, therapistId: true } },
        _count: { select: { progressMetrics: true, progressReports: true, progressNotes: true, bookings: true } },
      },
    });
    if (!client) return res.status(404).json({ error: "We couldn't find this client. They may have been removed." });

    if (reveal) {
      await audit(req, auth, 'phi.reveal', { type: 'ProfileClient', id: client.id }, { after: { scope: 'client.detail' } });
    }

    const [finalReports, therapists] = await Promise.all([
      prisma.progressReport.count({ where: { clientId: client.id, status: 'FINAL' } }),
      therapistsById([client.therapistId, ...client.sessions.map((s) => s.therapistId)], { id: true, userId: true, firstName: true, lastName: true }),
    ]);
    const therapist = (client.therapistId && therapists.get(client.therapistId)) || null;
    const therapistUser = therapist ? (await usersById([therapist.userId], { email: true })).get(therapist.userId) : null;
    const statusCounts: Record<string, number> = {};
    let totalMinutes = 0;
    for (const s of client.sessions) {
      statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
      if (s.startedAt && s.endedAt) totalMinutes += Math.max(0, (s.endedAt.getTime() - s.startedAt.getTime()) / 60000);
    }

    return res.json({
      client: {
        id: client.id,
        userId: client.userId,
        name: reveal ? `${client.firstName} ${client.lastName}`.trim() : maskName(client.firstName, client.lastName),
        masked: !reveal,
        createdAt: client.createdAt,
        status: client.user?.status ?? 'ACTIVE',
        suspendedAt: client.user?.suspendedAt ?? null,
        lastSeenAt: client.user?.lastSeenAt ?? null,
        inviteStatus: client.claimedInvites.length ? 'CLAIMED' : 'DIRECT',
        ...(reveal
          ? {
              phi: {
                firstName: client.firstName,
                lastName: client.lastName,
                dateOfBirth: client.dateOfBirth,
                gender: client.gender,
                diagnosis: client.diagnosis,
                parentEmail: client.parentEmail,
                phoneNumber: client.phoneNumber,
                email: client.user?.email ?? null,
              },
            }
          : {}),
      },
      therapist: therapist
        ? { id: therapist.id, name: therapistName(therapist), email: therapistUser?.email ?? '' }
        : null,
      stats: {
        sessions: client.sessions.length,
        byStatus: statusCounts,
        totalMinutes: Math.round(totalMinutes),
        lastSession: client.sessions[0]?.scheduledAt ?? null,
        bookings: client._count.bookings,
      },
      progress: {
        metrics: client._count.progressMetrics,
        reports: client._count.progressReports,
        finalReports,
        notes: client._count.progressNotes,
      },
      sessions: client.sessions.map((s) => ({
        id: s.id,
        status: s.status,
        scheduledAt: s.scheduledAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMinutes: s.startedAt && s.endedAt ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000) : null,
        therapist: { id: s.therapistId, name: therapists.has(s.therapistId) ? therapistName(therapists.get(s.therapistId)!) : '' },
      })),
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin client detail error', "We couldn't load this client. Please try again."));
  }
}));

// PATCH /api/admin/clients/[id] — reassign the client to another therapist.
// Body: { therapistId }. Existing sessions keep their original therapist.
router.patch('/admin/clients/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.write');
    if (!auth.ok) return send(res, auth.response);
    const { therapistId } = req.body;
    if (!therapistId || typeof therapistId !== 'string') {
      return res.status(400).json({ error: 'Choose the professional to move this client to.' });
    }

    const client = await prisma.profileClient.findUnique({ where: { id: req.params.id }, select: { id: true, therapistId: true } });
    if (!client) return res.status(404).json({ error: "We couldn't find this client. They may have been removed." });
    if (client.therapistId === therapistId) {
      return res.status(400).json({ error: 'The client is already assigned to this therapist.' });
    }
    const target = await appDb.profileTherapist.findUnique({ where: { id: therapistId }, select: { id: true, firstName: true, lastName: true } });
    if (!target) return res.status(404).json({ error: "We couldn't find the professional you chose. Their account may have been removed." });

    await prisma.profileClient.update({ where: { id: client.id }, data: { therapistId: target.id } });
    await audit(req, auth, 'client.reassign', { type: 'ProfileClient', id: client.id }, {
      before: { therapistId: client.therapistId },
      after: { therapistId: target.id },
    });

    return res.json({ success: true, therapist: { id: target.id, name: therapistName(target) } });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin client reassign error', "We couldn't move this client to the new professional. Please try again."));
  }
}));
