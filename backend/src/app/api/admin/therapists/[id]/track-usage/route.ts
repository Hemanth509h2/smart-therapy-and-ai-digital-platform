import { NextResponse } from 'next/server';
import { appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { errorResponse } from '@/lib/http/apiError';

// PATCH /api/admin/therapists/[id]/track-usage — turn usage tracking on or off.
// Body: { trackUsage: boolean }. Off: no usage events are stored for this
// therapist and the Usage & cost page leaves them out. Earlier events are kept.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'people.write');
    if (!auth.ok) return auth.response;
    const { trackUsage } = await request.json();
    if (typeof trackUsage !== 'boolean') {
      return NextResponse.json({ error: 'Choose whether to track this professional’s usage.' }, { status: 400 });
    }

    const therapist = await appDb.profileTherapist.findUnique({ where: { id: params.id }, select: { trackUsage: true } });
    if (!therapist) {
      return NextResponse.json({ error: "We couldn't find this professional. Their account may have been removed." }, { status: 404 });
    }

    const updated = await appDb.profileTherapist.update({
      where: { id: params.id },
      data: { trackUsage },
      select: { id: true, trackUsage: true },
    });

    await audit(request, auth, 'therapist.trackUsage.update', { type: 'ProfileTherapist', id: params.id }, {
      before: { trackUsage: therapist.trackUsage },
      after: { trackUsage },
    });

    return NextResponse.json({ therapist: updated });
  } catch (error: any) {
    return errorResponse(error, 'Therapist track-usage PATCH error');
  }
}
