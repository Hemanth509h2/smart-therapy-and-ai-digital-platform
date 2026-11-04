// Checks every service email and admin alert without sending anything.
// Run after `npm run build`:  node scripts/checks/email-templates.test.cjs
//
// - hostile input (<script>, quotes, javascript: links) is escaped or dropped
// - every email has a subject, HTML and a plain-text version
// - clinical fields passed by mistake never reach an email
// - notify / alertAdmins never throw, with SMTP missing or unreachable
const assert = require('assert');
const path = require('path');

const dist = path.join(__dirname, '../../dist');
const fmt = require(path.join(dist, 'lib/email/format.js'));
const { renderEmail } = require(path.join(dist, 'lib/email/layout.js'));
const t = require(path.join(dist, 'lib/email/templates.js'));
const a = require(path.join(dist, 'lib/email/alerts.js'));
const notify = require(path.join(dist, 'lib/email/notify.js'));

// Loading the modules reads the local .env; start from a clean slate after it.
for (const k of Object.keys(process.env)) {
  if (/^(SMTP_|MAIL_FROM_|MAIL_REPLY_TO_|ADMIN_ALERT_EMAILS)/.test(k)) delete process.env[k];
}
// No database either: the support-email setting lookup must fail and fall
// back to its default, which is what notify() does when the DB is down.
for (const k of ['APP_URL', 'ALLOWED_ORIGINS', 'VERCEL', 'DATABASE_URL', 'DATABASE_URL_2']) delete process.env[k];
process.env.NODE_ENV = 'test';

const EVIL = `<script>alert("x")</script> O'Brien "quoted" & co`;
const PHI = 'PHI-MARKER-should-never-appear';
const leak = { diagnosis: PHI, notes: PHI, detail: PHI, transcript: PHI, content: PHI, riskDetail: PHI };
const when = new Date('2026-11-05T11:00:00Z');
const earlier = new Date('2026-11-04T05:30:00Z');

let passed = 0;
const check = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; }
};

// ── Formatting ────────────────────────────────────────────────────────────────
check('IST date-time', () => assert.equal(fmt.formatDateTimeIST(when), 'Thu, 5 Nov 2026, 4:30 pm IST'));
check('IST date', () => assert.equal(fmt.formatDateIST(when), '5 November 2026'));
check('rupees', () => assert.equal(fmt.formatInr(1234.5), '₹1,234.50'));
check('no base URL in production without APP_URL', () => {
  process.env.NODE_ENV = 'production';
  assert.equal(fmt.emailLink('/plans'), null);
  process.env.NODE_ENV = 'test';
});

