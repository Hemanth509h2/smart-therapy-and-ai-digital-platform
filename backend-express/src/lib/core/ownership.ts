import { prisma } from '@/lib/core/db';
import { therapistIdForUser } from '@/lib/core/links';
import { getLobbyEntry } from '@/lib/sessions/lobby';

/**
 * Returns the client if it belongs to this therapist, otherwise null.
 *
 * A client belongs to a therapist when the therapist added it (or it was
 * created from the therapist's invite), i.e. ProfileClient.therapistId. Old
 * clients created before that column existed have no therapistId; they count
 * only if this therapist already has a session with them.
 *
 * Use it before creating anything that references a client id taken from the
 * request (sessions, bookings, progress data), so a therapist can never attach
 * records to, or read through, someone else's client.
 */
export async function clientOfTherapist(therapistId: string, clientId: unknown) {
  if (typeof clientId !== 'string' || !clientId) return null;
  const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
  if (!client) return null;
  if (client.therapistId) return client.therapistId === therapistId ? client : null;
  const linked = await prisma.session.findFirst({
    where: { therapistId, clientId },
    select: { id: true },
  });
  return linked ? client : null;
}

export type SessionRole = 'therapist' | 'client' | 'guest';

/**
 * How the signed-in uid relates to a session, or null when it has no access:
 *   therapist  the session's own therapist
 *   client     the client's own user account
 *   guest      a uid that came through this session's invite link and was
 *              admitted from the waiting room (see lib/sessions/lobby.ts)
 */
export async function sessionRoleFor(
  uid: string,
  session: { id: string; therapistId: string; clientId: string }
): Promise<SessionRole | null> {
  const [therapistId, client] = await Promise.all([
    therapistIdForUser(uid),
    prisma.profileClient.findUnique({ where: { id: session.clientId }, select: { userId: true } }),
  ]);
  if (therapistId && therapistId === session.therapistId) return 'therapist';
  if (client?.userId === uid) return 'client';
  const entry = await getLobbyEntry(session.id, uid).catch(() => null);
  if (entry?.status === 'admitted') return 'guest';
  return null;
}
