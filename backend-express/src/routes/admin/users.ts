import { Router } from 'express';
import { prisma } from '@/lib/core/db';
import { therapistForUser } from '@/lib/core/links';
import { deleteAccount } from '@/lib/core/deleteAccount';
import { requireAdmin, requireRecentLogin, invalidateAccountStatus } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { adminAuth } from '@/lib/core/firebaseAdmin';
import { errorResponse } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/users/:uid -----------------------------------------------------

// DELETE /api/admin/users/[uid] — permanently remove a professional (therapist) and all their data.
// Super admins only, recent sign-in required, and the body must repeat the account email:
//   { confirmEmail: "therapist@example.com" }
//
// Removes the Firebase sign-in account first (so they can't sign in mid-way),
// then everything else via deleteAccount (lib/core/deleteAccount.ts):
// sessions and their Firestore data, notes, progress, invites, messages,
// documents, the clients they added, the user and the therapist profile.
router.delete('/admin/users/:uid', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'admins.manage');
    if (!auth.ok) return send(res, auth.response);
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return send(res, stepUp);

    const body = req.body;
    const confirmEmail = typeof body?.confirmEmail === 'string' ? body.confirmEmail.trim().toLowerCase() : '';

    const [user, therapist] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.params.uid }, select: { id: true, email: true, role: true } }),
      therapistForUser(req.params.uid, { id: true, firstName: true, lastName: true }),
    ]);
    if (!user) return res.status(404).json({ error: "We couldn't find this account. It may have been removed." });
    if (user.id === auth.uid) return res.status(400).json({ error: "You can't remove your own account." });
    if (user.role !== 'THERAPIST' || !therapist) {
      return res.status(400).json({ error: 'Only professional (therapist) accounts can be removed here.' });
    }
    if (!confirmEmail || confirmEmail !== (user.email ?? '').toLowerCase()) {
      return res.status(400).json({ error: "The email you typed doesn't match this account." });
    }

    // 1. Firebase sign-in account
    try {
      await adminAuth().deleteUser(user.id);
    } catch (e: any) {
      if (e?.code !== 'auth/user-not-found') {
        return res.status(502).json({ error: "We couldn't delete this professional's sign-in account, so nothing was removed. Please try again." });
      }
    }

    // 2. Everything else, in both databases and Firestore.
    const result = await deleteAccount(user.id);
    const { warnings = [], ...counts } = result ?? {};
    invalidateAccountStatus(user.id);

    await audit(req, auth, 'user.delete', { type: 'User', id: user.id }, {
      before: {
        email: user.email,
        name: `${therapist.firstName} ${therapist.lastName}`.trim(),
        role: user.role,
        ...counts,
      },
      after: warnings.length ? { firestoreWarnings: warnings.slice(0, 20) } : null,
    });

    return res.json({ removed: true, ...counts, warnings });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin user DELETE error', "We couldn't delete this user. Please try again."));
  }
}));

// ---- /api/admin/users/:uid/status ----------------------------------------------

// PATCH /api/admin/users/[uid]/status — suspend or reactivate any account
// (therapist or client) by Firebase uid. Suspended users are rejected by
// requireAuth on every API call.
// Body: { action: 'suspend' | 'reactivate', reason?: string } (reason required to suspend)
router.patch('/admin/users/:uid/status', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.write');
    if (!auth.ok) return send(res, auth.response);
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return send(res, stepUp);

    const body = req.body;
    const action = body?.action;
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (action !== 'suspend' && action !== 'reactivate') {
      return res.status(400).json({ error: "We couldn't tell whether to suspend or reactivate this account. Refresh the page and try again." });
    }
    if (action === 'suspend' && !reason) {
      return res.status(400).json({ error: 'Enter a reason for suspending this account.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.params.uid },
      select: { id: true, email: true, role: true, status: true, suspendedAt: true, suspendReason: true },
    });
    if (!user) return res.status(404).json({ error: "We couldn't find this account. It may have been removed." });
    if (action === 'suspend') {
      if (user.id === auth.uid) return res.status(400).json({ error: "You can't suspend your own account." });
      if (user.role === 'ADMIN') {
        return res.status(400).json({ error: 'Admin accounts cannot be suspended here. Remove their admin access first.' });
      }
    }

    const before = { status: user.status, suspendedAt: user.suspendedAt, suspendReason: user.suspendReason };
    const updated = await prisma.user.update({
      where: { id: user.id },
      data:
        action === 'suspend'
          ? { status: 'SUSPENDED', suspendedAt: new Date(), suspendReason: reason }
          : { status: 'ACTIVE', suspendedAt: null, suspendReason: null },
      select: { id: true, status: true, suspendedAt: true, suspendReason: true },
    });
    invalidateAccountStatus(user.id);

    await audit(req, auth, action === 'suspend' ? 'user.suspend' : 'user.reactivate', { type: 'User', id: user.id }, {
      before: { ...before, email: user.email, role: user.role },
      after: { status: updated.status, suspendedAt: updated.suspendedAt, suspendReason: updated.suspendReason },
    });

    return res.json({ user: updated });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin user status PATCH error', "We couldn't change this account's status. Please try again."));
  }
}));
