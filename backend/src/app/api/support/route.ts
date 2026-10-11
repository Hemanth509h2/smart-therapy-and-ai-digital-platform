import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import { getSetting } from '@/lib/settings';

const CATEGORIES = ['Technical Issue', 'Billing', 'Account', 'Feedback', 'Other'];

// POST /api/support — a user raises a helpdesk ticket.
// The ticket is stored (admin Support inbox) and then emailed to the support
// inbox (Settings → support.email) via SMTP. The ticket is kept even if the
// email fails. Signing in is optional; a valid token links the ticket to the user.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      email,
      role,
      category,
      subject,
      message,
    }: {
      name?: string;
      email?: string;
      role?: string;
      category?: string;
      subject?: string;
      message?: string;
    } = body;

    if (!email || !subject?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: 'email, subject and message are required' },
        { status: 400 }
      );
    }

    const ticketCategory = (CATEGORIES.includes(category || '') ? category : 'Other') as string;

    let userId: string | null = null;
    if (request.headers.get('authorization') || request.headers.get('x-dev-uid')) {
      const auth = await requireAuth(request);
      if (auth.ok) userId = auth.uid;
    }

    const safeName = name?.trim() || 'STAAD user';
    let ref = `STAAD-${Date.now().toString(36).toUpperCase()}`;
    const ticketData = {
      userId,
      name: name?.trim() || null,
      email: String(email).trim().slice(0, 320),
      role: role || null,
      category: ticketCategory,
      subject: subject.trim().slice(0, 300),
      message: message.slice(0, 20_000),
    };
    try {
      await prisma.supportTicket.create({ data: { ref, ...ticketData } });
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
      // Two tickets in the same millisecond: make the ref unique and retry.
      ref = `${ref}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      await prisma.supportTicket.create({ data: { ref, ...ticketData } });
    }

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
      console.error('Support email not configured: SMTP_USER / SMTP_PASS missing');
      return NextResponse.json({ ok: true, ref, emailed: false, note: 'Ticket saved; the email notification is not configured.' });
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for 587 (STARTTLS)
      auth: { user, pass },
    });

    const text = [
      `New helpdesk ticket (${ref})`,
      '',
      `From:     ${safeName} <${email}>`,
      `Role:     ${role || 'Unknown'}`,
      `Category: ${ticketCategory}`,
      `Subject:  ${subject}`,
      '',
      'Message:',
      message,
    ].join('\n');

    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#1f2937;line-height:1.5">
        <h2 style="margin:0 0 4px">New helpdesk ticket</h2>
        <p style="margin:0 0 16px;color:#6b7280">Ref: <strong>${ref}</strong></p>
        <table style="border-collapse:collapse">
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">From</td><td><strong>${safeName}</strong> &lt;${email}&gt;</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Role</td><td>${role || 'Unknown'}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Category</td><td>${ticketCategory}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Subject</td><td>${subject}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
        <p style="white-space:pre-wrap">${message.replace(/</g, '&lt;')}</p>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || `STAAD Helpdesk <${user}>`,
        to: await getSetting('support.email'),
        replyTo: email,
        subject: `[Helpdesk · ${ticketCategory}] ${subject}`,
        text,
        html,
      });
    } catch (e: any) {
      console.error(`Support ticket ${ref} saved but the email failed:`, e?.message);
      return NextResponse.json({ ok: true, ref, emailed: false, note: 'Ticket saved; the email notification could not be sent.' });
    }

    return NextResponse.json({ ok: true, ref, emailed: true });
  } catch (error: any) {
    console.error('Support ticket error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to send ticket' },
      { status: 500 }
    );
  }
}
