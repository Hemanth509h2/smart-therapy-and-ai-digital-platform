// Sends a personal data breach notice to the affected people, one email each.
// See SECURITY_INCIDENT_RESPONSE.md at the repo root for when and how.
//
// This is a legal notice (DPDP Act 2023 / DPDP Rules 2025, rule 7), not
// marketing, so it goes to everyone listed whatever their email preferences.
//
//   npm run build
//   node --env-file=.env scripts/maintenance/send-breach-notice.mjs \
//     --notice notice.txt --recipients affected.txt          # dry run
//   ... --send                                               # really send
//
// notice.txt: the subject on the first line, a blank line, then the body as
// plain text. affected.txt: one email address per line (# starts a comment).
// The script prints only counts, never the addresses, and keeps going past
// individual failures; re-run with --recipients of the failed ones if needed.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const noticePath = arg('--notice');
const recipientsPath = arg('--recipients');
const send = process.argv.includes('--send');
if (!noticePath || !recipientsPath) {
  console.error('Usage: send-breach-notice.mjs --notice notice.txt --recipients affected.txt [--send]');
  process.exit(1);
}

const [subjectLine, ...bodyLines] = readFileSync(noticePath, 'utf8').replace(/\r\n/g, '\n').split('\n');
const subject = subjectLine.trim();
const body = bodyLines.join('\n').trim();
if (!subject || !body) {
  console.error('The notice file needs a subject on the first line and a body after it.');
  process.exit(1);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lines = readFileSync(recipientsPath, 'utf8')
  .split('\n')
  .map((l) => l.replace(/#.*/, '').trim())
  .filter(Boolean);
const recipients = [...new Set(lines.map((l) => l.toLowerCase()))].filter((e) => EMAIL.test(e));
const invalid = lines.length - recipients.length;

console.log(`Subject: ${subject}`);
console.log(`Recipients: ${recipients.length} valid${invalid ? `, ${invalid} invalid or duplicate skipped` : ''}`);
if (!send) {
  console.log('Dry run: nothing sent. Add --send to send.');
  process.exit(0);
}

const mail = require(join(root, 'dist/lib/core/mail.js'));
if (!mail.mailConfigured()) {
  console.error('Email is not configured (SMTP_USER / SMTP_PASS). Nothing sent.');
  process.exit(1);
}

const transport = mail.pooledMailTransport();
let sent = 0;
let failed = 0;
for (const to of recipients) {
  try {
    // Plain text only: a security notice should look as unlike phishing as
    // possible, with no buttons or tracking.
    await mail.sendMail('account', { to, subject, text: body }, transport);
    sent++;
  } catch (e) {
    failed++;
    console.error(`Send failed (${failed}): ${e?.code || e?.responseCode || 'error'}`);
  }
}
transport.close?.();
console.log(`Done: ${sent} sent, ${failed} failed.`);
process.exit(failed ? 2 : 0);