// ── Every template, rendered twice: with a normal and a hostile APP_URL ──────
const builders = {
  welcome: () => t.welcomeEmail({ firstName: EVIL, ...leak }),
  export: () => t.dataExportEmail({ firstName: EVIL, at: when, ...leak }),
  deleted: () => t.accountDeletedEmail({ firstName: EVIL, at: when, ...leak }),
  terms: () => t.termsAcceptedEmail({ firstName: EVIL, version: EVIL, at: when, ...leak }),
  unsubscribed: () => t.unsubscribedEmail({ firstName: EVIL, ...leak }),
  requestReceived: () => t.planRequestReceivedEmail({ firstName: EVIL, planName: EVIL, months: 3, total: 2997, needsApproval: true, ...leak }),
  approvedPay: () => t.planRequestApprovedEmail({ firstName: EVIL, planName: EVIL, months: 1, total: 999, awaitingPayment: true, ...leak }),
  approvedFree: () => t.planRequestApprovedEmail({ firstName: EVIL, planName: EVIL, months: 1, total: 0, awaitingPayment: false, ...leak }),
  declined: () => t.planRequestDeclinedEmail({ firstName: EVIL, planName: EVIL, ...leak }),
  receipt: () => t.paymentReceiptEmail({ firstName: EVIL, planName: EVIL, months: 6, amount: 4500, discount: 500, couponCode: EVIL, orderId: EVIL, paidAt: when, periodEnd: when, ...leak }),
  failed: () => t.paymentFailedEmail({ firstName: EVIL, planName: EVIL, amount: 999, orderId: EVIL, ...leak }),
  cancelled: () => t.planCancelledEmail({ firstName: EVIL, planName: EVIL, endsAt: when, undone: false, ...leak }),
  undone: () => t.planCancelledEmail({ firstName: EVIL, planName: EVIL, endsAt: when, undone: true, ...leak }),
  ended: () => t.planEndedEmail({ firstName: EVIL, planName: EVIL, endedAt: when, ...leak }),
  clientScheduled: () => t.clientSessionEmail({ change: 'scheduled', therapistName: EVIL, when, ...leak }),
  clientRescheduled: () => t.clientSessionEmail({ change: 'rescheduled', therapistName: EVIL, when, previous: earlier, ...leak }),
  clientCancelled: () => t.clientSessionEmail({ change: 'cancelled', therapistName: EVIL, when, ...leak }),
  therapistScheduled: () => t.therapistSessionEmail({ change: 'scheduled', firstName: EVIL, clientFirstName: EVIL, when, ...leak }),
  therapistRescheduled: () => t.therapistSessionEmail({ change: 'rescheduled', firstName: EVIL, clientFirstName: EVIL, when, previous: earlier, ...leak }),
  therapistCancelled: () => t.therapistSessionEmail({ change: 'cancelled', firstName: EVIL, clientFirstName: EVIL, when, ...leak }),
  reportReady: () => t.reportReadyEmail({ firstName: EVIL, sessionDate: when, ...leak }),
  alertTherapist: () => a.newTherapistAlert({ name: EVIL, email: EVIL, at: when, ...leak }),
  alertRequest: () => a.planRequestAlert({ therapistName: EVIL, planName: EVIL, months: 1, total: 999, needsApproval: true, ...leak }),
  alertPaid: () => a.paymentAlert({ ok: true, therapistName: EVIL, planName: EVIL, amount: 999, orderId: EVIL, ...leak }),
  alertPayFailed: () => a.paymentAlert({ ok: false, therapistName: EVIL, planName: EVIL, amount: 999, orderId: EVIL, ...leak }),
  alertCancelled: () => a.planCancelledAlert({ therapistName: EVIL, planName: EVIL, endsAt: when, undone: false, ...leak }),
  alertEnded: () => a.plansEndedSummaryAlert({ at: when, items: [{ therapistName: EVIL, planName: EVIL, toFreeTier: true }], ...leak }),
  alertDeleted: () => a.accountDeletedAlert({ name: EVIL, email: EVIL, at: when, ...leak }),
  alertSafety: () => a.safetyFlagAlert({ therapistName: EVIL, severity: 'urgent', at: when, ...leak }),
  alertJob: () => a.jobFailedAlert({ job: EVIL, error: EVIL, at: when, ...leak }),
  clientScheduledLink: () => t.clientSessionEmail({ change: 'scheduled', therapistName: EVIL, when, joinUrl: 'https://app.staad.in/join/abc"><script>', ...leak }),
  clientEvilLink: () => t.clientSessionEmail({ change: 'rescheduled', therapistName: EVIL, when, previous: earlier, joinUrl: 'javascript:alert(1)', ...leak }),
  therapistLinkSent: () => t.therapistSessionEmail({ change: 'scheduled', firstName: EVIL, clientFirstName: EVIL, when, clientLinkSent: true, ...leak }),
};

