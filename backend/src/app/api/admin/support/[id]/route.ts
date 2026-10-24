import { NextResponse } from 'next/server';
import type { TicketStatus } from '@prisma/client';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

const STATUSES: TicketStatus[] = ['OPEN', 'PENDING', 'RESOLVED'];

// GET /api/admin/support/:id — ticket with its reply thread (oldest first).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'support');
    if (!auth.ok) return auth.response;

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: params.id },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) return NextResponse.json({ error: "We couldn't find this support ticket. It may have been deleted." }, { status: 404 });

    const assignee = ticket.assigneeUid
      ? await prisma.user.findUnique({ where: { id: ticket.assigneeUid }, select: { email: true } })
      : null;
    return NextResponse.json({ ticket: { ...ticket, assigneeEmail: assignee?.email ?? null } });
  } catch (e: any) {
    return errorResponse(e, 'GET /api/admin/support/[id] failed', "We couldn't load this support ticket. Please try again.");
  }
}

// PATCH /api/admin/support/:id { status?, assigneeUid? (null = unassign) }
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'support');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const data: { status?: TicketStatus; assigneeUid?: string | null } = {};
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return NextResponse.json({ error: 'Choose a valid status: Open, Pending or Resolved.' }, { status: 400 });
      data.status = body.status;
    }
    if (body.assigneeUid !== undefined) {
      if (body.assigneeUid === null || body.assigneeUid === '') data.assigneeUid = null;
      else {
        const admin = await prisma.user.findFirst({ where: { id: String(body.assigneeUid), role: 'ADMIN' }, select: { id: true } });
        if (!admin) return NextResponse.json({ error: 'Tickets can only be assigned to an admin.' }, { status: 400 });
        data.assigneeUid = admin.id;
      }
    }
    if (!Object.keys(data).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });

    const before = await prisma.supportTicket.findUnique({ where: { id: params.id }, select: { status: true, assigneeUid: true } });
    if (!before) return NextResponse.json({ error: "We couldn't find this support ticket. It may have been deleted." }, { status: 404 });

    const ticket = await prisma.supportTicket.update({ where: { id: params.id }, data });
    await audit(request, auth, 'ticket.update', { type: 'SupportTicket', id: ticket.id }, {
      before,
      after: { status: ticket.status, assigneeUid: ticket.assigneeUid },
    });
    return NextResponse.json({ ticket });
  } catch (e: any) {
    return errorResponse(e, 'PATCH /api/admin/support/[id] failed', "We couldn't update this support ticket. Please try again.");
  }
}
