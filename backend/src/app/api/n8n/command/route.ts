import { NextResponse } from 'next/server';
import { commandReply, findTherapistByPhone, phoneForms } from '@/lib/n8n-brief';

export const dynamic = 'force-dynamic';

// POST /api/n8n/command
// Body: { from: "<therapist's WhatsApp number>", text: "CLIENTS" | "WEEK" | "PENDING" | "SESSION <id>" | "HELP" }
// Returns the reply:
//   { to, type: 'text', body, therapistId }
// Only replies about the therapist that owns the sending number.
export async function POST(request: Request) {
  try {
    const { from, text } = (await request.json().catch(() => null)) || {};
    if (!from || typeof from !== 'string') {
      return NextResponse.json({ error: 'from (sender phone number) is required' }, { status: 400 });
    }
    const phone = phoneForms(from);
    if (!phone) {
      return NextResponse.json({ error: 'from is not a valid phone number' }, { status: 400 });
    }

    const therapist = await findTherapistByPhone(from);
    if (!therapist) {
      return NextResponse.json({
        to: phone.e164,
        type: 'text',
        body: "This number isn't linked to a STAAD therapist account. Add it to your profile to use the assistant.",
        therapistId: null,
      });
    }

    return NextResponse.json({
      to: phone.e164,
      type: 'text',
      body: await commandReply(therapist, typeof text === 'string' ? text : ''),
      therapistId: therapist.id,
    });
  } catch (error: any) {
    console.error('[n8n/command]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
