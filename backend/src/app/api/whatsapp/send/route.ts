import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { sendViaBot } from '@/lib/whatsapp-bot';
import { normalizeWhatsAppNumber } from '@/lib/whatsapp-cloud-api';
import { requireServiceKey } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

// POST /api/whatsapp/send
// Generic WhatsApp send endpoint for n8n automation. Requires the x-api-key
// header (N8N_API_KEY) — without it anyone could message from our number.
// Body: { to, type: 'text' | 'interactive', body?, interactive?, therapistId? }
// If therapistId provided, logs to WhatsAppMessage table for tracking
export async function POST(request: Request) {
  const auth = requireServiceKey(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    const { to, type, body: textBody, interactive, therapistId, sessionId, clientId, messageType } = body || {};

    if (!to) {
      return NextResponse.json({ error: 'to (phone number) is required' }, { status: 400 });
    }
    if (!type || !['text', 'interactive'].includes(type)) {
      return NextResponse.json({ error: 'type must be "text" or "interactive"' }, { status: 400 });
    }
    if (type === 'text' && !textBody) {
      return NextResponse.json({ error: 'body is required for text messages' }, { status: 400 });
    }
    if (type === 'interactive' && !interactive) {
      return NextResponse.json({ error: 'interactive object is required for interactive messages' }, { status: 400 });
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
        // For interactive, we need to adapt sendViaBot or call bot directly
        const url = process.env.WHATSAPP_BOT_URL;
        const secret = process.env.WHATSAPP_BOT_SECRET;
        if (!url || !secret) {
          throw new Error('WhatsApp bot not configured');
        }
        const res = await fetch(`${url.replace(/\/+$/, '')}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': secret },
          body: JSON.stringify({ to: normalizedTo, interactive }),
          signal: AbortSignal.timeout(15_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `WhatsApp bot responded ${res.status}`);
        result = { id: data.id ?? '', status: 'sent', to: normalizedTo };
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}