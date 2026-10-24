import { NextResponse } from 'next/server';
import type { Prisma, TicketStatus } from '@prisma/client';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { dateRange, listParams } from '@/lib/admin/adminList';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

const STATUSES: TicketStatus[] = ['OPEN', 'PENDING', 'RESOLVED'];

// GET /api/admin/support — helpdesk tickets.
// ?status=OPEN&category=Billing&assignee=<uid>|me|none&q=<ref/email/subject>&from&to&page
// counts = tickets per status for the other filters (for the status tabs).
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'support');
    if (!auth.ok) return auth.response;

    const { sp, page, pageSize, skip, take, sort, dir, q, from, to } = listParams(request, {
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

    return NextResponse.json({
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
    return errorResponse(e, 'GET /api/admin/support failed', "We couldn't load support tickets. Please try again.");
  }
}
