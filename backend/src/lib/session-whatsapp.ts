import { randomUUID } from 'crypto';
import type { Session } from '@prisma/client';
import { prisma } from '@/lib/db';
import { appUrl } from '@/lib/app-url';
import { sendSessionScheduledMessage, sendWhatsAppInvite } from '@/lib/whatsapp-bot';

// WhatsApp rules for sessions:
//   - booking a session      -> date/time confirmation, NO link
//   - starting a session     -> the patient join link, sent once per session

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

type MessageType = 'SESSION_SCHEDULED' | 'SESSION_STARTED';

// Records the attempt in whatsAppMessage, sends, and marks SENT/FAILED.
// Best-effort: never throws, so a WhatsApp failure can't break the caller.
async function deliver(
  sessionId: string,
  clientId: string,
  phoneNumber: string,
  messageType: MessageType,
  generatedLink: string,
  send: () => Promise<{ id: string }>
) {
  const now = new Date();
  try {
    const delivery = await prisma.whatsAppMessage.upsert({
      where: { sessionId_messageType: { sessionId, messageType } },
      create: {
        id: randomUUID(),
        sessionId,
        clientId,
        phoneNumber,
        generatedLink,
        messageType,
        status: 'SENDING',
        attempts: 1,
        lastAttemptAt: now,
        updatedAt: now,
      },
      update: {
        phoneNumber,
        generatedLink,
        status: 'SENDING',
        attempts: { increment: 1 },
        lastAttemptAt: now,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      },
    });
    const message = await send();
    await prisma.whatsAppMessage.update({
      where: { id: delivery.id },
      data: {
        status: 'SENT',
        providerMessageId: message.id,
        sentAt: new Date(),
        providerStatusAt: new Date(),
        updatedAt: new Date(),
      },
    });
  } catch (error: any) {
    console.error(`${messageType} WhatsApp notification failed:`, error);
    await prisma.whatsAppMessage
      .updateMany({
        where: { sessionId, messageType },
        data: { status: 'FAILED', errorMessage: error?.message || 'WhatsApp send failed', updatedAt: new Date() },
      })
      .catch(() => {});
  }
}

/** Booking confirmation: date and time only, no link. */
export async function sendSessionBookedWhatsApp(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { client: true, therapist: true },
  });
  const phone = session?.client.phoneNumber;
  if (!session || !phone) return;

  await deliver(session.id, session.clientId, phone, 'SESSION_SCHEDULED', '', () =>
    sendSessionScheduledMessage({
      to: phone,
      patientName: session.client.firstName,
      scheduledAt: session.scheduledAt,
      therapistName: `${session.therapist.firstName} ${session.therapist.lastName}`.trim(),
    })
  );
}

/** Patient join link, sent once per session (skipped if already sent). */
export async function sendSessionLinkWhatsApp(sessionId: string, request: Request) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { client: true, therapist: true },
  });
  const phone = session?.client.phoneNumber;
  if (!session || !phone) return;

  const alreadySent = await prisma.whatsAppMessage.findFirst({
    where: { sessionId, messageType: 'SESSION_STARTED', status: 'SENT' },
    select: { id: true },
  });
  if (alreadySent) return;

  const invite = await getOrCreateGuestInvite(session);
  const link = `${appUrl(request)}/join/${invite.token}`;

  await deliver(session.id, session.clientId, phone, 'SESSION_STARTED', link, () =>
    sendWhatsAppInvite({
      to: phone,
      patientName: session.client.firstName,
      inviteLink: link,
      therapistName: `${session.therapist.firstName} ${session.therapist.lastName}`.trim(),
    })
  );
}
