import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { can } from '@/lib/admin/adminRoles';
import { listParams } from '@/lib/admin/adminList';

export const dynamic = 'force-dynamic';

const initial = (s: string | null | undefined) => (s?.trim() ? `${s.trim()[0].toUpperCase()}.` : '');
const maskName = (first: string, last: string) => [initial(first), initial(last)].filter(Boolean).join(' ') || '—';

// GET /api/admin/clients — every client across therapists.
// ?q= (name / email), ?therapistId=, ?invite=claimed|direct, ?status=ACTIVE|SUSPENDED,
// ?sort=createdAt|name|sessions, ?reveal=1 (needs phi.read; audited as phi.reveal).
// Names are masked to initials unless revealed. Search still matches full names.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'people.read');
    if (!auth.ok) return auth.response;
    const { sp, skip, take, sort, dir, q } = listParams(request, {
      sortable: ['createdAt', 'name', 'sessions'],
      defaultSort: 'createdAt',
    });

    const reveal = sp.get('reveal') === '1';
    if (reveal && !can(auth.adminRole, 'phi.read')) {
      return NextResponse.json({ error: 'Your admin role does not allow revealing client details.', code: 'ADMIN_FORBIDDEN' }, { status: 403 });
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
          therapist: { select: { id: true, firstName: true, lastName: true } },
          user: { select: { status: true } },
          _count: { select: { sessions: true, claimedInvites: true } },
        },
      }),
      prisma.profileClient.count({ where }),
    ]);

    const ids = rows.map((r) => r.id);
    const last = ids.length
      ? await prisma.session.groupBy({ by: ['clientId'], where: { clientId: { in: ids } }, _max: { scheduledAt: true } })
      : [];
    const lastBy = new Map(last.map((l) => [l.clientId, l._max.scheduledAt]));

    if (reveal && ids.length) {
      await audit(request, auth, 'phi.reveal', { type: 'ProfileClient' }, { after: { scope: 'clients.list', clientIds: ids } });
    }

    return NextResponse.json({
      clients: rows.map((r) => ({
        id: r.id,
        name: reveal ? `${r.firstName} ${r.lastName}`.trim() : maskName(r.firstName, r.lastName),
        masked: !reveal,
        therapist: r.therapist ? { id: r.therapist.id, name: `${r.therapist.firstName} ${r.therapist.lastName}`.trim() } : null,
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
    console.error('Admin clients list error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
