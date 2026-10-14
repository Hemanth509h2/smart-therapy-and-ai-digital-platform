import { NextResponse } from 'next/server';
import { Prisma, type SessionStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { daysAgo, listParams } from '@/lib/adminList';

export const dynamic = 'force-dynamic';

const STATUSES: SessionStatus[] = ['SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

// Client names are PHI: the monitor only ever shows initials ("A. K.").
const mask = (c?: { firstName: string; lastName: string } | null) =>
  c ? [c.firstName, c.lastName].map((n) => (n?.trim() ? `${n.trim()[0].toUpperCase()}.` : '')).filter(Boolean).join(' ') || '—' : '—';

const therapistName = (t?: { firstName: string; lastName: string } | null) => (t ? `${t.firstName} ${t.lastName}`.trim() : '—');

const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

// GET /api/admin/sessions?view=live|all|risk
//   live — sessions in progress right now
//   all  — paginated sessions (status, therapist, from/to, sort scheduledAt|duration) + stats for the range
//   risk — AI risk flags (?state=open|acknowledged)
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'people.read');
    if (!auth.ok) return auth.response;

    const { sp, page, pageSize, skip, take, sort, dir, from, to } = listParams(request, {
      sortable: ['scheduledAt', 'duration'],
      defaultSort: 'scheduledAt',
    });
    const view = sp.get('view') || 'all';
    const now = new Date();

    if (view === 'live') {
      const live = await prisma.session.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { startedAt: 'asc' },
        take: 200,
        include: {
          therapist: { select: { id: true, firstName: true, lastName: true } },
          client: { select: { firstName: true, lastName: true } },
        },
      });
      return NextResponse.json({
        sessions: live.map((s) => ({
          id: s.id,
          therapistId: s.therapist.id,
          therapist: therapistName(s.therapist),
          client: mask(s.client),
          scheduledAt: s.scheduledAt,
          startedAt: s.startedAt,
          minutes: minutesBetween(s.startedAt ?? s.scheduledAt, now),
        })),
        total: live.length,
        generatedAt: now,
      });
    }

    if (view === 'risk') {
      const state = sp.get('state');
      const where: Prisma.RiskFlagWhereInput =
        state === 'open' ? { acknowledgedAt: null } : state === 'acknowledged' ? { acknowledgedAt: { not: null } } : {};
      const [flags, total, open] = await Promise.all([
        prisma.riskFlag.findMany({
          where,
          // Open flags first (NULL acknowledgedAt sorts first descending), newest first.
          orderBy: [{ acknowledgedAt: { sort: 'desc', nulls: 'first' } }, { raisedAt: 'desc' }],
          skip,
          take,
        }),
        prisma.riskFlag.count({ where }),
        prisma.riskFlag.count({ where: { acknowledgedAt: null } }),
      ]);
      const sessionIds = Array.from(new Set(flags.map((f) => f.sessionId)));
      const ackUids = Array.from(new Set(flags.map((f) => f.acknowledgedBy).filter(Boolean) as string[]));
      const [sessions, ackUsers] = await Promise.all([
        prisma.session.findMany({
          where: { id: { in: sessionIds } },
          select: { id: true, scheduledAt: true, startedAt: true, therapist: { select: { id: true, firstName: true, lastName: true } } },
        }),
        prisma.user.findMany({ where: { id: { in: ackUids } }, select: { id: true, email: true } }),
      ]);
      const byId = new Map(sessions.map((s) => [s.id, s]));
      const emails = new Map(ackUsers.map((u) => [u.id, u.email]));
      return NextResponse.json({
        flags: flags.map((f) => {
          const s = byId.get(f.sessionId);
          return {
            ...f,
            sessionDate: s?.startedAt ?? s?.scheduledAt ?? null,
            therapistId: s?.therapist.id ?? f.therapistId,
            therapist: therapistName(s?.therapist),
            acknowledgedByEmail: f.acknowledgedBy ? emails.get(f.acknowledgedBy) ?? null : null,
          };
        }),
        total,
        open,
        page,
        pageSize,
      });
    }

    // view=all
    const status = sp.get('status') as SessionStatus | null;
    const therapistId = sp.get('therapist');
    const rangeFrom = from ?? daysAgo(30);
    const rangeTo = to ?? now;
    const where: Prisma.SessionWhereInput = {
      scheduledAt: { gte: rangeFrom, lte: rangeTo },
      ...(therapistId ? { therapistId } : {}),
    };
    const listWhere: Prisma.SessionWhereInput = {
      ...where,
      ...(status === ('NO_SHOW' as string)
        ? { status: 'SCHEDULED', startedAt: null, scheduledAt: { gte: rangeFrom, lte: rangeTo < now ? rangeTo : now } }
        : status && STATUSES.includes(status)
          ? { status }
          : {}),
    };

    const include = {
      therapist: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { firstName: true, lastName: true } },
    } as const;

    let rows: Prisma.SessionGetPayload<{ include: typeof include }>[];
    let total: number;
    if (sort === 'duration') {
      // Duration is computed (endedAt - startedAt), so order ids in SQL first.
      const ids = await prisma.session.findMany({ where: listWhere, select: { id: true } });
      total = ids.length;
      const ordered = ids.length
        ? await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT id FROM "Session" WHERE id IN (${Prisma.join(ids.map((i) => i.id))})
            ORDER BY (COALESCE("endedAt", CASE WHEN status = 'ACTIVE' THEN now() END) - "startedAt") ${dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`} NULLS LAST, "scheduledAt" DESC
            OFFSET ${skip} LIMIT ${take}`)
        : [];
      const found = await prisma.session.findMany({ where: { id: { in: ordered.map((o) => o.id) } }, include });
      const byId = new Map(found.map((r) => [r.id, r]));
      rows = ordered.map((o) => byId.get(o.id)!).filter(Boolean);
    } else {
      [rows, total] = await Promise.all([
        prisma.session.findMany({ where: listWhere, orderBy: { scheduledAt: dir }, skip, take, include }),
        prisma.session.count({ where: listWhere }),
      ]);
    }

    const [byStatus, noShow, avg, flagged, therapists] = await Promise.all([
      prisma.session.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.session.count({ where: { ...where, status: 'SCHEDULED', startedAt: null, scheduledAt: { gte: rangeFrom, lt: rangeTo < now ? rangeTo : now } } }),
      prisma.$queryRaw<{ avg: number | null }[]>(Prisma.sql`
        SELECT avg(extract(epoch FROM ("endedAt" - "startedAt")) / 60)::float AS avg
        FROM "Session"
        WHERE status = 'COMPLETED' AND "startedAt" IS NOT NULL AND "endedAt" IS NOT NULL
          AND "scheduledAt" >= ${rangeFrom} AND "scheduledAt" <= ${rangeTo}
          ${therapistId ? Prisma.sql`AND "therapistId" = ${therapistId}` : Prisma.empty}`),
      prisma.riskFlag.findMany({ where: { sessionId: { in: rows.map((r) => r.id) } }, select: { sessionId: true } }),
      // Options for the therapist filter.
      prisma.profileTherapist.findMany({ select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: 'asc' }, take: 500 }),
    ]);
    const count = (s: SessionStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const totalInRange = byStatus.reduce((n, b) => n + b._count._all, 0);
    const completed = count('COMPLETED');
    const cancelled = count('CANCELLED');
    // Rates are out of sessions that were due in the range (not still upcoming).
    const due = completed + cancelled + noShow + count('ACTIVE');
    const flaggedIds = new Set(flagged.map((f) => f.sessionId));

    return NextResponse.json({
      sessions: rows.map((s) => ({
        id: s.id,
        status: s.status,
        noShow: s.status === 'SCHEDULED' && !s.startedAt && s.scheduledAt < now,
        scheduledAt: s.scheduledAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        minutes: s.startedAt ? minutesBetween(s.startedAt, s.endedAt ?? (s.status === 'ACTIVE' ? now : s.startedAt)) : null,
        therapistId: s.therapist.id,
        therapist: therapistName(s.therapist),
        client: mask(s.client),
        riskFlag: flaggedIds.has(s.id),
      })),
      total,
      page,
      pageSize,
      therapists: therapists.map((t) => ({ id: t.id, name: therapistName(t) })),
      stats: {
        from: rangeFrom,
        to: rangeTo,
        total: totalInRange,
        completed,
        cancelled,
        noShow,
        scheduled: count('SCHEDULED') - noShow,
        active: count('ACTIVE'),
        avgMinutes: avg[0]?.avg != null ? Math.round(avg[0].avg * 10) / 10 : null,
        cancellationRate: due ? cancelled / due : null,
        noShowRate: due ? noShow / due : null,
      },
    });
  } catch (e: any) {
    console.error('GET /api/admin/sessions failed:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
