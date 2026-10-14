import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { audit } from '@/lib/audit';
import { getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// POST /api/admin/support/:id/replies { body, internal }
// Internal notes are only stored. Public replies are emailed to the user and
// move the ticket to PENDING (waiting on the user).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'support');
    if (!auth.ok) return auth.response;

    const payload = await request.json().catch(() => ({}));
    const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 20_000) : '';
    const internal = payload.internal === true;
    if (!body) return NextResponse.json({ error: 'body is required' }, { status: 400 });

    const ticket = await prisma.supportTicket.findUnique({ where: { id: params.id } });
    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    let reply = await prisma.supportReply.create({
      data: { ticketId: ticket.id, authorUid: auth.uid, authorEmail: auth.email ?? null, body, internal },
    });

    let emailError: string | null = null;
    if (!internal) {
      try {
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        if (!user || !pass) throw new Error('Email is not configured on the server.');
        const port = Number(process.env.SMTP_PORT || 587);
        const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, auth: { user, pass } });
        await transporter.sendMail({
          from: process.env.SMTP_FROM || `STAAD Helpdesk <${user}>`,
          to: ticket.email,
          replyTo: await getSetting('support.email'),
          subject: `Re: ${ticket.subject} [${ticket.ref}]`,
          text: `${body}\n\n— STAAD Support\nTicket ${ticket.ref}`,
          html: `<div style="font-family:system-ui,Arial,sans-serif;color:#1f2937;line-height:1.5">
            <p style="white-space:pre-wrap">${escapeHtml(body)}</p>
            <p style="color:#6b7280">— STAAD Support<br/>Ticket ${ticket.ref}</p></div>`,
        });
        reply = await prisma.supportReply.update({ where: { id: reply.id }, data: { emailed: true } });
      } catch (e: any) {
        emailError = e?.message || 'Email failed';
        console.error(`Reply on ticket ${ticket.ref} saved but the email failed:`, emailError);
      }
      await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: 'PENDING' } });
    }

    await audit(request, auth, 'ticket.reply', { type: 'SupportTicket', id: ticket.id }, {
      after: { replyId: reply.id, internal, emailed: reply.emailed },
    });
    return NextResponse.json({ reply, emailError });
  } catch (e: any) {
    console.error('POST /api/admin/support/[id]/replies failed:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
