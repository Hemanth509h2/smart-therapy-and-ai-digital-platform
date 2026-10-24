import { NextResponse } from 'next/server';
import { Prisma, type WhatsAppMessageStatus, type WhatsAppMessageType } from '@prisma/client';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { dateRange, daysAgo, listParams } from '@/lib/admin/adminList';
import { therapistsById } from '@/lib/core/links';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

const STATUSES: WhatsAppMessageStatus[] = ['PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'];
const TYPES: WhatsAppMessageType[] = ['CLIENT_INVITE', 'SESSION_SCHEDULED', 'SESSION_STARTED'];

// GET /api/admin/messages — WhatsApp delivery log.
// ?status=FAILED&type=SESSION_STARTED&q=<phone digits>&from&to&page&pageSize
// Also returns per-status counts and delivery rate for the range, and a
// 30-day series of messages sent per day.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'support');
    if (!auth.ok) return auth.response;

    const { sp, page, pageSize, skip, take, sort, dir, q, from, to } = listParams(request, {
      sortable: ['createdAt', 'lastAttemptAt', 'attempts'],
      defaultSort: 'createdAt',
    });
    const status = sp.get('status') as WhatsAppMessageStatus | null;
    const type = sp.get('type') as WhatsAppMessageType | null;
    const digits = q.replace(/[^\d]/g, '');

    const range: Prisma.WhatsAppMessageWhereInput = { createdAt: dateRange(from, to) };
    const where: Prisma.WhatsAppMessageWhereInput = {
      ...range,
      ...(status && STATUSES.includes(status) ? { status } : {}),
      ...(type && TYPES.includes(type) ? { messageType: type } : {}),
      ...(digits ? { phoneNumber: { contains: digits } } : {}),
    };

    const since = daysAgo(29);
    since.setUTCHours(0, 0, 0, 0);
    const [messages, total, byStatus, daily] = await Promise.all([
      prisma.whatsAppMessage.findMany({
        where,
        orderBy: { [sort]: dir },
        skip,
        take,
        include: {
          session: { select: { scheduledAt: true, therapistId: true } },
          invite: { select: { therapistId: true } },
        },
      }),
      prisma.whatsAppMessage.count({ where }),
      prisma.whatsAppMessage.groupBy({ by: ['status'], where: range, _count: { _all: true } }),
      prisma.$queryRaw<{ bucket: Date; n: number }[]>(Prisma.sql`
        SELECT date_trunc('day', COALESCE("sentAt", "lastAttemptAt", "createdAt")) AS bucket, count(*)::int AS n
        FROM "WhatsAppMessage"
        WHERE status IN ('SENT', 'DELIVERED', 'READ') AND COALESCE("sentAt", "lastAttemptAt", "createdAt") >= ${since}
        GROUP BY 1 ORDER BY 1`),
    ]);

    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<WhatsAppMessageStatus, number>;
    for (const b of byStatus) counts[b.status] = b._count._all;
    // Delivery rate = confirmed delivered (or read) out of every send attempt
    // that finished (sent, delivered, read or failed).
    const attempted = counts.SENT + counts.DELIVERED + counts.READ + counts.FAILED;

    const dailyMap = new Map(daily.map((r) => [new Date(r.bucket).toISOString().slice(0, 10), r.n]));
    const sentDaily = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(since.getTime() + i * 864e5);
      return { label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), value: dailyMap.get(d.toISOString().slice(0, 10)) ?? 0 };
    });

    const therapists = await therapistsById(
      messages.flatMap((m) => [m.session?.therapistId, m.invite?.therapistId]),
      { firstName: true, lastName: true }
    );
    const name = (id?: string | null) => {
      const t = id ? therapists.get(id) : undefined;
      return t ? `${t.firstName} ${t.lastName}`.trim() : null;
    };
    return NextResponse.json({
      messages: messages.map(({ session, invite, ...m }) => ({
        ...m,
        therapist: name(session?.therapistId) ?? name(invite?.therapistId),
        sessionAt: session?.scheduledAt ?? null,
      })),
      total,
      page,
      pageSize,
      stats: {
        counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        attempted,
        deliveryRate: attempted ? (counts.DELIVERED + counts.READ) / attempted : null,
        sentRate: attempted ? (counts.SENT + counts.DELIVERED + counts.READ) / attempted : null,
      },
      sentDaily,
    });
  } catch (e: any) {
    return errorResponse(e, 'GET /api/admin/messages failed', "We couldn't load the message log. Please try again.");
  }
}
