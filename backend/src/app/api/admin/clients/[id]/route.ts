import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { can } from '@/lib/admin/adminRoles';

export const dynamic = 'force-dynamic';

const initial = (s: string | null | undefined) => (s?.trim() ? `${s.trim()[0].toUpperCase()}.` : '');
const maskName = (first: string, last: string) => [initial(first), initial(last)].filter(Boolean).join(' ') || '—';
const therapistName = (t: { firstName: string; lastName: string }) => `${t.firstName} ${t.lastName}`.trim();

// GET /api/admin/clients/[id] — one client: therapist, sessions and progress
// record counts. Name masked and clinical/contact fields omitted unless
// ?reveal=1 (needs phi.read; audited as phi.reveal).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'people.read');
    if (!auth.ok) return auth.response;
    const reveal = new URL(request.url).searchParams.get('reveal') === '1';
    if (reveal && !can(auth.adminRole, 'phi.read')) {
      return NextResponse.json({ error: 'Your admin role does not allow revealing client details.', code: 'ADMIN_FORBIDDEN' }, { status: 403 });
    }

    const client = await prisma.profileClient.findUnique({
      where: { id: params.id },
      include: {
        user: { select: { email: true, status: true, suspendedAt: true, lastSeenAt: true } },
        therapist: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
        sessions: {
          orderBy: { scheduledAt: 'desc' },
          include: { therapist: { select: { id: true, firstName: true, lastName: true } } },
        },
        claimedInvites: { select: { id: true, status: true, createdAt: true, therapistId: true } },
        _count: { select: { progressMetrics: true, progressReports: true, progressNotes: true, bookings: true } },
      },
    });
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    if (reveal) {
      await audit(request, auth, 'phi.reveal', { type: 'ProfileClient', id: client.id }, { after: { scope: 'client.detail' } });
    }

    const finalReports = await prisma.progressReport.count({ where: { clientId: client.id, status: 'FINAL' } });
    const statusCounts: Record<string, number> = {};
    let totalMinutes = 0;
    for (const s of client.sessions) {
      statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
      if (s.startedAt && s.endedAt) totalMinutes += Math.max(0, (s.endedAt.getTime() - s.startedAt.getTime()) / 60000);
    }

    return NextResponse.json({
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
      therapist: client.therapist
        ? { id: client.therapist.id, name: therapistName(client.therapist), email: client.therapist.user?.email ?? '' }
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
        therapist: { id: s.therapist.id, name: therapistName(s.therapist) },
      })),
    });
  } catch (error: any) {
    console.error('Admin client detail error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/admin/clients/[id] — reassign the client to another therapist.
// Body: { therapistId }. Existing sessions keep their original therapist.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'people.write');
    if (!auth.ok) return auth.response;
    const { therapistId } = await request.json();
    if (!therapistId || typeof therapistId !== 'string') {
      return NextResponse.json({ error: 'therapistId is required' }, { status: 400 });
    }

    const client = await prisma.profileClient.findUnique({ where: { id: params.id }, select: { id: true, therapistId: true } });
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    if (client.therapistId === therapistId) {
      return NextResponse.json({ error: 'The client is already assigned to this therapist.' }, { status: 400 });
    }
    const target = await prisma.profileTherapist.findUnique({ where: { id: therapistId }, select: { id: true, firstName: true, lastName: true } });
    if (!target) return NextResponse.json({ error: 'Target therapist not found' }, { status: 404 });

    await prisma.profileClient.update({ where: { id: client.id }, data: { therapistId: target.id } });
    await audit(request, auth, 'client.reassign', { type: 'ProfileClient', id: client.id }, {
      before: { therapistId: client.therapistId },
      after: { therapistId: target.id },
    });

    return NextResponse.json({ success: true, therapist: { id: target.id, name: therapistName(target) } });
  } catch (error: any) {
    console.error('Admin client reassign error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
