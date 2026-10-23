import { randomUUID } from 'crypto';
import type { Session } from '@prisma/client';
import { appDb, prisma } from '@/lib/core/db';
import { appUrl } from '@/lib/core/app-url';
import { getSetting } from '@/lib/core/settings';
import { sendSessionScheduledMessage, sendWhatsAppInvite } from '@/lib/messaging/whatsapp-bot';

// WhatsApp rules for sessions:
//   - booking a session      -> date/time confirmation, NO link
//   - starting a session     -> the patient join link, sent once per session
//                               (webhook first, WhatsApp Cloud API on failure)

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

interface LinkWebhookPayload {
  event: 'session.link.generated';
  sessionId: string;
  phoneNumber: string;
  patientName: string;
  therapistName: string;
  link: string;
}

/** Step 1 of the link flow: POST the freshly generated link to the configured
 *  webhook. Throws on a network error, timeout or non-2xx so the caller can
 *  fall back to the official WhatsApp Cloud API. */
async function postLinkWebhook(payload: LinkWebhookPayload): Promise<{ id?: string }> {
  const url = process.env.WHATSAPP_LINK_WEBHOOK_URL;
  if (!url) throw new Error('WHATSAPP_LINK_WEBHOOK_URL not set');

  const secret = process.env.WHATSAPP_LINK_WEBHOOK_SECRET;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Link webhook responded ${response.status}`);

  const body = (await response.json().catch(() => ({}))) as { id?: unknown };
  return { id: typeof body.id === 'string' ? body.id : undefined };
}

type MessageType = 'SESSION_SCHEDULED' | 'SESSION_STARTED';

export const WHATSAPP_OFF = 'WhatsApp messaging is turned off by an admin.';

const fullName = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}`.trim() : undefined);

async function therapistName(therapistId: string | null | undefined) {
  if (!therapistId) return undefined;
  return fullName(await appDb.profileTherapist.findUnique({ where: { id: therapistId }, select: { firstName: true, lastName: true } }));
}

// Records the attempt in whatsAppMessage, sends, and marks SENT/FAILED.
// Best-effort: never throws, so a WhatsApp failure can't break the caller.
async function deliver(
  sessionId: string,
  clientId: string,
  phoneNumber: string,
  messageType: MessageType,
  generatedLink: string,
  send: () => Promise<{ id?: string }>
) {
  const now = new Date();
  try {
    // Admin kill switch: record the message as SKIPPED instead of sending.
    if (!(await getSetting('features.whatsapp'))) {
      await prisma.whatsAppMessage.upsert({
        where: { sessionId_messageType: { sessionId, messageType } },
        create: { id: randomUUID(), sessionId, clientId, phoneNumber, generatedLink, messageType, status: 'SKIPPED', errorMessage: WHATSAPP_OFF, updatedAt: now },
        update: { phoneNumber, generatedLink, status: 'SKIPPED', errorMessage: WHATSAPP_OFF, updatedAt: now },
      });
      return;
    }
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
        providerMessageId: message.id || null, // bot may return no id; "" would collide on the unique column
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
    include: { client: true },
  });
  const phone = session?.client.phoneNumber;
  if (!session || !phone) return;
  const therapist = await therapistName(session.therapistId);

  await deliver(session.id, session.clientId, phone, 'SESSION_SCHEDULED', '', () =>
    sendSessionScheduledMessage({
      to: phone,
      patientName: session.client.firstName,
      scheduledAt: session.scheduledAt,
      therapistName: therapist,
    })
  );
}

/** Patient join link, sent once per session (skipped if already sent). */
export async function sendSessionLinkWhatsApp(sessionId: string, request: Request) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { client: true },
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

  const therapist = await therapistName(session.therapistId);

  await deliver(session.id, session.clientId, phone, 'SESSION_STARTED', link, async () => {
    // Webhook first; only if it fails do we send via the WhatsApp Cloud API.
    if (process.env.WHATSAPP_LINK_WEBHOOK_URL) {
      try {
        return await postLinkWebhook({
          event: 'session.link.generated',
          sessionId: session.id,
          phoneNumber: phone,
          patientName: session.client.firstName,
          therapistName: therapist ?? '',
          link,
        });
      } catch (error: any) {
        console.error('Link webhook failed, falling back to WhatsApp Cloud API:', error?.message || error);
      }
    }
    return sendWhatsAppInvite({
      to: phone,
      patientName: session.client.firstName,
      inviteLink: link,
      therapistName: therapist,
    });
  });
}

/** Admin retry of one logged message (any type), re-using its stored link.
 *  Returns the updated row; a send failure is recorded on the row as FAILED. */
export async function retryWhatsAppMessage(id: string) {
  const msg = await prisma.whatsAppMessage.findUniqueOrThrow({
    where: { id },
    include: {
      invite: true,
      session: { include: { client: true } },
    },
  });

  let phone = msg.phoneNumber;
  let send: () => Promise<{ id: string }>;
  if (msg.messageType === 'CLIENT_INVITE') {
    if (!msg.invite) throw new Error('The invite for this message no longer exists.');
    const invite = msg.invite;
    phone = invite.phoneNumber || phone;
    const therapist = await therapistName(invite.therapistId);
    send = () => sendWhatsAppInvite({ to: phone, patientName: invite.firstName, inviteLink: msg.generatedLink, therapistName: therapist });
  } else {
    if (!msg.session) throw new Error('The session for this message no longer exists.');
    const session = msg.session;
    phone = session.client.phoneNumber || phone;
    const therapist = await therapistName(session.therapistId);
    send =
      msg.messageType === 'SESSION_SCHEDULED'
        ? () => sendSessionScheduledMessage({ to: phone, patientName: session.client.firstName, scheduledAt: session.scheduledAt, therapistName: therapist })
        : () => sendWhatsAppInvite({ to: phone, patientName: session.client.firstName, inviteLink: msg.generatedLink, therapistName: therapist });
  }

  const now = new Date();
  await prisma.whatsAppMessage.update({
    where: { id },
    data: { phoneNumber: phone, status: 'SENDING', attempts: { increment: 1 }, lastAttemptAt: now, errorCode: null, errorMessage: null, updatedAt: now },
  });
  try {
    const sent = await send();
    return await prisma.whatsAppMessage.update({
      where: { id },
      data: { status: 'SENT', providerMessageId: sent.id || null, sentAt: new Date(), providerStatusAt: new Date(), updatedAt: new Date() },
    });
  } catch (error: any) {
    return prisma.whatsAppMessage.update({
      where: { id },
      data: { status: 'FAILED', errorMessage: error?.message || 'WhatsApp send failed', updatedAt: new Date() },
    });
  }
}
