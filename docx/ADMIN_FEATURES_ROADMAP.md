# Admin Portal — Feature Roadmap

Date: 2026-10-11 · Branch: `admin`

Everything we can add to the admin portal, page by page: improvements to the
5 pages that exist today, and the new pages to build. Builds on
[`ADMIN_PORTAL_AUDIT.md`](./ADMIN_PORTAL_AUDIT.md) (2026-10-06) — that file has
the security review; this one is the build list.

**Legend**
- **Priority** — P0 must-have before launch · P1 next · P2 nice to have
- **Effort** — S ≈ ½–1 day · M ≈ 2–4 days · L ≈ 1–2 weeks
- **Data** — ✅ already in the DB · 🆕 needs new tables/columns

---

## 0. Where we are today

| Page | Route | What it does |
|---|---|---|
| Professionals | `/admin` | Per-therapist usage table + module access toggle |
| Therapist detail | `/admin/professionals/[id]` | One therapist's clients, sessions, invites, AI stats |
| Subscriptions | `/admin/subscriptions` | Current plan per therapist; approve/reject requests; renew/cancel/reactivate |
| Plans | `/admin/plans` | Plan catalog CRUD (price, term, tool quota, active) |
| Admins | `/admin/admins` | List admins; create/promote |

Sidebar: Professionals · Subscriptions · Plans · Admins
(`frontend/src/components/layout/Sidebar.tsx`).

Already built elsewhere but **not visible to admins yet**:
- Cashfree payments + `Payment` table, paid plan activation, therapist plan
  cancellation — on branch `sub` (commit `0b45a8f`), not merged to `main`.
- `WhatsAppMessage` delivery log, `UsageEvent` metering (AI analysis,
  transcription, module launches).
- AI risk flags (self-harm/violence) are produced live by `/api/ai-insight`
  but **not saved** anywhere an admin could see them.
- Help tickets (`POST /api/support`) — emailed only, never stored.

---

## 1. Improvements to existing pages

### 1.1 Professionals (`/admin`)
| Feature | Why | Priority | Effort | Data |
|---|---|---|---|---|
| Search + filters (name/email, plan, active/inactive, signup date) | Table won't scale past ~50 therapists | P1 | S | ✅ |
| Sort by any column; pagination (server-side) | Same | P1 | S | ✅ |
| KPI cards on top: total therapists, active this week, paying, MRR, sessions this month | One-glance health | P1 | S | ✅ (+ `Payment` from `sub`) |
| Status badge: Active / Inactive (no session in 30d) / Suspended | Spot churn risk | P1 | S | ✅ / 🆕 suspended |
| Suspend / reactivate therapist (blocks login + API) | Abuse, unpaid, offboarding | P0 | M | 🆕 `User.status`, `suspendedAt`, reason |
| Export table to CSV | Investors, accounting, ops | P2 | S | ✅ |
| Bulk actions: grant/revoke modules, assign plan | Ops at scale | P2 | M | ✅ |

### 1.2 Therapist detail (`/admin/professionals/[id]`)
| Feature | Why | Priority | Effort | Data |
|---|---|---|---|---|
| Tabs: Overview · Clients · Sessions · Billing · Usage · Activity | Page is one long scroll | P1 | M | ✅ |
| Billing tab: plan history, payments, receipts, cancellation status | Answer "did they pay?" in one place | P0 | S | ✅ (from `sub`) |
| Grant plan manually (comp / extend / change tools) without a request | Sales deals, support credits | P1 | S | ✅ (`activatePlan` exists) |
| Usage tab: AI analyses, transcription minutes, module launches over time (chart) | Cost per therapist | P1 | M | ✅ `UsageEvent` |
| Activity tab: logins, sessions, admin actions taken on this account | Support + audit | P1 | M | 🆕 audit log (§2.8) |
| Suspend / delete account (PHI-safe anonymization) | Compliance, offboarding | P0 | L | 🆕 |
| "Send email / WhatsApp" to therapist | Support follow-up | P2 | S | ✅ SMTP + WhatsApp exist |
| Hide/blur client PHI by default, reveal on click (logged) | Least-privilege viewing of minors' data | P1 | S | 🆕 audit entry per reveal |

### 1.3 Subscriptions (`/admin/subscriptions`)
| Feature | Why | Priority | Effort | Data |
|---|---|---|---|---|
| Show **paid vs admin-granted** and link to the payment | Today all terms look the same | P0 | S | ✅ `Payment.subscriptionId` |
| Show **"Cancelled (until end)"** status + cancelled date | Therapists can now cancel | P0 | S | ✅ `cancelledAt` |
| Filters: status, plan, expiring in 7/30 days, cancelled | Renewal outreach | P1 | S | ✅ |
| Expiry handling: auto-expire terms + revert tool access (daily cron) | Today nothing happens at period end | P0 | M | ✅ (`CRON_SECRET` exists) |
| Renewal reminders 7 days / 1 day before end (email + WhatsApp) | Reduce churn | P1 | M | ✅ |
| Subscription history per therapist (timeline) | Disputes, support | P2 | S | ✅ |

