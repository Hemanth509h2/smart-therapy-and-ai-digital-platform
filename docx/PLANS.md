# STAAD Subscription Plans — Basic, Pro, Enterprise

Date: 2026-10-11 · For: admins setting up plans in **Admin → Plans**

STAAD charges **professionals (therapists) only** — clients join free through
their therapist's invite.

**Every plan includes all 25 therapy modules.** Plans differ by how much a
therapist can use the platform each month:

1. **Active clients** — how many clients they can have at once.
2. **AI session reports per month** — AI analyses of sessions (the main
   running cost of the platform).
3. **Video sessions per month.**

> Prices are the starting prices from `backend/scripts/seed-plans.cjs`
> (Basic, Pro) and the live Enterprise plan (₹5,999). Limits are proposals —
> adjust before launch.

> ⚠️ **Set, but not enforced yet:** admins can now enter the three limits on
> each plan (Admin → Plans → Usage limits) and therapists see them on the plan
> cards, but the app does not block anything at the limit yet — see
> [What needs building](#what-needs-building).

---

## At a glance

| | **Basic** | **Pro** | **Enterprise** |
|---|---|---|---|
| Price | **₹999 / month** | **₹2,499 / month** | **₹5,999 / month** |
| Therapy modules | **All 25** | **All 25** | **All 25** |
| Active clients | Up to **10** | Up to **40** | **Unlimited** |
| AI session reports / month | **50** | **200** | **Unlimited** |
| Video sessions / month | **40** | **150** | **Unlimited** |
| Live transcript, session notes | ✓ | ✓ | ✓ |
| Progress tracking, PDF/CSV export | ✓ | ✓ | ✓ |
| WhatsApp invites & reminders | ✓ | ✓ | ✓ |
| Term options | 1, 3, 6, 12 months | 1, 3, 6, 12 months | 1, 3, 6, 12 months |
| Best for | Starting out / part-time | Full-time practice | Clinics & high volume |

Monthly allowances reset on the 1st of each month. A 3-month term costs
monthly × 3 (no multi-month discount on this branch).

**How the numbers were chosen:** ~4 sessions per client per month, so Basic's
40 sessions ≈ 10 clients and Pro's 150 ≈ 40 clients. AI reports allow roughly
one analysis per session with headroom.

---

## Basic — ₹999/month

**For:** a therapist starting out or practising part-time.

- All 25 therapy modules.
- Up to **10 active clients**, **40 sessions** and **50 AI reports** a month.

**Card bullets (Plan → Features field):**
1. All 25 therapy modules
2. Up to 10 active clients
3. 40 video sessions a month
4. 50 AI session reports a month
5. Progress tracking with PDF/CSV export

## Pro — ₹2,499/month

**For:** a full-time therapist with a steady caseload.

- All 25 therapy modules.
- Up to **40 active clients**, **150 sessions** and **200 AI reports** a month.

**Card bullets:**
1. All 25 therapy modules
2. Up to 40 active clients
3. 150 video sessions a month
4. 200 AI session reports a month
5. Progress tracking with PDF/CSV export

## Enterprise — ₹5,999/month

**For:** clinics and high-volume practitioners.

- All 25 therapy modules.
- **Unlimited** clients, sessions and AI reports.

**Card bullets:**
1. All 25 therapy modules
2. Unlimited clients
3. Unlimited video sessions
4. Unlimited AI session reports
5. Progress tracking with PDF/CSV export

---

## The 25 therapy modules (included in every plan)

| Category | Modules |
|---|---|
| SLD (4) | Word Building, Whack-a-Mole Math, Pixel Art Coding, Bubble Splash |
| ADHD (3) | N-Back Challenge, Virtual Maze, Simon Says |
| Anxiety & Depression (4) | 5-4-3-2-1 Grounding, Emotional Charades, Virtual Box Popping, Worry Box |
| ID (3) | Drag & Drop Sorting, Social Story Sequencing, Virtual Shop |
| General (7) | Emotion Wheel, Defusion River, Thought Challenger, Micro Quest Board, Values Card Sort, Worry Vault, Facts vs Feelings |
| Skill Development (4) | Story Choice Adventure, Emotion Detective, Build Together, Treasure Quest |

Source: `frontend/src/lib/modules.ts`. A module switched off in
**Admin → Module library** is hidden on every plan.

---

## Setting them up in Admin → Plans (today)

| Field | Basic | Pro | Enterprise |
|---|---|---|---|
| Name | `Basic` | `Pro` | `Enterprise` |
| Description | 10 clients · 40 sessions/mo | 40 clients · 150 sessions/mo | Unlimited everything |
| Price / month (₹) | 999 | 2499 | 5999 |
| Default term (months) | 1 | 1 | 1 |
| Tool quota | ☑ **Unlimited** | ☑ **Unlimited** | ☑ **Unlimited** |
| Usage limits → Active clients | 10 | 40 | *(blank)* |
| Usage limits → Sessions / month | 40 | 150 | *(blank)* |
| Usage limits → AI reports / month | 50 | 200 | *(blank)* |
| Features | bullets above | bullets above | bullets above |
| Sort order | 1 | 2 | 3 |
| Active | ☑ | ☑ | ☑ |

Set **Tool quota = Unlimited on all three** — that is what gives every plan all
modules (and skips the "choose your tools" step for therapists). A blank
usage-limit box means unlimited. If a plan's Features list is empty, its card
shows the limits automatically ("10 active clients", "40 sessions a month"…).

**Notes**
- The live plan is named **"Enterprice"** (typo). Rename it to `Enterprise`
  with **Edit** — renaming keeps its existing subscriber; don't delete and
  recreate it (plans in use can't be deleted anyway).
- Only **Super admin** and **Billing** admins can create or edit plans; every
  change is recorded in the Audit log.

---

## What needs building

The limits can be **set** but are not **enforced** yet:

| # | Change | Where | Status |
|---|---|---|---|
| 1 | `maxClients`, `maxSessionsPerMonth`, `maxAiReportsPerMonth` on `Plan` (null = unlimited) | `backend/prisma/schema.prisma` | ✅ done |
| 2 | Edit the three limits in the plan form; show them on plan cards | Admin → Plans, therapist Plans page | ✅ done |
| 3 | Block new client invites at the client limit | `/api/invites`, client sign-up via invite | to do |
| 4 | Block scheduling a session past the monthly limit | `POST /api/sessions`, bookings | to do |
| 5 | Block AI analysis past the monthly limit (count `UsageEvent` AI_ANALYSIS this month) | `/api/ai-insight` | to do |
| 6 | Show "8 of 10 clients · 31 of 40 sessions · 44 of 50 AI reports" on the therapist's Plans page | `frontend/src/app/plans/page.tsx` | to do |
| 7 | Warn by email at 80% and when a limit is hit | daily cron | to do |

**Decide before building:** when a limit is hit, should the action be
**blocked** (with an "upgrade" prompt), or **allowed with a warning** to the
therapist and admin? Blocking AI reports is low-risk; blocking a live
session or a client invite may disrupt care, so a soft limit is suggested for
those two.

---

## How a therapist gets a plan

**On this branch (`admin`):** the therapist opens **Plans**, picks a plan and
term, and sends a **request**; an admin approves it in
**Admin → Subscriptions** (or grants a plan directly from the therapist's
page). On the payment branch, paid plans are bought by Cashfree checkout and
activate automatically.

**Renewal:** reminder emails go out 7 days and 1 day before the term ends.
When a term ends without renewal, it expires automatically (daily job).

## Open decision — after a plan ends

Today a therapist with no plan keeps **all modules and no limits** (the app's
default). With limits per plan, that would make "no plan" better than Basic.
Options:
1. A **free tier** with small limits, e.g. 2 clients, 8 sessions, 5 AI reports
   a month (still all modules). **Recommended.**
2. Block new sessions and AI reports until they renew.
3. Keep today's behaviour (no limits without a plan).
