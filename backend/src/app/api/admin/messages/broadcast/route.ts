import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin, requireRecentLogin } from '@/lib/apiAuth';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const BATCH = 50;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// POST /api/admin/messages/broadcast { audience: 'therapists'|'all', subject, body, dryRun? }
// Emails an announcement to every active user in the audience, BCC'd in
// batches of 50. dryRun returns the recipient count without sending.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request, 'support');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const audience = body.audience === 'all' ? 'all' : body.audience === 'therapists' ? 'therapists' : null;
    const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 200) : '';
    const text = typeof body.body === 'string' ? body.body.trim().slice(0, 20_000) : '';
    const dryRun = body.dryRun === true;
    if (!audience) return NextResponse.json({ error: "audience must be 'therapists' or 'all'" }, { status: 400 });

    // Guest / placeholder accounts use *.local addresses that can't receive mail.
    const where: Prisma.UserWhereInput = {
      status: 'ACTIVE',
      role: audience === 'therapists' ? 'THERAPIST' : { in: ['THERAPIST', 'CLIENT'] },
      NOT: { email: { endsWith: '.local' } },
    };

    if (dryRun) {
      const recipients = await prisma.user.count({ where });
      return NextResponse.json({ dryRun: true, audience, recipients });
    }

    if (!subject || !text) return NextResponse.json({ error: 'subject and body are required' }, { status: 400 });
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return stepUp;

    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) return NextResponse.json({ error: 'Email is not configured on the server.' }, { status: 503 });
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, auth: { user, pass } });
    const from = process.env.SMTP_FROM || `STAAD <${user}>`;

    const emails = (await prisma.user.findMany({ where, select: { email: true } })).map((u) => u.email);
    const html = `<div style="font-family:system-ui,Arial,sans-serif;color:#1f2937;line-height:1.5;white-space:pre-wrap">${escapeHtml(text)}</div>`;

    let sent = 0;
    const failures: string[] = [];
    for (let i = 0; i < emails.length; i += BATCH) {
      const bcc = emails.slice(i, i + BATCH);
      try {
        await transporter.sendMail({ from, to: from, bcc, subject, text, html });
        sent += bcc.length;
      } catch (e: any) {
        console.error(`Broadcast batch ${i / BATCH + 1} failed:`, e?.message);
        failures.push(`batch ${i / BATCH + 1}: ${e?.message || 'send failed'}`);
      }
    }

    await audit(request, auth, 'broadcast.send', { type: 'Broadcast' }, {
      after: { audience, subject, recipients: emails.length, sent, failedBatches: failures.length },
    });
    return NextResponse.json({ ok: failures.length === 0, audience, recipients: emails.length, sent, failures });
  } catch (e: any) {
    console.error('POST /api/admin/messages/broadcast failed:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
