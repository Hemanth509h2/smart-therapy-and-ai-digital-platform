import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';

export const dynamic = 'force-dynamic';

// GET /api/admin/therapists/[id]/phi — full client records (names, DOB,
// diagnosis, contact) for one therapist. Every call is audited as phi.reveal.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'phi.read');
    if (!auth.ok) return auth.response;
    const { id } = params;

    const therapist = await prisma.profileTherapist.findUnique({ where: { id }, select: { id: true } });
    if (!therapist) return NextResponse.json({ error: 'Therapist not found' }, { status: 404 });

    // Same population as the detail view: linked clients + anyone they've had a session with.
    const clients = await prisma.profileClient.findMany({
      where: { OR: [{ therapistId: id }, { sessions: { some: { therapistId: id } } }] },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        diagnosis: true,
        parentEmail: true,
        phoneNumber: true,
        createdAt: true,
        user: { select: { email: true } },
      },
      orderBy: { firstName: 'asc' },
    });

    await audit(request, auth, 'phi.reveal', { type: 'ProfileTherapist', id }, { after: { scope: 'therapist.clients', clientIds: clients.map((c) => c.id) } });

    return NextResponse.json({
      clients: clients.map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        firstName: c.firstName,
        lastName: c.lastName,
        dateOfBirth: c.dateOfBirth,
        gender: c.gender,
        diagnosis: c.diagnosis,
        parentEmail: c.parentEmail,
        phoneNumber: c.phoneNumber,
        email: c.user?.email ?? null,
        createdAt: c.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('Admin therapist PHI error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
