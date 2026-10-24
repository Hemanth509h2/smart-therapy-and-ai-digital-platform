import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/core/db';
import { sendViaBot } from '@/lib/messaging/whatsapp-bot';
import { normalizeWhatsAppNumber, sendCloudApiInteractive } from '@/lib/messaging/whatsapp-cloud-api';
import { requireAutomationOrTherapist } from '@/lib/automation/auth';
import { notYourProfile } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// POST /api/whatsapp/send
// Generic WhatsApp send endpoint. Caller: a logged-in therapist, or a service
// sending x-api-key = AUTOMATION_API_KEY.
// Body: { to, type: 'text' | 'interactive', body?, interactive?, therapistId? }
// If therapistId provided, logs to WhatsAppMessage table for tracking
export async function POST(request: Request) {
  try {
    const caller = await requireAutomationOrTherapist(request);
    if (!caller.ok) return caller.response;

    const body = await request.json().catch(() => null);
    const { to, type, body: textBody, interactive, therapistId, sessionId, clientId, messageType } = body || {};

    // A therapist can only log sends against their own profile.
    if (caller.kind === 'therapist' && therapistId && therapistId !== caller.therapist.id) {
      return notYourProfile('this therapist profile');
    }

    if (!to) {
      return NextResponse.json({ error: 'Enter a phone number to send the WhatsApp message to.' }, { status: 400 });
    }
    if (!type || !['text', 'interactive'].includes(type)) {
      return NextResponse.json({ error: "We couldn't tell what kind of WhatsApp message to send. Refresh the page and try again." }, { status: 400 });
    }
    if (type === 'text' && !textBody) {
      return NextResponse.json({ error: 'Type a message before sending.' }, { status: 400 });
    }
    if (type === 'interactive' && !interactive) {
      return NextResponse.json({ error: "This message is missing its buttons or options. Refresh the page and try again." }, { status: 400 });
    }

    const normalizedTo = normalizeWhatsAppNumber(to);
    const now = new Date();

    // If therapistId provided, create tracking record
    let deliveryId: string | null = null;
    if (therapistId) {
      deliveryId = randomUUID();
      await prisma.whatsAppMessage.create({
        data: {
          id: deliveryId,
          therapistId,
          sessionId: sessionId || null,
          clientId: clientId || null,
          phoneNumber: normalizedTo,
          generatedLink: '',
          messageType: messageType || 'SESSION_SCHEDULED',
          status: 'SENDING',
          attempts: 1,
          lastAttemptAt: now,
          updatedAt: now,
        },
      });
    }

    try {
      let result;
      if (type === 'text') {
        result = await sendViaBot(normalizedTo, textBody);
      } else {
        result = await sendCloudApiInteractive(normalizedTo, interactive);
      }

      // Update tracking record
      if (deliveryId) {
        await prisma.whatsAppMessage.update({
          where: { id: deliveryId },
          data: {
            status: 'SENT',
            providerMessageId: result.id,
            sentAt: new Date(),
            providerStatusAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      return NextResponse.json({ success: true, messageId: result.id });
    } catch (error: any) {
      if (deliveryId) {
        await prisma.whatsAppMessage.update({
          where: { id: deliveryId },
          data: { status: 'FAILED', errorMessage: error?.message || 'WhatsApp send failed', updatedAt: new Date() },
        }).catch(() => {});
      }
      throw error;
    }
  } catch (error: any) {
    console.error('WhatsApp send error:', error);
    return NextResponse.json({ error: "We couldn't send the WhatsApp message. Please try again." }, { status: 500 });
  }
}