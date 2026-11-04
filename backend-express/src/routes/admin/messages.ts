import { Router } from 'express';
import { mailConfigured, pooledMailTransport, sendMail } from '@/lib/core/mail';
import { prisma, appDb } from '@/lib/core/db';
import { appUrl } from '@/lib/core/app-url';
import { unsubscribeConfigured, unsubscribeToken } from '@/lib/core/consent';
import { requireAdmin, requireRecentLogin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { errorResponse } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';
import { escapeHtml } from '@/lib/http/html';

export const router = Router();

// ---- /api/admin/messages/broadcast ---------------------------------------------


// The only marketing-type email STAAD sends, so it goes only to therapists
// who opted in to product updates (ProfileTherapist.marketingOptIn), never to
// clients. Guest / placeholder accounts use *.local addresses and are skipped.
async function optedInRecipients() {
  const optedIn = await appDb.profileTherapist.findMany({ where: { marketingOptIn: true }, select: { userId: true } });
  if (!optedIn.length) return [];
  return prisma.user.findMany({
    where: {
      id: { in: optedIn.map((t) => t.userId) },
      status: 'ACTIVE',
      role: 'THERAPIST',
      NOT: { email: { endsWith: '.local' } },
    },
    select: { id: true, email: true },
  });
}

// POST /api/admin/messages/broadcast { subject, body, dryRun? }
// Emails an announcement to every active therapist who opted in to marketing
// emails, one message per recipient, each with its own unsubscribe link and
// List-Unsubscribe (one-click) headers. dryRun returns the recipient count
// without sending.
router.post('/admin/messages/broadcast', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'support');
    if (!auth.ok) return send(res, auth.response);

    const body = req.body;
    const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 200) : '';
    const text = typeof body.body === 'string' ? body.body.trim().slice(0, 20_000) : '';
    const dryRun = body.dryRun === true;

    if (dryRun) {
      const recipients = (await optedInRecipients()).length;
      return res.json({ dryRun: true, audience: 'opted-in-therapists', recipients });
    }

    if (!subject || !text) return res.status(400).json({ error: 'Enter a subject and a message.' });
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return send(res, stepUp);

    if (!mailConfigured()) return res.status(503).json({ error: "Email isn't set up on the server yet, so nothing was sent. Ask whoever manages hosting to set it up." });
    if (!unsubscribeConfigured()) {
      return res.status(503).json({ error: "Unsubscribe links can't be signed because UNSUBSCRIBE_SECRET isn't set on the server, so nothing was sent." });
    }
    // Pooled: one connection reused for every recipient.
    const transporter = pooledMailTransport();

    const recipients = await optedInRecipients();
    const site = appUrl(req);
    // One-click unsubscribe (RFC 8058) is POSTed by the mail provider straight
    // to this API, so it uses this server's own address.
    const api = `${req.protocol}://${req.get('host')}`;
    const bodyHtml = escapeHtml(text);

    let sent = 0;
    const failures: string[] = [];
    for (const r of recipients) {
      const qs = `u=${encodeURIComponent(r.id)}&t=${unsubscribeToken(r.id)}`;
      const pageUrl = `${site}/unsubscribe?${qs}`;
      const oneClickUrl = `${api}/api/unsubscribe?${qs}`;
      const footer = `You are receiving this because you opted in to STAAD product updates. Unsubscribe: ${pageUrl} (or turn off Marketing emails in Profile).`;
      const html =
        `<div style="font-family:system-ui,Arial,sans-serif;color:#1f2937;line-height:1.5;white-space:pre-wrap">${bodyHtml}</div>` +
        `<p style="font-family:system-ui,Arial,sans-serif;color:#4b5563;font-size:12px;margin-top:24px">You are receiving this because you opted in to STAAD product updates. ` +
        `<a href="${escapeHtml(pageUrl)}" style="color:#4b5563">Unsubscribe</a> or turn off Marketing emails in Profile.</p>`;
      try {
        await sendMail('marketing', {
          to: r.email,
          subject,
          text: `${text}\n\n--\n${footer}`,
          html,
          headers: {
            'List-Unsubscribe': `<${oneClickUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }, transporter);
        sent++;
      } catch (e: any) {
        console.error('Broadcast email failed:', e?.code || e?.responseCode || 'send failed');
        failures.push(e?.message || 'send failed');
      }
    }
    transporter.close();

    await audit(req, auth, 'broadcast.send', { type: 'Broadcast' }, {
      after: { audience: 'opted-in-therapists', subject, recipients: recipients.length, sent, failed: failures.length },
    });
    // Collapse identical errors so the admin sees each problem once.
    const summary = [...new Set(failures)].map((m) => `${failures.filter((f) => f === m).length}× ${m}`);
    return res.json({ ok: failures.length === 0, audience: 'opted-in-therapists', recipients: recipients.length, sent, failures: summary });
  } catch (e: any) {
    return send(res, errorResponse(e, 'POST /api/admin/messages/broadcast failed', "We couldn't send the broadcast. Please try again."));
  }
}));