### 1.4 Plans (`/admin/plans`)
| Feature | Why | Priority | Effort | Data |
|---|---|---|---|---|
| Subscriber count per plan + revenue per plan | Pricing decisions | P1 | S | ✅ |
| Multi-month discount (e.g. 12 months = 2 free) | Common pricing lever | P2 | M | 🆕 `Plan.discounts` |
| Plan features list editable (shown on `/plans` cards) | Marketing copy is hard-coded today | P2 | S | 🆕 `Plan.features[]` |
| Archive instead of delete when plan has subscribers | Delete can break history | P1 | S | ✅ (`isActive`) |
| Preview how the plan card looks to therapists | Fewer mistakes | P2 | S | ✅ |

### 1.5 Admins (`/admin/admins`)
| Feature | Why | Priority | Effort | Data |
|---|---|---|---|---|
| Roles: Super admin · Billing · Support (read-only) · Content | One stolen token = full power today | P1 | M | 🆕 `ProfileAdmin.role` |
| Invite admin by email link (accept + set password) instead of creating passwords | Ownership verification | P1 | M | 🆕 `AdminInvite` |
| Remove / demote admin | Offboarding — not possible today | P0 | S | ✅ |
| Require MFA for admins; re-auth for destructive actions | Security review item P1 | P1 | M | Firebase MFA |
| Last login + active sessions per admin | Security | P2 | S | 🆕 |

---

## 2. New pages

### 2.1 Dashboard — `/admin/dashboard` (new home) · P0 · M
The first screen an admin sees: is the business healthy today?
- KPI cards: therapists (total / active 7d / paying), clients, sessions today &
  this month, MRR, revenue this month, open support tickets, failed WhatsApps.
- Charts: signups per week, sessions per day, revenue per month, plan mix.
- "Needs attention" list: plans expiring this week, failed payments, risk-flagged
  sessions, WhatsApp failures, open tickets.
- Data: ✅ all existing tables (+ `Payment` from `sub`).
- Move today's `/admin` table to `/admin/professionals`.

### 2.2 Payments & Revenue — `/admin/payments` · P0 · M
Needs the `sub` branch merged.
- Table of every Cashfree order: date, therapist, plan, months, amount, status
  (ACTIVE/PAID/EXPIRED), payment method, Cashfree payment id, sandbox/production.
- Filters: status, date range, plan, therapist. CSV export for accounting.
- Totals: revenue today / month / all-time, MRR, average order value, success rate.
- Order detail drawer: payment attempts, webhook received time, linked subscription.
- **Re-sync from Cashfree** button (calls the existing status sync).
- **Refunds** (Cashfree refund API) with reason — P1, L, 🆕 `Refund` table.
- Invoices / GST receipts (PDF, `jspdf` already a dependency) — P1, M.
- Coupons / discount codes — P2, M, 🆕 `Coupon`.

### 2.3 Clients — `/admin/clients` · P1 · M
Admins can only see clients through a therapist today.
- Search all clients; columns: name, therapist, sessions, last session, invite status.
- Client detail: sessions, progress metrics/reports summary (PHI hidden by default).
- Reassign a client to another therapist (therapist leaves).
- Data: ✅ `ProfileClient`, `Session`, `Invite`, `Progress*`.

### 2.4 Sessions monitor — `/admin/sessions` · P1 · M
- Live now: active sessions/rooms with therapist, client, duration (LiveKit).
- All sessions: filters by status (scheduled/active/completed/cancelled), date, therapist.
- No-show & cancellation rates; average session length.
- **Risk flags**: sessions where the AI raised self-harm/violence risk, with
  "acknowledged by" tracking — P0 for clinical safety. Flags are only shown
  live today, so first persist them: 🆕 `RiskFlag` (session, level, reason,
  raisedAt, acknowledgedAt/By).
- Data: ✅ `Session`, `SessionReport`; 🆕 `RiskFlag`.

### 2.5 Messaging (WhatsApp & email) — `/admin/messages` · P1 · M
- Delivery log: every WhatsApp invite/booking/session message with status
  (pending/sent/delivered/read/failed), error code, attempts — ✅ `WhatsAppMessage`.
- Retry failed messages; delivery-rate chart.
- WhatsApp bot status (connected/QR needed) + **clear account** (endpoint exists
  in `whatsapp-bot`: `POST /logout`).
