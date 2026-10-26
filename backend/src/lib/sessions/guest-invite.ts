import { randomUUID } from 'crypto';
import type { Session } from '@prisma/client';
import { prisma } from '@/lib/core/db';

/** Get (or create) the patient join invite for a session. The invite is
 *  CLAIMED with claimedClientId = session.clientId, so opening the link lands
 *  the patient in this session's room. */
export async function getOrCreateGuestInvite(session: Session) {
  const existing = await prisma.invite.findFirst({
    where: {
      therapistId: session.therapistId,
      claimedClientId: session.clientId,
      status: 'CLAIMED',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;

  const client = await prisma.profileClient.findUniqueOrThrow({ where: { id: session.clientId } });
  return prisma.invite.create({
    data: {
      token: randomUUID(),
      therapistId: session.therapistId,
      firstName: client.firstName,
      lastName: client.lastName,
      diagnosis: client.diagnosis,
      phoneNumber: client.phoneNumber,
      scheduledAt: session.scheduledAt,
      status: 'CLAIMED',
      claimedClientId: client.id,
    },
  });
}
