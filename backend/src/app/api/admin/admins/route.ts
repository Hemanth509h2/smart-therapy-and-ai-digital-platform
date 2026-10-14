import { NextResponse } from 'next/server';
import type { AdminRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin, requireRecentLogin } from '@/lib/apiAuth';
import { audit } from '@/lib/audit';
import { adminAuth } from '@/lib/firebaseAdmin';
import { errorResponse } from '@/lib/apiError';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES: AdminRole[] = ['SUPER_ADMIN', 'BILLING', 'SUPPORT', 'CONTENT'];

// GET /api/admin/admins — every admin account plus open (unaccepted,
// unrevoked) invites. Users with role ADMIN but no ProfileAdmin row predate
// roles and are treated as SUPER_ADMIN (see requireAdmin).
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'admins.manage');
    if (!auth.ok) return auth.response;

    const [users, invites] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'ADMIN' },
        include: { admin: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.adminInvite.findMany({
        where: { acceptedAt: null, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const now = Date.now();
    return NextResponse.json({
      admins: users.map((u) => ({
        id: u.admin?.id ?? null,
        userId: u.id,
        name: u.admin ? `${u.admin.firstName} ${u.admin.lastName}`.trim() : '',
        email: u.email,
        adminRole: u.admin?.adminRole ?? 'SUPER_ADMIN',
        status: u.status,
        lastSeenAt: u.lastSeenAt,
        createdAt: u.admin?.createdAt ?? u.createdAt,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        adminRole: i.adminRole,
        invitedBy: i.invitedBy,
        expiresAt: i.expiresAt,
        expired: i.expiresAt.getTime() < now,
        createdAt: i.createdAt,
      })),
    });
  } catch (error: any) {
    return errorResponse(error, 'Admins GET error');
  }
}

// POST /api/admin/admins — create (or promote) an admin account directly.
// Body: { email, password?, firstName?, lastName?, adminRole? }
// If the email already has a Firebase user, it is reused (and promoted); a new
// password, when provided, is applied. Otherwise a new Firebase user is created.
// New admins default to SUPPORT (least privilege) — SUPER_ADMIN only when
// chosen explicitly. An existing admin's role is left alone here; change it
// with PATCH /api/admin/admins/[uid], which guards the last super admin.
// Prefer invites (POST /api/admin/invites): they prove the invitee owns the email.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request, 'admins.manage');
    if (!auth.ok) return auth.response;
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return stepUp;

    const { email: rawEmail, password, firstName, lastName, adminRole } = await request.json();
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }
    if (adminRole !== undefined && !ADMIN_ROLES.includes(adminRole)) {
      return NextResponse.json({ error: 'Invalid adminRole' }, { status: 400 });
    }

    const firebaseAdminAuth = adminAuth();

    let uid: string;
    let createdFirebaseUser = false;
    try {
      const existing = await firebaseAdminAuth.getUserByEmail(email);
      uid = existing.uid;
      if (password) {
        await firebaseAdminAuth.updateUser(uid, { password });
      }
    } catch {
      if (!password || String(password).length < 6) {
        return NextResponse.json(
          { error: 'A password of at least 6 characters is required for a new admin.' },
          { status: 400 }
        );
      }
      const created = await firebaseAdminAuth.createUser({ email, password });
      uid = created.uid;
      createdFirebaseUser = true;
    }

    const before = await prisma.user.findUnique({
      where: { id: uid },
      select: { role: true, admin: { select: { adminRole: true } } },
    });

    // Upsert the DB user as ADMIN + ensure an admin profile exists.
    await prisma.user.upsert({
      where: { id: uid },
      update: { role: 'ADMIN', email },
      create: { id: uid, email, role: 'ADMIN' },
    });

    const profile = await prisma.profileAdmin.upsert({
      where: { userId: uid },
      update: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
      },
      create: {
        userId: uid,
        firstName: firstName || 'Admin',
        lastName: lastName || '',
        // A legacy ADMIN with no profile row was effectively a super admin.
        adminRole: adminRole ?? (before?.role === 'ADMIN' ? 'SUPER_ADMIN' : 'SUPPORT'),
      },
    });

    await setRoleClaim(uid, 'ADMIN');

    await audit(
      request,
      auth,
      createdFirebaseUser || !before ? 'admin.create' : 'admin.promote',
      { type: 'User', id: uid },
      {
        before: before ? { role: before.role, adminRole: before.admin?.adminRole ?? null } : null,
        after: { role: 'ADMIN', adminRole: profile.adminRole, email, passwordSet: !!password },
      }
    );

    return NextResponse.json({
      success: true,
      admin: { id: profile.id, userId: uid, email, adminRole: profile.adminRole },
    });
  } catch (error: any) {
    return errorResponse(error, 'Admins POST error');
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
