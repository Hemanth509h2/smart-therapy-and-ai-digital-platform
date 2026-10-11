import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { audit } from '@/lib/audit';
import { getSetting } from '@/lib/settings';
import { retryWhatsAppMessage, WHATSAPP_OFF } from '@/lib/session-whatsapp';

export const dynamic = 'force-dynamic';

// POST /api/admin/messages/:id/retry — resend a FAILED WhatsApp message.
// Returns the updated row (status SENT, or FAILED with the new error).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'support');
    if (!auth.ok) return auth.response;

    if (!(await getSetting('features.whatsapp'))) {
      return NextResponse.json({ error: WHATSAPP_OFF }, { status: 409 });
    }

    const before = await prisma.whatsAppMessage.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, attempts: true, errorMessage: true, messageType: true, inviteId: true, sessionId: true },
    });
    if (!before) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    if (before.status !== 'FAILED') {
      return NextResponse.json({ error: `Only failed messages can be retried (this one is ${before.status}).` }, { status: 409 });
    }

    if (before.messageType === 'CLIENT_INVITE' ? !before.inviteId : !before.sessionId) {
      return NextResponse.json({ error: 'The invite or session for this message no longer exists.' }, { status: 409 });
    }

    const message = await retryWhatsAppMessage(params.id);
    await audit(request, auth, 'whatsapp.retry', { type: 'WhatsAppMessage', id: params.id }, {
      before: { status: before.status, attempts: before.attempts, errorMessage: before.errorMessage },
      after: { status: message.status, attempts: message.attempts, errorMessage: message.errorMessage },
    });
    return NextResponse.json({ message, ok: message.status === 'SENT' });
  } catch (e: any) {
    console.error('POST /api/admin/messages/[id]/retry failed:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
