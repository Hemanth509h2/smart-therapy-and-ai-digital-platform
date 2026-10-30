import { Router } from 'express';
import type { AdminRole } from '.prisma/app-client';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin, requireRecentLogin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { adminAuth } from '@/lib/core/firebaseAdmin';
import { errorResponse } from '@/lib/http/apiError';
import type { Role } from '@prisma/client';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/admins ---------------------------------------------------------

const ADMIN_ROLES: AdminRole[] = ['SUPER_ADMIN', 'BILLING', 'SUPPORT', 'CONTENT'];

// GET /api/admin/admins — every admin account plus open (unaccepted,
// unrevoked) invites. Users with role ADMIN but no ProfileAdmin row predate
// roles and are treated as SUPER_ADMIN (see requireAdmin).
router.get('/admin/admins', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'admins.manage');
    if (!auth.ok) return send(res, auth.response);

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
    return res.json({
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
    return send(res, errorResponse(error, 'Admins GET error'));
  }
}));

// POST /api/admin/admins — create (or promote) an admin account directly.
// Body: { email, password?, firstName?, lastName?, adminRole? }
// If the email already has a Firebase user, it is reused (and promoted); a new
// password, when provided, is applied. Otherwise a new Firebase user is created.
// New admins default to SUPPORT (least privilege) — SUPER_ADMIN only when
// chosen explicitly. An existing admin's role is left alone here; change it
// with PATCH /api/admin/admins/[uid], which guards the last super admin.
// Prefer invites (POST /api/admin/invites): they prove the invitee owns the email.
router.post('/admin/admins', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'admins.manage');
    if (!auth.ok) return send(res, auth.response);
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return send(res, stepUp);

    const { email: rawEmail, password, firstName, lastName, adminRole } = req.body;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!email) {
      return res.status(400).json({ error: "Enter the new admin's email address." });
    }
    if (adminRole !== undefined && !ADMIN_ROLES.includes(adminRole)) {
      return res.status(400).json({ error: 'Choose a valid admin role.' });
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
        return res.status(400).json({ error: 'Enter a password of at least 6 characters for the new admin.' });
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
      req,
      auth,
      createdFirebaseUser || !before ? 'admin.create' : 'admin.promote',
      { type: 'User', id: uid },
      {
        before: before ? { role: before.role, adminRole: beforeAdmin?.adminRole ?? null } : null,
        after: { role: 'ADMIN', adminRole: profile.adminRole, email, passwordSet: !!password },
      }
    );

    return res.json({
      success: true,
      admin: { id: profile.id, userId: uid, email, adminRole: profile.adminRole },
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admins POST error'));
  }
}));

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

// ---- /api/admin/admins/:uid ----------------------------------------------------

// Admins with no ProfileAdmin row predate roles and count as SUPER_ADMIN.
async function countSuperAdmins() {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
  const demoted = await appDb.profileAdmin.count({
    where: { userId: { in: admins.map((a) => a.id) }, adminRole: { not: 'SUPER_ADMIN' } },
  });
  return admins.length - demoted;
}

async function loadAdmin(uid: string) {
  const [user, admin, therapist] = await Promise.all([
    prisma.user.findUnique({ where: { id: uid }, include: { client: { select: { id: true } } } }),
    appDb.profileAdmin.findUnique({ where: { userId: uid } }),
    appDb.profileTherapist.findUnique({ where: { userId: uid }, select: { id: true } }),
  ]);
  if (!user || user.role !== 'ADMIN') return null;
  return { ...user, admin, therapist, adminRole: (admin?.adminRole ?? 'SUPER_ADMIN') as AdminRole };
}

// PATCH /api/admin/admins/[uid] — change an admin's role. Body: { adminRole }
// You can't change your own role, and the last super admin can't be demoted.
router.patch('/admin/admins/:uid', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'admins.manage');
    if (!auth.ok) return send(res, auth.response);
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return send(res, stepUp);

    const { adminRole } = req.body;
    if (!ADMIN_ROLES.includes(adminRole)) {
      return res.status(400).json({ error: 'Choose a valid admin role.' });
    }
    if (req.params.uid === auth.uid) {
      return res.status(400).json({ error: "You can't change your own role." });
    }

    const target = await loadAdmin(req.params.uid);
    if (!target) return res.status(404).json({ error: "We couldn't find this admin. Their access may already have been removed." });
    if (target.adminRole === adminRole) {
      return res.json({ success: true, admin: { userId: target.id, adminRole } });
    }
    if (target.adminRole === 'SUPER_ADMIN' && (await countSuperAdmins()) <= 1) {
      return res.status(409).json({ error: "You can't demote the last super admin." });
    }

    await appDb.profileAdmin.upsert({
      where: { userId: target.id },
      update: { adminRole },
      create: { userId: target.id, adminRole },
    });

    await audit(req, auth, 'admin.role_change', { type: 'User', id: target.id }, {
      before: { adminRole: target.adminRole },
      after: { adminRole },
    });

    return res.json({ success: true, admin: { userId: target.id, adminRole } });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin PATCH error', "We couldn't update this admin. Please try again."));
  }
}));

// DELETE /api/admin/admins/[uid] — remove admin access. The account itself
// stays: its role goes back to THERAPIST/CLIENT (whichever profile it has,
// else CLIENT) and the ProfileAdmin row is deleted.
router.delete('/admin/admins/:uid', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'admins.manage');
    if (!auth.ok) return send(res, auth.response);
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return send(res, stepUp);

    if (req.params.uid === auth.uid) {
      return res.status(400).json({ error: "You can't remove your own admin access." });
    }

    const target = await loadAdmin(req.params.uid);
    if (!target) return res.status(404).json({ error: "We couldn't find this admin. Their access may already have been removed." });
    if (target.adminRole === 'SUPER_ADMIN' && (await countSuperAdmins()) <= 1) {
      return res.status(409).json({ error: "You can't remove the last super admin." });
    }

    const newRole: Role = target.therapist ? 'THERAPIST' : 'CLIENT';
    // Not atomic across the two databases: drop the ADMIN role first, since an
    // ADMIN with no profile row counts as SUPER_ADMIN.
    await prisma.user.update({ where: { id: target.id }, data: { role: newRole } });
    await appDb.profileAdmin.deleteMany({ where: { userId: target.id } });

    await setRoleClaim(target.id, newRole);

    await audit(req, auth, 'admin.remove', { type: 'User', id: target.id }, {
      before: { role: 'ADMIN', adminRole: target.adminRole, email: target.email },
      after: { role: newRole },
    });

    return res.json({ success: true, userId: target.id, role: newRole });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin DELETE error', "We couldn't remove this admin. Please try again."));
  }
}));

