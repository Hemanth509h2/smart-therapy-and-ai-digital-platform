import type { PrismaClient } from '@prisma/client';

/**
 * Shared therapist→client ownership check. A therapist may act on a client they
 * added directly (ProfileClient.therapistId) or one linked to them by at least
 * one session — the same rule GET /api/clients applies.
 *
 * Returns null both when the client doesn't exist and when it isn't theirs, so
 * callers can answer with one indistinguishable 404.
 */
export async function findAccessibleClient(
  prisma: Pick<PrismaClient, 'profileClient'>,
  clientId: string,
  therapistId: string
) {
  return prisma.profileClient.findFirst({
    where: {
      id: clientId,
      OR: [{ therapistId }, { sessions: { some: { therapistId } } }],
    },
    select: { id: true, firstName: true, lastName: true },
  });
}
