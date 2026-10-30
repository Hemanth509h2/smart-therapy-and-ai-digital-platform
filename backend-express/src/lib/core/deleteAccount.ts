// Permanently removes a user and everything that belongs to them, in both
// databases and Firestore, so no orphan rows are left behind.
//
// For a therapist that includes their clients: the placeholder accounts they
// added (`client:` ids) and the invite guests (`guest:` ids) who only ever
// saw this therapist. Clients with their own sign-in are unlinked, not removed.
//
// Kept on purpose: payments (financial records) and the audit log.
//
// The Firebase sign-in account is not touched; callers delete it themselves.
import { prisma, appDb } from '@/lib/core/db';
import { therapistForUser } from '@/lib/core/links';
import { adminDb } from '@/lib/core/firebaseAdmin';

const isPlaceholder = (userId: string) => userId.startsWith('client:') || userId.startsWith('guest:');

export async function deleteAccount(uid: string) {
  const [user, therapist] = await Promise.all([
    prisma.user.findUnique({ where: { id: uid }, select: { id: true, client: { select: { id: true } } } }),
    therapistForUser(uid, { id: true }),
  ]);
  if (!user && !therapist) return null;
  const therapistId = therapist?.id ?? null;

  // The therapist's clients: linked directly, seen in a session, or joined from an invite.
  let removedClients: { id: string; userId: string }[] = [];
  if (therapistId) {
    const [sessionClients, inviteClients] = await Promise.all([
      prisma.session.findMany({ where: { therapistId }, select: { clientId: true }, distinct: ['clientId'] }),
      prisma.invite.findMany({ where: { therapistId, claimedClientId: { not: null } }, select: { claimedClientId: true } }),
    ]);
    const ids = [...sessionClients.map((s) => s.clientId), ...inviteClients.map((i) => i.claimedClientId!)];
    const candidates = await prisma.profileClient.findMany({
      where: { OR: [{ therapistId }, { id: { in: ids } }] },
      select: { id: true, userId: true },
    });
    // A placeholder that also had sessions with someone else stays.
    const shared = new Set(
      (
        await prisma.session.findMany({
          where: { clientId: { in: candidates.map((c) => c.id) }, therapistId: { not: therapistId } },
          select: { clientId: true },
          distinct: ['clientId'],
        })
      ).map((s) => s.clientId)
    );
    removedClients = candidates.filter((c) => isPlaceholder(c.userId) && !shared.has(c.id));
  }
  const clientIds = [...removedClients.map((c) => c.id), ...(user?.client ? [user.client.id] : [])];

  const sessions = await prisma.session.findMany({
    where: { OR: [...(therapistId ? [{ therapistId }] : []), { clientId: { in: clientIds } }] },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  const counts = {
    sessions: sessionIds.length,
    clients: removedClients.length,
    bookings: await prisma.booking.count({
      where: { OR: [...(therapistId ? [{ therapistId }] : []), { clientId: { in: clientIds } }] },
    }),
  };

  // 1. Firestore session data (transcripts, session diary, live-room docs).
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

  // 2. HIPAA database in one transaction. The app database rows go last,
  // inside it, so if they fail the HIPAA deletes roll back instead of leaving
  // a profile whose user is gone.
  await prisma.$transaction(async (tx) => {
    const byTherapist = therapistId ? [{ therapistId }] : [];
    await tx.riskFlag.deleteMany({ where: { OR: [...byTherapist, { sessionId: { in: sessionIds } }] } });
    await tx.booking.deleteMany({ where: { OR: [...byTherapist, { clientId: { in: clientIds } }] } });
    // Cascades session reports and therapist notes.
    await tx.session.deleteMany({ where: { id: { in: sessionIds } } });
    await tx.whatsAppMessage.deleteMany({ where: { OR: [...byTherapist, { clientId: { in: clientIds } }] } });
    if (therapistId) {
      await tx.invite.deleteMany({ where: { therapistId } });
      await tx.therapistNote.deleteMany({ where: { therapistId } });
      await tx.progressNote.deleteMany({ where: { therapistId } });
      await tx.progressReport.deleteMany({ where: { therapistId } });
      await tx.progressMetric.deleteMany({ where: { therapistId } });
      await tx.profileClient.updateMany({ where: { therapistId }, data: { therapistId: null } });
      // Uploaded documents for AI search (pgvector). The table may not exist in every environment.
      const [chunks] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('public.document_chunks') IS NOT NULL AS ok`;
      if (chunks?.ok) {
        await tx.$executeRaw`DELETE FROM document_chunks WHERE therapist_id IN (${therapistId}, ${uid})`;
      }
    }
    await tx.supportTicket.deleteMany({ where: { userId: uid } });
    // Deleting a User cascades its client profile and that client's progress records.
    await tx.user.deleteMany({ where: { id: { in: [uid, ...removedClients.map((c) => c.userId)] } } });

    // Cascades subscriptions, requests, usage and personal coupons.
    await appDb.$transaction([
      appDb.profileTherapist.deleteMany({ where: { userId: uid } }),
      appDb.profileAdmin.deleteMany({ where: { userId: uid } }),
    ]);
  }, { timeout: 60_000 });

  return { ...counts, warnings };
}
