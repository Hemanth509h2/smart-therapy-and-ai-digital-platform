# Admin Portal Assessment — Audit, Improvements & Security Review

Date: 2026-10-06

## A. Existing Functionalities (as reviewed)

Portal pages live in `frontend/src/app/admin/`:

1. **Overview dashboard** (`/admin`, `page.tsx`) — per-therapist usage table:
   clients count, sessions (total/active/completed/scheduled), total minutes,
   invites (pending/claimed), uploaded documents, AI analyses, transcript lines,
   module launches, top modules, and module access summary. Row → therapist detail.
2. **Therapist detail** (`/admin/professionals/[therapistId]`) — one therapist's
   profile, clients, sessions with status/duration, invite history, documents,
   AI stats.
3. **Admin management** (`/admin/admins`) — list admin accounts; create/promote
   an admin (email + optional password, Firebase user creation/promotion).
4. **Plans catalog** (`/admin/plans`) — list plans; create/edit name, description,
   monthly price, duration, tool quota (null = unlimited), sort order, active flag, delete.
5. **Subscriptions** (`/admin/subscriptions`) — every professional's current plan
   (period end, renewals), approve/reject plan requests (optionally adjust modules
   and months), renew (+months), cancel, reactivate.
6. **Module access control** (per therapist) — toggle `allModulesAllowed` and pick
   allowed module ids; persisted on `ProfileTherapist` (used by
   `GET/PATCH /api/admin/therapists/[id]/access`).

Backend admin API routes (`backend/src/app/api/admin/*`):
- `GET /admin/overview`, `GET /admin/therapists/[id]`, `GET/PATCH /admin/therapists/[id]/access`
- `GET/POST /admin/admins`
- `GET/POST /admin/plans`, `PATCH/DELETE /admin/plans/[id]`
- `GET /admin/subscriptions`, `PATCH /admin/subscriptions/[id]`,
  `POST /admin/subscriptions/requests/[id]`

Auth model: page-level client guard redirects non-ADMIN roles; **since the fix
this session**, every admin API route enforces `requireAdmin` (verified Firebase
token + DB role check).

## B. Improvements Needed

### User management
- No list/search of **clients/patients** or their accounts — admins can only see
  clients via a therapist. Add a clients view (counts, flags, account status).
- No **suspend/deactivate/delete** for therapists or clients. Account deletion
  should anonymize PHI (patients are minors — legal exposure).
- No way to view or reset a stuck user's Firebase auth state.

### Role management
- Only `ADMIN` vs non-admin — no granular roles (e.g. SUPPORT read-only,
  BILLING-only, SUPER_ADMIN). First-admin bootstrap is manual (DB directly).
- Admin creation accepts any email with a password — no ownership verification
  or invite-based acceptance.

### Analytics
- Overview is a flat per-therapist table. Missing: time-series charts,
  cohort/retention, session attendance rate, AI token/cost usage, WhatsApp
  delivery stats, growth (signups per week), churn.
- No export (CSV/JSON) of any admin data.

### Subscriptions / payments
- No real **payments**: subscriptions are manager-entered records. No Razorpay/
  Stripe integration, no invoices, no failed-payment handling, no proration,
  no trial support, no coupon/discount codes.
- No self-serve plan change for therapists (only admin edits).

### Monitoring
- No health/usage monitoring page: no API error rates, LiveKit room counts,
  WhatsApp/Twilio failures, AI/LLM failures, Firestore/DB latency, or alerts.
- No live view of active sessions/rooms.

### Audit logs
- **None.** No record of who changed plan access, subscription status, admin
  accounts, or module quotas. Required for healthcare compliance (HIPAA-style).

### Data/privacy
- Therapist detail exposes client names + diagnoses; no purpose/retention
  policy enforcement, no PHI redaction toggle, no BAA documentation linkage.

## C. Admin Security Review

Fixed this session:
- All admin APIs previously **unauthenticated** — any anonymous client could
  list therapists, read subscription data, create admins, or change module
  access. Now they all call `requireAdmin` (401/403 enforced server-side).

Remaining risks / improvements:

1. **P0 — No CSRF/origin hardening & no rate limiting** on admin endpoints.
   Add per-IP/user rate limits, especially on `admins` and `subscriptions/requests`.
2. **P0 — No audit trail** of admin actions (see B). Tamper-evident append-only
   log with actor uid, action, target, before/after, timestamp.
3. **P1 — `GET /api/admin/invites`-style enumeration**: `GET /api/invites?therapistId=`
   still returns all invite tokens **without auth** — must require therapist
   ownership (this came up in the previous security audit, not yet fixed).
4. **P1 — No least-privilege roles** (see B) — a single stolen admin token
   grants full power including creating new admins.
5. **P1 — No step-up/MFA requirement** for admin console. Require MFA (or
   re-auth within N minutes) for destructive actions (delete plan, create
   admin, cancel subscription).
6. **P2 — Admin tokens carry no custom claims**; role check is a DB lookup each
   call — fine, but add server-side caching discipline and never cache across
   requests without invalidation on role change.
7. **P2 — Frontend role guard is UX only**; already mitigated by server-side
   `requireAdmin`. Keep both, but never rely on the client check for security.
8. **P2 — First-admin bootstrap** has no audited path; document the runbook and
   restrict who can run it.
9. **P3 — Secrets/config** — live Twilio/Firebase values in repo-adjacent files
   (`STAAD_PRD_Updated_With_Firebase_Config.txt`) — ensure no live keys are
   committed, rotate if so, and keep secrets in a vault/secret manager.

## D. Prioritized Action List

| # | Priority | Change |
|---|---|---|
| 1 | P0 | Add server-side **audit log** for every admin mutation |
| 2 | P0 | Rate-limit admin APIs + verify admin role on `GET /api/invites` |
| 3 | P0 | Account suspend/delete with PHI handling for therapists & clients |
| 4 | P1 | Granular admin roles (SUPER_ADMIN / BILLING / SUPPORT) |
| 5 | P1 | Payments integration (Razorpay/Stripe) + invoices + trial/coupons |
| 6 | P1 | MFA/step-up auth for admin console, esp. destructive actions |
| 7 | P1 | Monitoring dashboard: errors, LiveKit, WhatsApp, LLM, DB |
| 8 | P2 | Client/user management views (search, status, auth reset) |
| 9 | P2 | Analytics: time-series, cohorts, attendance, AI cost; CSV export |
| 10 | P2 | Admin-runbook for first-admin bootstrap; secrets hygiene in repo |