- Broadcast: announcement to all therapists (email/WhatsApp) — P2, M.
- Message templates editor — P2, M, 🆕.

### 2.6 Usage & AI cost — `/admin/usage` · P1 · M
- AI analyses, transcription minutes, module launches per day/week, per therapist.
- Estimated cost (NVIDIA/OpenRouter/Deepgram/Sarvam rates as settings).
- Top modules used; modules never used (library pruning).
- Quotas/alerts: flag therapists using unusually much.
- Data: ✅ `UsageEvent`.

### 2.7 Support tickets — `/admin/support` · P1 · M
Tickets are only emailed today, so nothing is tracked.
- Store tickets (🆕 `SupportTicket`: user, role, subject, message, status, assignee).
- Inbox with status (open/pending/resolved), assign to admin, internal notes,
  reply by email. Unread count in the sidebar.
- Keep the existing email notification.

### 2.8 Audit log — `/admin/audit` · P0 · M
Security review P0; required for healthcare data.
- 🆕 `AuditLog` (append-only): actor, action, target, before/after, IP, time.
- Write from every admin mutation (plans, subscriptions, access, admins,
  suspend, refunds) and every PHI reveal.
- Page: filter by actor/action/target/date; CSV export. No edit/delete.

### 2.9 Module library — `/admin/modules` · P2 · L
Modules are hard-coded in `frontend/src/lib/modules.ts`.
- List all modules by category with launch counts.
- Enable/disable a module globally (maintenance, broken asset).
- Mark modules "new" / featured; reorder categories.
- Later: upload assets, edit descriptions — 🆕 `Module` table.

### 2.10 Settings — `/admin/settings` · P1 · M
- Payments: Cashfree mode indicator (sandbox/production), webhook URL + last
  webhook received, test connection.
- WhatsApp provider (Twilio/bot) and SMTP status — test send.
- Feature flags: AI insights, transcription, WhatsApp on/off.
- Data retention: transcript purge window (24h today), report retention.
- Branding: support email, app URL. 🆕 `Setting` key/value table.

### 2.11 System health — `/admin/health` · P2 · M
- Status of DB (latency), LiveKit, STT relay, WhatsApp bot, Cashfree, SMTP.
- Recent API errors (5xx) and slow endpoints.
- Cron runs: transcript cleanup, subscription expiry (§1.3) — last run + result.

### 2.12 Reports & exports — `/admin/reports` · P2 · S
- One-click CSV/PDF: therapists, clients, sessions, payments, usage, audit log.
- Monthly business report PDF (KPIs from §2.1).

---

## 3. Cross-cutting

| Item | Priority | Effort |
|---|---|---|
| New admin sidebar: Dashboard · Professionals · Clients · Sessions · Payments · Subscriptions · Plans · Messages · Support · Usage · Audit · Settings · Admins | P0 | S |
| Admin pages use the STAAD design system (`.staad-ui`) like the therapist app | P2 | M |
| Global search (therapist / client / order id / email) in the admin top bar | P2 | M |
| Rate limiting on admin APIs | P0 | S |
| Server-side pagination helper shared by all admin list APIs | P1 | S |
| Fix routes that trust `therapistId` from the query without auth (`GET /api/subscriptions`, `/api/sessions`, `/api/bookings`, `POST /api/subscriptions/request`) | P0 | M |

---

## 4. Suggested build order

| Phase | What | Why first |
|---|---|---|
| 1 | Merge `sub` → main · Payments page · Subscriptions paid/cancelled badges · expiry cron | Money is live; admins must see it |
| 2 | Audit log · admin remove/demote · suspend accounts · fix unauthenticated `therapistId` routes · rate limiting | Security/compliance before scale |
| 3 | Dashboard · new sidebar · Professionals search/filters/export | Daily usability |
| 4 | Support inbox · Messages (WhatsApp log) · Sessions monitor + risk flags | Operations |
| 5 | Clients · Usage & AI cost · Settings · Admin roles + MFA | Growth |
| 6 | Refunds · invoices · coupons · module library · health · reports | Polish |

## 5. New tables summary

| Table / column | For |
|---|---|
| `User.status`, `suspendedAt`, `suspendReason` | Suspend accounts |
| `AuditLog` | Audit log |
| `SupportTicket`, `SupportReply` | Support inbox |
| `ProfileAdmin.role`, `AdminInvite` | Admin roles, invite flow |
| `Refund`, `Coupon` | Payments |
| `RiskFlag` | Persist AI risk flags + acknowledgement |
| `Setting` (key/value) | Settings page |
| `Plan.features[]`, `Plan.discounts` | Plans page |
| `Module` | Module library (later) |
