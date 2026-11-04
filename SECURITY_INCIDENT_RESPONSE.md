# Personal data breach response

What to do if personal data held by STAAD may have been accessed, changed,
lost or disclosed without permission: a leaked database, a stolen laptop with
an `.env`, a misdirected email with client details, a bug that showed one
therapist another's client, a compromised admin account.

The law: under the Digital Personal Data Protection Act, 2023 and the DPDP
Rules, 2025 (rule 7), STAAD must

1. **tell every affected person without delay**, in plain language, and
2. **tell the Data Protection Board of India without delay, and send the
   Board a detailed report within 72 hours** of becoming aware of the breach
   (or longer only if the Board allows it).

The clock starts when anyone at STAAD first becomes aware, not when the
investigation finishes. When in doubt, treat it as a breach and start the
clock. This is a working checklist, not legal advice; involve a lawyer as
soon as a breach is confirmed.

## Roles

| Role | Who | Does |
|---|---|---|
| Incident lead | Grievance Officer (see `frontend/src/content/business.ts`) | Owns the clock, decides, signs off notices |
| Technical lead | Lead developer | Contains, investigates, preserves evidence |
| Communications | Founder | Notices to users, the Board, therapists |

Fill in names and phone numbers here before launch:

- Incident lead: _______________________
- Technical lead: _______________________
- Lawyer: _______________________

## Hour 0–4: contain and start the record

1. Write down the time you became aware and how. Open an incident log (a
   private doc) and note every action with its time from here on.
2. Stop the leak:
   - Rotate every secret that may be exposed: `DATABASE_URL`, `DATABASE_URL_2`
     (Neon: reset the role password), `FIREBASE_PRIVATE_KEY` (new service
     account key, delete the old one), `STT_TOKEN_SECRET`, `CRON_SECRET`,
     `AUTOMATION_API_KEY`, `UNSUBSCRIBE_SECRET`, `CASHFREE_*`, `LIVEKIT_*`,
     `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `SARVAM_API_KEY`, `SMTP_PASS`.
     Update them on Vercel and Render and redeploy.
   - Suspend affected or suspicious accounts (Admin → Users → Suspend), or
     revoke Firebase sessions for them.
   - Take a broken feature offline if it is the cause.
3. Preserve evidence before it rotates away: export the relevant rows of
   `AccessLog` (who called what; kept 13 months) and `AuditLog` (admin
   actions), Vercel and Render logs, and Firestore audit data.

```sql
-- Every call by one account, newest first
SELECT * FROM "AccessLog" WHERE uid = '<uid>' ORDER BY "createdAt" DESC;
-- Everyone who touched one session or client
SELECT * FROM "AccessLog" WHERE "resourceId" = '<id>' ORDER BY "createdAt";
```

## Hour 4–24: assess

Answer, in the incident log:

- What data: account details, client records, health information, children's
  data, payment references, transcripts?
- Whose: which therapists, which clients (and whether any are children)?
- How many people, and since when?
- Is it still happening?
- What could happen to them (embarrassment, discrimination, fraud)?

## Within 24 hours: notify affected people

Notify every affected person without delay. For client data, notify the
therapist who holds the record and the client or parent directly where we
have their email. Each notice must say, in plain language:

- what happened and when (date and approximate time),
- what data about them was involved,
- what the likely consequences are,
- what STAAD has done and is doing to reduce the harm,
- what they can do to protect themselves (e.g. change password, watch for
  phishing that uses their therapy details),
- how to contact the Grievance Officer.

Send it with the breach-notice script, which ignores marketing opt-outs
(this is a legal notice, not marketing):

```bash
cd backend-express
npm run build
# 1. Put the notice in a file: subject on the first line, then the body.
# 2. Put the affected account emails in a file, one per line.
node --env-file=.env scripts/maintenance/send-breach-notice.mjs \
  --notice notice.txt --recipients affected.txt            # dry run
node --env-file=.env scripts/maintenance/send-breach-notice.mjs \
  --notice notice.txt --recipients affected.txt --send     # send
```

## Within 72 hours: report to the Data Protection Board

File through the Board's online process (check https://www.dpdpa.gov.in or
the Board's current portal). The detailed report covers:

- the facts: what happened, when, how it was discovered,
- the nature, extent, timing and location of the breach,
- the data and the people affected,
- the likely impact on them,
- the measures taken and planned to contain it and prevent a repeat,
- the findings about the person or cause responsible, if known,
- the notices sent to affected people (attach a copy).

Send a short initial report first if the full picture isn't ready, and
follow up.

## Afterwards

- Fix the root cause and add a test that would have caught it.
- Write a short post-incident review: timeline, cause, what worked, what to
  change. Keep it with the incident log for at least a year.
- Check whether any contract (Cashfree, Neon, Firebase, therapists) needs its
  own notice.
