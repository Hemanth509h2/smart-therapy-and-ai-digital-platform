import { Router } from 'express';
import { prisma } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { getSetting } from '@/lib/core/settings';
import { mailConfigured, sendMail } from '@/lib/core/mail';
import { errorResponse, logError } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';
import { escapeHtml } from '@/lib/http/html';
import { limitByIp } from '@/lib/http/rateLimit';
import { optStr, reqStr } from '@/lib/http/validate';

export const router = Router();

// ---- /api/support --------------------------------------------------------------

const CATEGORIES = ['Technical Issue', 'Billing', 'Account', 'Feedback', 'Other'];

// POST /api/support — a user raises a helpdesk ticket.
// The ticket is stored (admin Support inbox) and then emailed to the support
// inbox (Settings → support.email) via SMTP. The ticket is kept even if the
// email fails. Signing in is optional; a valid token links the ticket to the user.
// Open to signed-out visitors, so limited per IP: a few tickets an hour is
// plenty for a person, and it stops scripted spam of the inbox.
const supportLimit = limitByIp(
  { name: 'support', limit: 5, windowMs: 60 * 60 * 1000 },
  "You've sent several requests in the last hour. Please wait a little, or email us directly."
);

router.post('/support', supportLimit, handle(async (req, res) => {
  try {
    const body = req.body;
    const category: unknown = body.category;
    const name = optStr(body.name, 'Your name', 120);
    const role = optStr(body.role, 'Your role', 60);
    const rawEmail = optStr(body.email, 'Your email', 254);
    const subject = optStr(body.subject, 'The subject', 300);
    const message = optStr(body.message, 'The message', 20_000);

    if (!rawEmail || !subject || !message) {
      return res.status(400).json({ error: 'Enter your email, a subject and a message.' });
    }
    const email = reqStr(rawEmail, 'Your email', 254);
    if (!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address so we can reply.' });
    }

    const ticketCategory = typeof category === 'string' && CATEGORIES.includes(category) ? category : 'Other';

    let userId: string | null = null;
    if (req.get('authorization') || req.get('x-dev-uid')) {
      const auth = await requireAuth(req);
      if (auth.ok) userId = auth.uid;
    }

    const safeName = name || 'STAAD user';
    let ref = `STAAD-${Date.now().toString(36).toUpperCase()}`;
    const ticketData = {
      userId,
      name: name || null,
      email,
      role: role || null,
      category: ticketCategory,
      subject,
      message,
    };
    try {
      await prisma.supportTicket.create({ data: { ref, ...ticketData } });
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
      // Two tickets in the same millisecond: make the ref unique and retry.
      ref = `${ref}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      await prisma.supportTicket.create({ data: { ref, ...ticketData } });
    }

    if (!mailConfigured()) {
      console.error('Support email not configured: SMTP_USER / SMTP_PASS missing');
      return res.json({ ok: true, ref, emailed: false, note: 'Ticket saved; the email notification is not configured.' });
    }

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
        <p style="margin:0 0 16px;color:#6b7280">Ref: <strong>${escapeHtml(ref)}</strong></p>
        <table style="border-collapse:collapse">
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">From</td><td><strong>${escapeHtml(safeName)}</strong> &lt;${escapeHtml(email)}&gt;</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Role</td><td>${escapeHtml(role || 'Unknown')}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Category</td><td>${escapeHtml(ticketCategory)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Subject</td><td>${escapeHtml(subject)}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
        <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
      </div>
    `;

    try {
      await sendMail('support', {
        to: await getSetting('support.email'),
        replyTo: email,
        // Header values: no line breaks (nodemailer also folds these safely).
        subject: `[Helpdesk · ${ticketCategory}] ${subject.replace(/[\r\n]+/g, ' ')}`,
        text,
        html,
      });
    } catch (e: any) {
      logError(`Support ticket ${ref} saved but the email failed`, e);
      return res.json({ ok: true, ref, emailed: false, note: 'Ticket saved; the email notification could not be sent.' });
    }

    return res.json({ ok: true, ref, emailed: true });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Support ticket error', "We couldn't send your support req. Please try again, or email us directly."));
  }
}));
