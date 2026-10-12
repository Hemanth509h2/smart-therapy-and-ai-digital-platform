import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { buildMorningBrief, phoneForms } from '@/lib/n8n-brief';

export const dynamic = 'force-dynamic';

// GET /api/n8n/morning-brief
// One ready-to-send WhatsApp message per therapist with a phone number:
//   { items: [{ to, type: 'text', body, therapistId, therapistName }], skipped }
// In n8n: HTTP Request → Split Out `items` → POST each to /api/whatsapp/send.
// Therapists without a (valid) phone number are counted in `skipped`.
export async function GET(request: Request) {
  try {
    const therapists = await prisma.profileTherapist.findMany({
      where: { phoneNumber: { not: null } },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    });
    const total = await prisma.profileTherapist.count();

    const items = [];
    for (const t of therapists) {
      const phone = t.phoneNumber ? phoneForms(t.phoneNumber) : null;
      if (!phone) continue;
      items.push({
        to: phone.e164,
        type: 'text' as const,
        body: await buildMorningBrief(t),
        therapistId: t.id,
        therapistName: `${t.firstName} ${t.lastName}`.trim(),
      });
    }

    return NextResponse.json({ items, skipped: total - items.length });
  } catch (error: any) {
    console.error('[n8n/morning-brief]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
