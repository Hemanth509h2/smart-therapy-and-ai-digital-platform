# STAAD Therapy — Business Knowledge Base

> The product, market, and commercial view of STAAD Therapy. Pairs with
> [`TECH_KNOWLEDGE.md`](./TECH_KNOWLEDGE.md) (engineering) and
> [`claude_code_1.md`](./claude_code_1.md) (change log). Where a figure is a placeholder or
> an inference from the codebase rather than a confirmed business decision, it is marked
> *(placeholder)* / *(inferred)*.

---

## 1. What STAAD is

STAAD is a **collaborative tele-therapy platform** that puts a therapist and a client in a
**live video room** purpose-built for clinical work — not a generic video call. During the
session the platform:

- **transcribes** the conversation live (consent-gated),
- generates **AI clinical insights** (key emotions, a short clinical summary, concrete next
  steps, a **suggested therapy module**, and a **self-harm/risk flag**), and
- lets the therapist launch **interactive therapy tools/games** that both people use together,
  with the therapist able to lock control.

The wedge: **make each therapy session more effective and better documented** by giving the
therapist real-time, evidence-aware support and a library of engaging interventions —
especially for child/adolescent and neurodevelopmental work.

---

## 2. Problem & why now

- Tele-therapy tools are mostly **generic video** with no clinical scaffolding — the
  therapist juggles conversation, notes, risk-watch, and activities alone.
- **Neurodevelopmental & learning-disorder therapy** (SLD, ADHD, ID) needs *interactive,
  multi-sensory* activities that are hard to deliver remotely.
- Documentation and continuity (what happened last session, what to do next) are manual and
  inconsistent.
- LLMs + cheap real-time transcription now make **in-session clinical assistance** viable.

STAAD addresses all three: structured live sessions, an AI "co-pilot," and a built-in
intervention library.

---

## 3. Who it's for (personas)

| Persona | Role in app | What they get |
|---|---|---|
| **Therapist / Professional** | `THERAPIST` | The core paying user. Runs sessions, gets AI insights, launches therapy modules, manages clients, takes notes, invites patients, holds a subscription plan. |
| **Client / Patient (often a child + parent)** | `CLIENT` | Joins sessions, participates in therapy modules, sees their sessions/progress. Onboarded either by self-signup or via a therapist invite (`parentEmail` supports guardian flows). |
| **Admin / Operator** | `ADMIN` | STAAD's internal operator. Monitors usage per professional, governs which tools each therapist can use, approves subscription requests, manages the plan catalog, and adds other admins. |

**Specialty focus (inferred from the module library):** Specific Learning Disorder (SLD),
ADHD, Anxiety & Depression, Intellectual Disability (ID), plus general emotional-regulation
/ CBT / ACT / DBT work.

---

## 4. Core value propositions

1. **AI clinical co-pilot** — on-demand, consent-gated analysis grounded in the live
   transcript **plus** the therapist's own uploaded study material (RAG) and previous session
   notes. Surfaces emotions, a summary, next steps, a recommended module, and a **risk flag**.
2. **Interactive therapy library** — ~24 modules across 5 clinical categories, launched into
   a shared panel both participants see; therapist can lock control.
3. **Built-for-therapy session room** — live video + diarized transcription, AI consent
   banner, in-room note-taking, reactions, and a session lifecycle that feeds client history.
4. **Continuity & documentation** — sessions transition SCHEDULED → ACTIVE → COMPLETED and
   land in the client's history; notes persist; transcripts auto-purge after 24h (privacy).
5. **Operator control & monetization** — admin usage dashboard, per-therapist tool
   gating, and a subscription layer tying plan tier to tool access.

---

## 5. Therapy module library (the product's "content")

Canonical registry: `src/lib/modules.ts`. **5 categories, ~24 tools:**

- **SLD (Specific Learning Disorder):** Word Building, Whack-a-Mole Math,
  Pixel Art Coding, Bubble Splash.
- **ADHD:** N-Back Challenge (working memory), Virtual Maze, Simon Says (executive function).
- **Anxiety & Depression:** 5-4-3-2-1 Grounding, Emotional Charades, Virtual Box Popping,
  Worry Box.
- **ID (Intellectual Disability):** Drag & Drop Sorting, Social Story Sequencing, Virtual Shop
  (daily-living/money skills).
- **General (regulation / CBT / ACT / DBT):** Emotion Wheel, Defusion River, Thought
  Challenger, Micro Quest Board, Values Card Sort, Worry Vault, Facts vs Feelings.

Each tool maps to a clinical purpose (e.g. working memory, sustained attention, grounding,
cognitive defusion, behavioral activation, values clarification). The library is the lever
for plan tiering (see §7) and the AI's "suggested module."

---

## 6. Key user journeys

**Patient acquisition (therapist-invites-patient).** Therapist adds a patient (name +
disorder) → app generates a **shareable invite link** (copy / WhatsApp / Email) → patient
opens it → auth page forces a CLIENT signup with an "invited by Dr. X" banner → onboarding
pre-fills & locks name/diagnosis, patient adds DOB → profile + an assigned session are
created and the invite is marked CLAIMED → patient sees and joins the session. Open
self-signup also remains available; both paths coexist.

