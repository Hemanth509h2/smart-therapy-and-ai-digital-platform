import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import nodemailer from 'nodemailer';
import type { AdminRole } from '@prisma/client';
import { prisma } from '@/lib/core/db';
import { requireAdmin, requireRecentLogin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { appUrl } from '@/lib/core/app-url';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES: AdminRole[] = ['SUPER_ADMIN', 'BILLING', 'SUPPORT', 'CONTENT'];
const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super admin',
  BILLING: 'Billing',
  SUPPORT: 'Support',
  CONTENT: 'Content',
};
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// POST /api/admin/invites — invite someone to become an admin. Body: { email, adminRole }
// The link is emailed when SMTP is configured, and always returned so it can
// be copied and sent another way. Accepting requires signing in with the
// invited email (see /api/admin-invites/[token]). Any earlier open invite for
// the same email is revoked, so only the newest link works.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request, 'admins.manage');
    if (!auth.ok) return auth.response;
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return stepUp;

    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const adminRole: AdminRole = body.adminRole ?? 'SUPPORT';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }
    if (!ADMIN_ROLES.includes(adminRole)) {
      return NextResponse.json({ error: 'Invalid adminRole' }, { status: 400 });
    }

    const existingAdmin = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, role: 'ADMIN' },
      select: { id: true },
    });
    if (existingAdmin) {
      return NextResponse.json({ error: 'That email already belongs to an admin.' }, { status: 409 });
    }

    const token = randomBytes(32).toString('hex');
    const invite = await prisma.$transaction(async (tx) => {
      await tx.adminInvite.updateMany({
        where: { email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.adminInvite.create({
        data: {
          email,
          adminRole,
          token,
          invitedBy: auth.uid,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
    });

    const link = `${appUrl(request)}/admin/invite/${token}`;
    const emailed = await sendInviteEmail(email, adminRole, link, auth.email);

    await audit(request, auth, 'admin_invite.create', { type: 'AdminInvite', id: invite.id }, {
      after: { email, adminRole, expiresAt: invite.expiresAt, emailed },
    });

    return NextResponse.json({
      success: true,
      invite: {
        id: invite.id,
        email,
        adminRole,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
      },
      link,
      emailed,
    });
  } catch (error: any) {
    console.error('Admin invite POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/admin/invites?id= — revoke an open invite.
export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin(request, 'admins.manage');
    if (!auth.ok) return auth.response;

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const invite = await prisma.adminInvite.findUnique({ where: { id } });
    if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    if (invite.acceptedAt) {
      return NextResponse.json({ error: 'This invite was already accepted.' }, { status: 409 });
    }
    if (!invite.revokedAt) {
      await prisma.adminInvite.update({ where: { id }, data: { revokedAt: new Date() } });
      await audit(request, auth, 'admin_invite.revoke', { type: 'AdminInvite', id }, {
        before: { email: invite.email, adminRole: invite.adminRole },
      });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Admin invite DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Sends the invite via SMTP (same setup as /api/support). Returns false
// instead of throwing when SMTP isn't configured or sending fails — the
// caller still gets the link to share by hand.
async function sendInviteEmail(to: string, adminRole: AdminRole, link: string, invitedBy: string | null) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    console.warn('Admin invite email not sent: SMTP_USER / SMTP_PASS missing');
    return false;
  }
  try {
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    const role = ROLE_LABELS[adminRole];
    const by = invitedBy ? ` by ${invitedBy}` : '';
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `STAAD <${user}>`,
      to,
      subject: 'You have been invited to the STAAD admin portal',
      text: [
        `You have been invited${by} to join the STAAD admin portal as ${role}.`,
        '',
        `Accept the invite: ${link}`,
        '',
        `Sign in (or create an account) with ${to} to accept. The link expires in 7 days.`,
        "If you weren't expecting this, you can ignore this email.",
      ].join('\n'),
      html: `
        <div style="font-family:system-ui,Arial,sans-serif;color:#1f2937;line-height:1.5">
          <h2 style="margin:0 0 8px">STAAD admin invite</h2>
          <p>You have been invited${esc(by)} to join the STAAD admin portal as <strong>${role}</strong>.</p>
          <p><a href="${esc(link)}" style="display:inline-block;background:#4a7c59;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">Accept invite</a></p>
          <p style="color:#6b7280;font-size:13px">Sign in (or create an account) with ${esc(to)} to accept. The link expires in 7 days.
          If you weren't expecting this, you can ignore this email.</p>
        </div>
      `,
    });
    return true;
  } catch (e: any) {
    console.error('Admin invite email failed:', e?.message);
    return false;
  }
}
