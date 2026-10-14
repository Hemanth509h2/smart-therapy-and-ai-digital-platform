import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin, requireRecentLogin, invalidateAccountStatus } from '@/lib/apiAuth';
import { audit } from '@/lib/audit';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

// DELETE /api/admin/users/[uid] — permanently remove a professional (therapist) and all their data.
// Super admins only, recent sign-in required, and the body must repeat the account email:
//   { confirmEmail: "therapist@example.com" }
//
// Removes, in this order:
//   1. the Firebase sign-in account (so they can't sign in mid-way)
//   2. Firestore session data: sessions/{id} (transcript + rawSessionLog) and liveSessions/{id}
//   3. Postgres, in one transaction: risk flags, bookings, sessions (cascades reports, notes,
//      session messages), unlinks their clients, uploaded document chunks, then the user
//      (cascades the therapist profile, invites, subscriptions, usage, progress records)
// Client accounts are kept; they are only unlinked from this therapist.
export async function DELETE(request: Request, { params }: { params: { uid: string } }) {
  try {
    const auth = await requireAdmin(request, 'admins.manage');
    if (!auth.ok) return auth.response;
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return stepUp;

    const body = await request.json().catch(() => ({}));
    const confirmEmail = typeof body?.confirmEmail === 'string' ? body.confirmEmail.trim().toLowerCase() : '';

    const user = await prisma.user.findUnique({
      where: { id: params.uid },
      select: {
        id: true, email: true, role: true,
        therapist: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.id === auth.uid) return NextResponse.json({ error: "You can't remove your own account." }, { status: 400 });
    if (user.role !== 'THERAPIST' || !user.therapist) {
      return NextResponse.json({ error: 'Only professional (therapist) accounts can be removed here.' }, { status: 400 });
    }
    if (!confirmEmail || confirmEmail !== (user.email ?? '').toLowerCase()) {
      return NextResponse.json({ error: "The email you typed doesn't match this account." }, { status: 400 });
    }

    const therapistId = user.therapist.id;
    const sessions = await prisma.session.findMany({ where: { therapistId }, select: { id: true } });
    const sessionIds = sessions.map((s) => s.id);
    const counts = {
      sessions: sessionIds.length,
      clients: await prisma.profileClient.count({ where: { therapistId } }),
      bookings: await prisma.booking.count({ where: { therapistId } }),
    };

    // 1. Firebase sign-in account
    try {
      await adminAuth().deleteUser(user.id);
    } catch (e: any) {
      if (e?.code !== 'auth/user-not-found') {
        return NextResponse.json({ error: `Couldn't delete the sign-in account: ${e?.message || e}` }, { status: 502 });
      }
    }

    // 2. Firestore session data (transcripts, session diary, live-room docs)
    const warnings: string[] = [];
    if (sessionIds.length) {
      const db = adminDb();
      for (const id of sessionIds) {
        try {
          await db.recursiveDelete(db.collection('sessions').doc(id));
          await db.recursiveDelete(db.collection('liveSessions').doc(id));
        } catch (e: any) {
          warnings.push(`session ${id}: ${e?.message || e}`);
        }
      }
    }

    // 3. Postgres
    await prisma.$transaction(async (tx) => {
      await tx.riskFlag.deleteMany({ where: { OR: [{ therapistId }, { sessionId: { in: sessionIds } }] } });
      await tx.booking.deleteMany({ where: { therapistId } });
      await tx.session.deleteMany({ where: { therapistId } });
      await tx.profileClient.updateMany({ where: { therapistId }, data: { therapistId: null } });
      await tx.supportTicket.updateMany({ where: { userId: user.id }, data: { userId: null } });
      // Uploaded documents for AI search (pgvector). The table may not exist in every environment.
      const [chunks] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('public.document_chunks') IS NOT NULL AS ok`;
      if (chunks?.ok) {
        await tx.$executeRaw`DELETE FROM document_chunks WHERE therapist_id IN (${therapistId}, ${user.id})`;
      }
      await tx.user.delete({ where: { id: user.id } });
    }, { timeout: 30_000 });
    invalidateAccountStatus(user.id);

    await audit(request, auth, 'user.delete', { type: 'User', id: user.id }, {
      before: {
        email: user.email,
        name: `${user.therapist.firstName} ${user.therapist.lastName}`.trim(),
        role: user.role,
        ...counts,
      },
      after: warnings.length ? { firestoreWarnings: warnings.slice(0, 20) } : null,
    });

    return NextResponse.json({ removed: true, ...counts, warnings });
  } catch (error: any) {
    console.error('Admin user DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
