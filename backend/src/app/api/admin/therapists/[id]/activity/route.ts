import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { listParams } from '@/lib/adminList';

export const dynamic = 'force-dynamic';

// GET /api/admin/therapists/[id]/activity — audit entries whose target is this
// therapist (profile id) or their user account (uid), newest first.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'people.read');
    if (!auth.ok) return auth.response;
    const { skip, take } = listParams(request, { sortable: ['createdAt'], defaultSort: 'createdAt' });

    const therapist = await prisma.profileTherapist.findUnique({ where: { id: params.id }, select: { id: true, userId: true } });
    if (!therapist) return NextResponse.json({ error: 'Therapist not found' }, { status: 404 });

    const where = {
      OR: [
        { targetType: { in: ['ProfileTherapist', 'Therapist'] }, targetId: therapist.id },
        { targetType: 'User', targetId: therapist.userId },
      ],
    };
    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        action: e.action,
        actorUid: e.actorUid,
        actorEmail: e.actorEmail,
        targetType: e.targetType,
        targetId: e.targetId,
        before: e.before,
        after: e.after,
        createdAt: e.createdAt,
      })),
      total,
    });
  } catch (error: any) {
    console.error('Admin therapist activity error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
