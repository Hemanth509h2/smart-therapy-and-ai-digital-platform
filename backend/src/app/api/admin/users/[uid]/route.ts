import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { therapistForUser } from '@/lib/core/links';
import { deleteAccount } from '@/lib/core/deleteAccount';
import { requireAdmin, requireRecentLogin, invalidateAccountStatus } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { adminAuth } from '@/lib/core/firebaseAdmin';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// DELETE /api/admin/users/[uid] — permanently remove a professional (therapist) and all their data.
// Super admins only, recent sign-in required, and the body must repeat the account email:
//   { confirmEmail: "therapist@example.com" }
//
// Removes the Firebase sign-in account first (so they can't sign in mid-way),
// then everything else via deleteAccount (lib/core/deleteAccount.ts):
// sessions and their Firestore data, notes, progress, invites, messages,
// documents, the clients they added, the user and the therapist profile.
export async function DELETE(request: Request, { params }: { params: { uid: string } }) {
  try {
    const auth = await requireAdmin(request, 'admins.manage');
    if (!auth.ok) return auth.response;
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return stepUp;

    const body = await request.json().catch(() => ({}));
    const confirmEmail = typeof body?.confirmEmail === 'string' ? body.confirmEmail.trim().toLowerCase() : '';

    const [user, therapist] = await Promise.all([
      prisma.user.findUnique({ where: { id: params.uid }, select: { id: true, email: true, role: true } }),
      therapistForUser(params.uid, { id: true, firstName: true, lastName: true }),
    ]);
    if (!user) return NextResponse.json({ error: "We couldn't find this account. It may have been removed." }, { status: 404 });
    if (user.id === auth.uid) return NextResponse.json({ error: "You can't remove your own account." }, { status: 400 });
    if (user.role !== 'THERAPIST' || !therapist) {
      return NextResponse.json({ error: 'Only professional (therapist) accounts can be removed here.' }, { status: 400 });
    }
    if (!confirmEmail || confirmEmail !== (user.email ?? '').toLowerCase()) {
      return NextResponse.json({ error: "The email you typed doesn't match this account." }, { status: 400 });
    }

    // 1. Firebase sign-in account
    try {
      await adminAuth().deleteUser(user.id);
    } catch (e: any) {
      if (e?.code !== 'auth/user-not-found') {
        return NextResponse.json({ error: "We couldn't delete this professional's sign-in account, so nothing was removed. Please try again." }, { status: 502 });
      }
    }

    // 2. Everything else, in both databases and Firestore.
    const result = await deleteAccount(user.id);
    const { warnings = [], ...counts } = result ?? {};
    invalidateAccountStatus(user.id);

    await audit(request, auth, 'user.delete', { type: 'User', id: user.id }, {
      before: {
        email: user.email,
        name: `${therapist.firstName} ${therapist.lastName}`.trim(),
        role: user.role,
        ...counts,
      },
      after: warnings.length ? { firestoreWarnings: warnings.slice(0, 20) } : null,
    });

    return NextResponse.json({ removed: true, ...counts, warnings });
  } catch (error: any) {
    return errorResponse(error, 'Admin user DELETE error', "We couldn't delete this user. Please try again.");
  }
}
