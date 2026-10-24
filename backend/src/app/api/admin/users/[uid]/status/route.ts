import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAdmin, requireRecentLogin, invalidateAccountStatus } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/users/[uid]/status — suspend or reactivate any account
// (therapist or client) by Firebase uid. Suspended users are rejected by
// requireAuth on every API call.
// Body: { action: 'suspend' | 'reactivate', reason?: string } (reason required to suspend)
export async function PATCH(request: Request, { params }: { params: { uid: string } }) {
  try {
    const auth = await requireAdmin(request, 'people.write');
    if (!auth.ok) return auth.response;
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return stepUp;

    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (action !== 'suspend' && action !== 'reactivate') {
      return NextResponse.json({ error: "We couldn't tell whether to suspend or reactivate this account. Refresh the page and try again." }, { status: 400 });
    }
    if (action === 'suspend' && !reason) {
      return NextResponse.json({ error: 'Enter a reason for suspending this account.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: params.uid },
      select: { id: true, email: true, role: true, status: true, suspendedAt: true, suspendReason: true },
    });
    if (!user) return NextResponse.json({ error: "We couldn't find this account. It may have been removed." }, { status: 404 });
    if (action === 'suspend') {
      if (user.id === auth.uid) return NextResponse.json({ error: "You can't suspend your own account." }, { status: 400 });
      if (user.role === 'ADMIN') {
        return NextResponse.json({ error: 'Admin accounts cannot be suspended here. Remove their admin access first.' }, { status: 400 });
      }
    }

    const before = { status: user.status, suspendedAt: user.suspendedAt, suspendReason: user.suspendReason };
    const updated = await prisma.user.update({
      where: { id: user.id },
      data:
        action === 'suspend'
          ? { status: 'SUSPENDED', suspendedAt: new Date(), suspendReason: reason }
          : { status: 'ACTIVE', suspendedAt: null, suspendReason: null },
      select: { id: true, status: true, suspendedAt: true, suspendReason: true },
    });
    invalidateAccountStatus(user.id);

    await audit(request, auth, action === 'suspend' ? 'user.suspend' : 'user.reactivate', { type: 'User', id: user.id }, {
      before: { ...before, email: user.email, role: user.role },
      after: { status: updated.status, suspendedAt: updated.suspendedAt, suspendReason: updated.suspendReason },
    });

    return NextResponse.json({ user: updated });
  } catch (error: any) {
    return errorResponse(error, 'Admin user status PATCH error', "We couldn't change this account's status. Please try again.");
  }
}