for (const appUrl of ['https://app.staad.in', 'javascript:alert(1)//']) {
  process.env.APP_URL = appUrl;
  for (const [name, build] of Object.entries(builders)) {
    const content = build();
    const out = renderEmail(content, 'support@staad.in');
    const label = `${name} (${appUrl})`;
    check(`${label}: has subject, html, text`, () => {
      assert.ok(out.subject.length > 0 && !/[\r\n]/.test(out.subject));
      assert.ok(out.html.includes('</html>'));
      assert.ok(out.text.includes('— Team STAAD'));
    });
    check(`${label}: escapes markup`, () => {
      assert.ok(!out.html.includes('<script>'), 'raw <script> in HTML');
      assert.ok(!/<a [^>]*href="(?!https?:)/i.test(out.html), 'non-http link in HTML');
      assert.ok(!out.html.includes('javascript:'), 'javascript: in HTML');
    });
    check(`${label}: no clinical data`, () => {
      assert.ok(!out.html.includes(PHI) && !out.text.includes(PHI) && !out.subject.includes(PHI));
    });
    check(`${label}: footer`, () => {
      assert.ok(content.audience === 'admin' ? out.text.includes('administrators') : out.text.includes('support@staad.in'));
    });
    if (appUrl.startsWith('https') && content.button && String(content.button.url).startsWith('https://app.staad.in')) {
      check(`${label}: button links to the app`, () => assert.ok(out.html.includes('href="https://app.staad.in/')));
    }
  }
}
delete process.env.APP_URL;

// Billing emails always state the no-auto-renewal policy.
for (const name of ['requestReceived', 'approvedPay', 'declined', 'receipt', 'failed', 'cancelled', 'undone', 'ended']) {
  check(`${name}: no auto-renewal`, () => assert.ok(renderEmail(builders[name](), 's@x.in').text.includes('No auto-renewal')));
}

// Header injection through the subject is flattened.
check('subject has no line breaks', () => {
  const out = renderEmail({ tag: 'x', audience: 'account', subject: 'Hi\r\nBcc: evil@example.com', paragraphs: [] }, 's@x.in');
  assert.equal(out.subject, 'Hi Bcc: evil@example.com');
});

check('address check', () => {
  assert.ok(notify.isEmailAddress('parent@example.com'));
  for (const bad of ['', 'x', 'a@b', 'A <a@b.com>', 'a@b.com, c@d.com', null, 42]) assert.ok(!notify.isEmailAddress(bad), String(bad));
});

// ── notify / alertAdmins never throw ──────────────────────────────────────────
(async () => {
  const content = builders.welcome();
  // SMTP not configured: resolves without trying.
  await notify.notify('account', 'a@example.com', content);
  await notify.alertAdmins('billing', builders.alertRequest());
  passed += 2;

  // SMTP configured but unreachable: resolves, logs a safe summary.
  Object.assign(process.env, { SMTP_USER: 'events@staad.in', SMTP_PASS: 'x', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1' });
  process.env.ADMIN_ALERT_EMAILS = 'admin@example.com, not-an-email';
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  await notify.notify('account', 'a@example.com', content);
  await notify.notify('account', 'client-123@client.staad.local', content); // valid shape; recipients.ts filters these
  await notify.alertAdmins('billing', builders.alertRequest());
  console.error = origError;
  assert.ok(errors.length >= 1, 'a failed send is logged');
  assert.ok(errors.every((e) => !e.includes('a@example.com') && !e.includes('admin@example.com')), 'recipient addresses never logged');
  passed += 2;

  const recipients = await notify.alertRecipients('billing');
  assert.deepEqual(recipients, ['admin@example.com']);
  process.env.ADMIN_ALERT_EMAILS_SAFETY = 'safety@example.com';
  assert.deepEqual(await notify.alertRecipients('safety'), ['safety@example.com']);
  passed += 2;

  // deliver() caps the wait.
  const t0 = Date.now();
  await notify.deliver([new Promise(() => {})], 50);
  assert.ok(Date.now() - t0 < 1000);
  passed++;

  console.log(`email template checks passed (${passed})`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
check('client email with link shows a Join button', () => {
  const out = renderEmail(t.clientSessionEmail({ change: 'scheduled', therapistName: 'Dr A', when, joinUrl: 'https://app.staad.in/join/tok123' }), 's@x.in');
  assert.ok(out.html.includes('https://app.staad.in/join/tok123'));
  assert.ok(out.text.includes('Join the session: https://app.staad.in/join/tok123'));
  assert.ok(!out.text.includes('will send you the link'));
});
check('client email without link keeps the note', () => {
  const out = renderEmail(t.clientSessionEmail({ change: 'scheduled', therapistName: 'Dr A', when }), 's@x.in');
  assert.ok(out.text.includes('will send you the link'));
});
check('cancelled client email never carries a link', () => {
  const out = renderEmail(t.clientSessionEmail({ change: 'cancelled', therapistName: 'Dr A', when, joinUrl: 'https://app.staad.in/join/tok123' }), 's@x.in');
  assert.ok(!out.html.includes('/join/'));
});
check('therapist told the link was emailed', () => {
  const out = renderEmail(t.therapistSessionEmail({ change: 'scheduled', firstName: 'A', when, clientLinkSent: true }), 's@x.in');
  assert.ok(out.text.includes('We emailed the client their join link.'));
});

