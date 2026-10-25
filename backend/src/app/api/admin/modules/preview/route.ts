import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/http/apiAuth';
import { provisionPreviewRoom } from '@/lib/sessions/session-provisioning';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// POST /api/admin/modules/preview — open the admin's private "Try module"
// room. Modules keep their state in Firestore liveSessions/{id}, which only
// the uids in its allowedUids may use, so the room is provisioned server-side
// like a real session. No session, client or plan is involved.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request, 'content');
    if (!auth.ok) return auth.response;

    const sessionId = await provisionPreviewRoom(auth.uid);
    return NextResponse.json({ sessionId });
  } catch (error: any) {
    return errorResponse(error, 'admin/modules/preview POST');
  }
}
