import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { can } from '@/lib/admin/adminRoles';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// POST /api/admin/therapists/[id]/message — email the therapist from the
// admin portal (support follow-up). Body: { subject, body }. Needs the
// support or people.write permission. 503 when SMTP isn't configured.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!can(auth.adminRole, 'support') && !can(auth.adminRole, 'people.write')) {
      return NextResponse.json({ error: 'Your admin role does not allow this.', code: 'ADMIN_FORBIDDEN' }, { status: 403 });
    }

    const { subject, body } = await request.json();
    const subj = String(subject || '').trim().slice(0, 200);
    const text = String(body || '').trim().slice(0, 10000);
    if (!subj || !text) return NextResponse.json({ error: 'subject and body are required' }, { status: 400 });

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: params.id },
      select: { id: true, firstName: true, userId: true },
    });
    if (!therapist) return NextResponse.json({ error: 'Therapist not found' }, { status: 404 });
    const to = (await prisma.user.findUnique({ where: { id: therapist.userId }, select: { email: true } }))?.email;
    if (!to) return NextResponse.json({ error: 'This therapist has no email address.' }, { status: 400 });

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) {
      return NextResponse.json({ error: 'Email is not configured on the server.' }, { status: 503 });
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for 587 (STARTTLS)
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `STAAD <${user}>`,
      to,
      replyTo: auth.email || undefined,
      subject: subj,
      text,
      html: `<div style="font-family:system-ui,Arial,sans-serif;color:#1f2937;line-height:1.5"><p style="white-space:pre-wrap">${esc(text)}</p></div>`,
    });

    await audit(request, auth, 'therapist.message', { type: 'ProfileTherapist', id: therapist.id }, { after: { to, subject: subj } });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Admin therapist message error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