**Live session.** Both join `/session/[id]` → AI consent banner (both must consent before
transcription) → therapist runs the conversation, hits **Analyse** for AI insight, launches
**therapy modules**, takes **notes** → **End** completes the session and writes it to history.

**Subscription (request → approval).** Therapist opens **Plans**, sees their current plan or
**Free tier**, and **requests** a plan — choosing the specific tools they want up to the
plan's quota (e.g. Base = 5 tools). The request goes to the **admin**, who approves (and can
fine-tune the granted tools + term) or rejects. Approval activates the subscription and sets
the therapist's in-session tool access. **No payment is processed** in-app today.

---

## 7. Monetization & subscription model

**Model:** monthly subscription for **professionals only** (clients are free participants).
Payments are **not yet integrated** — the current system captures plan *intent, term,
renewal status, and tool entitlement*; billing is a deliberate follow-up.

**Tiering lever = number of therapy tools** (`Plan.toolQuota`). Starter catalog seeded by
`npm run seed:plans` *(prices are placeholders, display-only INR)*:

| Plan | Tools (`toolQuota`) | Price *(placeholder)* |
|---|---|---|
| **Free tier** | Existing/default access (no active subscription) | ₹0 |
| **Base** | Any **5** tools | ₹999/mo |
| **Pro** | Any **12** tools | ₹2,499/mo |
| **Unlimited** | **All** tools | ₹4,999/mo |

- Plans are **admin-managed in-app** (`/admin/plans`): name, description, price, default
  term, tool quota (or unlimited), active flag.
- **Term & renewals** are tracked per subscription (months, `currentPeriodEnd`, renewal
  count, renewed-or-not) and shown in the admin **Subscriptions** view — answering "who is on
  what plan, for how many months, and have they renewed."
- **Tool access follows the plan but stays admin-controlled** — approval is the manual gate;
  free tier does not change a therapist's existing access.

**Future commercial levers (not built):** automated billing/checkout, proration, dunning,
self-serve upgrades, usage-based add-ons (AI analyses / transcription minutes are already
metered via `UsageEvent`).

---

## 8. Admin / operations

The **Admin** is STAAD's internal control plane:

- **Professionals dashboard** (`/admin`): per-therapist clients, sessions (total/active/
  completed) and minutes, AI analyses, transcript lines, module launches + top modules,
  invites, document count, access level, last active.
- **Module access control:** allow-all toggle + per-tool checkboxes per therapist.
- **Subscriptions** (`/admin/subscriptions`): approve/reject plan requests; see each pro's
  plan, term, renewal status; renew/cancel.
- **Plans** (`/admin/plans`): manage the plan catalog.
- **Admins** (`/admin/admins`): list and add/promote admins.

Usage metering (`UsageEvent`: AI_ANALYSIS / TRANSCRIPTION / MODULE_LAUNCH) accrues **going
forward** and is the basis for any future usage-based pricing or cost monitoring.

---

## 9. Trust, safety & compliance

- **Consent-first AI:** both therapist and client must consent before any transcription or
  analysis; the AI route hard-blocks without consent.
- **Risk detection:** every analysis can raise a **risk flag** (self-harm/suicide/violence),
  conservative by default — a clinical safety net, not a diagnosis.
- **Data minimization:** transcripts auto-purge after 24h (Vercel cron); sessions/notes
  persist for continuity.
- **Help & Support:** in-app ticketing emails the operator for both roles.
- **Compliance gaps to close (business-relevant):** no server-side auth enforcement yet
  (engineering hardening item); healthcare data-handling/consent records and any HIPAA/India
  DPDP-style obligations are **not formally addressed** and should be reviewed before scale.

---

## 10. Positioning & differentiation

- **vs. generic video (Zoom/Meet/Doxy):** STAAD is clinically scaffolded — live transcript,
  AI insights, risk flagging, and a shared intervention library.
- **vs. EHR/practice-management tools:** STAAD is *in-the-session* assistance + engagement,
  not just scheduling/billing/records.
- **vs. self-guided mental-health apps:** STAAD keeps the **therapist in the loop** and is
  built for **neurodevelopmental / pediatric** interactive therapy.

**Moat candidates:** the curated, clinically-mapped module library; RAG grounded in each
therapist's own materials + session history; and the operator-controlled entitlement model.

---

## 11. Roadmap themes (from the code's open items)

- **Billing**: real payments on top of the existing plan/subscription scaffold.
- **Subscription lifecycle**: auto-expiry/renewal reminders, self-serve upgrades.
- **Security & compliance hardening**: server-side role/token enforcement; formal
  data-protection review.
- **Production AV**: migrate audio capture off the deprecated `ScriptProcessorNode`.
- **Scheduling polish**: time picker in the invite flow; richer calendar.
- **Analytics**: surface the metered usage as cost/ROI dashboards.

---

## 12. Suggested KPIs (proposed, not yet instrumented)

- **Activation:** % of invited patients who claim + attend their first session.
- **Engagement:** modules launched per session; AI analyses per session.
- **Clinical value:** therapist-rated usefulness of AI insights; risk flags acted on.
- **Monetization:** free→paid conversion, plan mix, MRR, renewal rate (renewal data already
  tracked), tool-quota upgrade rate.
- **Retention:** therapist monthly active rate; sessions per therapist per month.
