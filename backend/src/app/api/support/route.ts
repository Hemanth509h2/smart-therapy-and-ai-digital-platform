import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

// Where all helpdesk tickets are delivered.
const SUPPORT_INBOX = 'om.cofounder@staad.in';

const CATEGORIES = ['Technical Issue', 'Billing', 'Account', 'Feedback', 'Other'];

// POST /api/support — a logged-in user raises a helpdesk ticket.
// The submission is emailed to the support inbox via SMTP.
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

    const ticketCategory = CATEGORIES.includes(category || '') ? category : 'Other';

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
      console.error('Support email not configured: SMTP_USER / SMTP_PASS missing');
      return NextResponse.json(
        { error: 'Support email is not configured on the server.' },
        { status: 503 }
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for 587 (STARTTLS)
      auth: { user, pass },
    });

    const ref = `STAAD-${Date.now().toString(36).toUpperCase()}`;
    const safeName = name?.trim() || 'STAAD user';

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

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `STAAD Helpdesk <${user}>`,
      to: SUPPORT_INBOX,
      replyTo: email,
      subject: `[Helpdesk · ${ticketCategory}] ${subject}`,
      text,
      html,
    });

    return NextResponse.json({ ok: true, ref });
  } catch (error: any) {
    console.error('Support ticket error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to send ticket' },
      { status: 500 }
    );
  }
}
