import { NextResponse } from 'next/server';
import type { AdminRole, Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin, requireRecentLogin } from '@/lib/apiAuth';
import { audit } from '@/lib/audit';
import { adminAuth } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES: AdminRole[] = ['SUPER_ADMIN', 'BILLING', 'SUPPORT', 'CONTENT'];

// Admins with no ProfileAdmin row predate roles and count as SUPER_ADMIN.
const SUPER_ADMIN_WHERE = {
  role: 'ADMIN' as const,
  OR: [{ admin: { is: null } }, { admin: { is: { adminRole: 'SUPER_ADMIN' as const } } }],
};

async function loadAdmin(uid: string) {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    include: {
      admin: true,
      therapist: { select: { id: true } },
      client: { select: { id: true } },
    },
  });
  if (!user || user.role !== 'ADMIN') return null;
  return { ...user, adminRole: (user.admin?.adminRole ?? 'SUPER_ADMIN') as AdminRole };
}

// PATCH /api/admin/admins/[uid] — change an admin's role. Body: { adminRole }
// You can't change your own role, and the last super admin can't be demoted.
export async function PATCH(request: Request, { params }: { params: { uid: string } }) {
  try {
    const auth = await requireAdmin(request, 'admins.manage');
    if (!auth.ok) return auth.response;
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return stepUp;

    const { adminRole } = await request.json().catch(() => ({}));
    if (!ADMIN_ROLES.includes(adminRole)) {
      return NextResponse.json({ error: 'Invalid adminRole' }, { status: 400 });
    }
    if (params.uid === auth.uid) {
      return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
    }

    const target = await loadAdmin(params.uid);
    if (!target) return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    if (target.adminRole === adminRole) {
      return NextResponse.json({ success: true, admin: { userId: target.id, adminRole } });
    }
    if (target.adminRole === 'SUPER_ADMIN' && (await prisma.user.count({ where: SUPER_ADMIN_WHERE })) <= 1) {
      return NextResponse.json({ error: "You can't demote the last super admin." }, { status: 409 });
    }

    await prisma.profileAdmin.upsert({
      where: { userId: target.id },
      update: { adminRole },
      create: { userId: target.id, adminRole },
    });

    await audit(request, auth, 'admin.role_change', { type: 'User', id: target.id }, {
      before: { adminRole: target.adminRole },
      after: { adminRole },
    });

    return NextResponse.json({ success: true, admin: { userId: target.id, adminRole } });
  } catch (error: any) {
    console.error('Admin PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/admin/admins/[uid] — remove admin access. The account itself
// stays: its role goes back to THERAPIST/CLIENT (whichever profile it has,
// else CLIENT) and the ProfileAdmin row is deleted.
export async function DELETE(request: Request, { params }: { params: { uid: string } }) {
  try {
    const auth = await requireAdmin(request, 'admins.manage');
    if (!auth.ok) return auth.response;
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return stepUp;

    if (params.uid === auth.uid) {
      return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });
    }

    const target = await loadAdmin(params.uid);
    if (!target) return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    if (target.adminRole === 'SUPER_ADMIN' && (await prisma.user.count({ where: SUPER_ADMIN_WHERE })) <= 1) {
      return NextResponse.json({ error: "You can't remove the last super admin." }, { status: 409 });
    }

    const newRole: Role = target.therapist ? 'THERAPIST' : 'CLIENT';
    await prisma.$transaction([
      prisma.profileAdmin.deleteMany({ where: { userId: target.id } }),
      prisma.user.update({ where: { id: target.id }, data: { role: newRole } }),
    ]);

    await setRoleClaim(target.id, newRole);

    await audit(request, auth, 'admin.remove', { type: 'User', id: target.id }, {
      before: { role: 'ADMIN', adminRole: target.adminRole, email: target.email },
      after: { role: newRole },
    });

    return NextResponse.json({ success: true, userId: target.id, role: newRole });
  } catch (error: any) {
    console.error('Admin DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Mirror the DB role onto the Firebase custom claim (see users/profile POST).
// Non-fatal: scripts/backfill-role-claims.mjs repairs any that slip through.
async function setRoleClaim(uid: string, role: string) {
  try {
    const record = await adminAuth().getUser(uid);
    await adminAuth().setCustomUserClaims(uid, { ...(record.customClaims ?? {}), role });
  } catch (e: any) {
    console.error('Failed to set role claim for', uid, e?.message);
  }
}
