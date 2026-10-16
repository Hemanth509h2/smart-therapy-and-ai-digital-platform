import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { adminAuth } from '@/lib/core/firebaseAdmin';

export const dynamic = 'force-dynamic';

// Admin invite acceptance. Deliberately NOT under /api/admin: the person
// accepting isn't an admin yet. The 32-byte token is the secret; accepting
// additionally requires being signed in with the invited email.

function inviteState(invite: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) {
  if (invite.acceptedAt) return 'accepted';
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt.getTime() < Date.now()) return 'expired';
  return 'valid';
}

// GET /api/admin-invites/[token] — what the invite page shows. No sign-in needed.
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  try {
    const invite = await prisma.adminInvite.findUnique({ where: { token: params.token } });
    if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    const state = inviteState(invite);
    return NextResponse.json({
      email: invite.email,
      adminRole: invite.adminRole,
      expiresAt: invite.expiresAt,
      state,
      valid: state === 'valid',
    });
  } catch (error: any) {
    console.error('Admin invite GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/admin-invites/[token] — accept. Body: { firstName?, lastName? }
// The signed-in account's email must match the invite. An unverified email
// is accepted: holding a link that was sent to that address is the proof of
// ownership (the app has no email-verification step for password signups).
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const uid = auth.uid;
    if (uid.startsWith('guest:') || uid.startsWith('client:')) {
      return NextResponse.json({ error: 'Sign in with your own account to accept.' }, { status: 403 });
    }

    const invite = await prisma.adminInvite.findUnique({ where: { token: params.token } });
    if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    const state = inviteState(invite);
    if (state !== 'valid') {
      const why = { accepted: 'has already been used', revoked: 'was revoked', expired: 'has expired' }[state];
      return NextResponse.json({ error: `This invite ${why}.`, code: state }, { status: 410 });
    }

    const email = (auth.email || (await emailOf(uid)) || '').trim().toLowerCase();
    if (!email || email !== invite.email.toLowerCase()) {
      return NextResponse.json(
        { error: `This invite is for ${invite.email}. Sign in with that email to accept it.`, code: 'EMAIL_MISMATCH' },
        { status: 403 }
      );
    }

    const existing = await prisma.user.findUnique({
      where: { id: uid },
      include: { admin: true, therapist: true, client: true },
    });
    if (existing?.role === 'ADMIN') {
      return NextResponse.json({ error: 'You are already an admin.', code: 'ALREADY_ADMIN' }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const named = existing?.therapist ?? existing?.client;
    const firstName = String(body.firstName || named?.firstName || 'Admin').trim().slice(0, 80);
    const lastName = String(body.lastName ?? named?.lastName ?? '').trim().slice(0, 80);

    const accepted = await prisma.$transaction(async (tx) => {
      // Claim the invite first so two concurrent accepts can't both succeed.
      const claimed = await tx.adminInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) return false;
      await tx.user.upsert({
        where: { id: uid },
        update: { role: 'ADMIN' },
        create: { id: uid, email, role: 'ADMIN' },
      });
      await tx.profileAdmin.upsert({
        where: { userId: uid },
        update: { adminRole: invite.adminRole },
        create: { userId: uid, firstName, lastName, adminRole: invite.adminRole },
      });
      return true;
    });
    if (!accepted) {
      return NextResponse.json({ error: 'This invite is no longer valid.' }, { status: 410 });
    }

    // Mirror the role onto the Firebase custom claim, as the other role
    // writes do. Non-fatal (scripts/backfill-role-claims.mjs repairs it).
    try {
      const record = await adminAuth().getUser(uid);
      await adminAuth().setCustomUserClaims(uid, { ...(record.customClaims ?? {}), role: 'ADMIN' });
    } catch (e: any) {
      console.error('Failed to set role claim for', uid, e?.message);
    }

    await audit(request, { uid, email }, 'admin_invite.accept', { type: 'AdminInvite', id: invite.id }, {
      before: existing ? { role: existing.role } : null,
      after: { role: 'ADMIN', adminRole: invite.adminRole, invitedBy: invite.invitedBy },
    });

    return NextResponse.json({ success: true, adminRole: invite.adminRole });
  } catch (error: any) {
    console.error('Admin invite accept error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Fallback when the token carries no email (AUTH_DISABLED dev mode without
// x-dev-email): the account's Firebase record, then its DB row.
async function emailOf(uid: string) {
  try {
    return (await adminAuth().getUser(uid)).email ?? null;
  } catch {
    const user = await prisma.user.findUnique({ where: { id: uid }, select: { email: true } });
    return user?.email ?? null;
  }
}
