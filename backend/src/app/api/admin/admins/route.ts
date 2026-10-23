import { NextResponse } from 'next/server';
import type { AdminRole } from '.prisma/app-client';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin, requireRecentLogin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { adminAuth } from '@/lib/core/firebaseAdmin';
import { errorResponse } from '@/lib/http/apiError';

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
        orderBy: { createdAt: 'asc' },
      }),
      appDb.adminInvite.findMany({
        where: { acceptedAt: null, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const profiles = await appDb.profileAdmin.findMany({ where: { userId: { in: users.map((u) => u.id) } } });
    const adminOf = new Map(profiles.map((p) => [p.userId, p]));

    const now = Date.now();
    return NextResponse.json({
      admins: users.map((u) => {
        const admin = adminOf.get(u.id);
        return {
          id: admin?.id ?? null,
          userId: u.id,
          name: admin ? `${admin.firstName} ${admin.lastName}`.trim() : '',
          email: u.email,
          adminRole: admin?.adminRole ?? 'SUPER_ADMIN',
          status: u.status,
          lastSeenAt: u.lastSeenAt,
          createdAt: admin?.createdAt ?? u.createdAt,
        };
      }),
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

    const [before, beforeAdmin] = await Promise.all([
      prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
      appDb.profileAdmin.findUnique({ where: { userId: uid }, select: { adminRole: true } }),
    ]);

    // Ensure an admin profile exists, then upsert the DB user as ADMIN. Not
    // atomic across the two databases: the profile goes first because an ADMIN
    // with no profile row counts as SUPER_ADMIN.
    const profile = await appDb.profileAdmin.upsert({
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

    await prisma.user.upsert({
      where: { id: uid },
      update: { role: 'ADMIN', email },
      create: { id: uid, email, role: 'ADMIN' },
    });

    await setRoleClaim(uid, 'ADMIN');

    await audit(
      request,
      auth,
      createdFirebaseUser || !before ? 'admin.create' : 'admin.promote',
      { type: 'User', id: uid },
      {
        before: before ? { role: before.role, adminRole: beforeAdmin?.adminRole ?? null } : null,
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
