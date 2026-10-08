# Claude Code — Change Log

This file records all changes made by Claude Code to the STAAD Therapy platform.
For project architecture and context, see [`architecture.md`](./architecture.md).

> **Convention:** Each entry below is dated and describes *what* changed, *why*,
> and *which files* were touched. Newest entries at the top.

---

## Change History

### 2026-06-15 — Feature: Subscription plans (request → admin approval) + plan catalog

**What & why:** Added the base of a monthly subscription system for professionals
(therapists) — no payments yet. Therapists see their current plan (or **Free tier**),
request a plan by picking the plan + the specific tools they want, and admins approve/
reject requests, track who is on what plan for how many months and whether they've
renewed, and manage the plan catalog. Approving a request applies the granted tools to
the therapist's in-session module access (admin can tweak the tool list at approval).

**Decisions (from user):** plans suggest tools but the admin sets access (approval is
the manual gate); plans are **admin-managed in-app** (starter set seeded); therapist
**Plans** section shows the current plan or Free tier and lets them **request** a plan +
choose up to N tools (e.g. Base = 5) — that request goes to the admin for **approval**.

**Data model — `prisma/schema.prisma`:**
- `enum SubscriptionStatus { ACTIVE EXPIRED CANCELLED }`, `enum SubRequestStatus
  { PENDING APPROVED REJECTED }`.
- `model Plan { id, name @unique, description?, priceMonthly (display-only INR),
  durationMonths, toolQuota Int? (null ⇒ all tools), isActive, sortOrder, ... }`.
- `model Subscription { id, therapistId→ProfileTherapist, planId→Plan, status, months,
  startedAt, currentPeriodEnd, renewedAt?, renewalCount, moduleAccess String[], ... }`.
- `model SubscriptionRequest { id, therapistId, planId, months, modules String[],
  status, note?, reviewedAt?, createdAt }`.
- `subscriptions` + `subscriptionRequests` relations on `ProfileTherapist`.
- `prisma db push` to Neon + `generate` (again needed the dev server stopped — the
  Windows EPERM lock on the query-engine DLL).

**New lib:** `src/lib/subscriptions.ts` — `addMonths()`, `resolveCurrent()` (most recent
ACTIVE term with a future `currentPeriodEnd`; absence ⇒ free tier), `serializeSubscription()`.

**API routes:**
- `GET /api/plans` (active plans; `?all=1` includes inactive).
- `GET/POST /api/admin/plans` + `PATCH/DELETE /api/admin/plans/[id]` (catalog CRUD;
  DELETE soft-disables a plan that's referenced by any subscription/request).
- `GET /api/subscriptions?therapistId=` (current + pendingRequest + history).
- `POST /api/subscriptions/request` (therapist submits; rejects a 2nd pending request;
  enforces the plan's `toolQuota`).
- `GET /api/admin/subscriptions` (every professional's current plan + all pending requests).
- `POST /api/admin/subscriptions/requests/[id]` (`approve`/`reject`; approve expires the
  prior ACTIVE term, creates the Subscription, and sets `ProfileTherapist.allModulesAllowed`/
  `moduleAccess` from the granted tools — unlimited plans grant all).
- `PATCH /api/admin/subscriptions/[id]` (`renew` extends `currentPeriodEnd` + bumps
  `renewalCount`/`renewedAt`; `cancel`; `reactivate`).

**Frontend / nav:**
- `Sidebar.tsx` — therapist gains **Plans** (`/plans`); admin gains **Subscriptions**
  (`/admin/subscriptions`) + **Plans** (`/admin/plans`).
- `src/app/plans/page.tsx` — current-plan / Free-tier card, pending-request banner,
  available-plans grid, and a request modal (term picker + quota-limited tool checkboxes).
- `src/app/admin/subscriptions/page.tsx` — pending-request cards (Approve modal w/ term +
  tool confirmation / Reject) + a professionals table (plan, term, started, renews/ends,
  renewed?, status, Renew/Cancel).
- `src/app/admin/plans/page.tsx` — plan catalog cards + create/edit modal (price, term,
  tool quota or unlimited, active toggle).

**Seed:** `scripts/seed-plans.cjs` + `npm run seed:plans` — upserts starter plans
**Base** (5 tools), **Pro** (12 tools), **Unlimited** (all tools).

**Verification:** `npx tsc --noEmit` clean; schema pushed; plans seeded.

**Notes:** No payment integration (priceMonthly is display-only). Routes follow the
codebase's existing trust-the-client pattern (no server-side role enforcement yet).
Free tier doesn't change a therapist's existing module access; only an approved
subscription rewrites `allModulesAllowed`/`moduleAccess`.

---

### 2026-06-15 10:51 IST — Feature: Admin role — usage monitoring + per-therapist module access

**What & why:** Built an ADMIN account type that (1) monitors resource usage per
professional and (2) controls which therapy modules each therapist can launch.

**Decisions (from user):** access is **per-therapist** (gates the in-session selector);
bootstrap admin `om.cofounder@staad.in` / `123456`, and **admins can add more admins**
in-app; usage dashboard tracks sessions & clients, AI & transcription usage, module
usage, invites, and each therapist's module access.

**Data model — `prisma/schema.prisma`:**
- `model ProfileAdmin { id, userId @unique→User, firstName, lastName, ... }` + `admin
  ProfileAdmin?` on `User`.
- `ProfileTherapist`: added `allModulesAllowed Boolean @default(true)` + `moduleAccess
  String[]` (empty list with flag=false ⇒ restricted set; flag=true ⇒ all).
- `model UsageEvent { id, therapistId→ProfileTherapist, sessionId?, type, label?, count,
  createdAt }` (`type` = AI_ANALYSIS | TRANSCRIPTION | MODULE_LAUNCH).
- `prisma db push` to Neon + `generate` (again needed the dev server stopped — Windows
  EPERM lock on the query-engine DLL).

**New libs:** `src/lib/modules.ts` (canonical module registry — `MODULE_CATEGORIES`,
`ALL_MODULE_IDS`, `resolveAllowedModuleIds()`), `src/lib/firebaseAdmin.ts` (Admin SDK init).

**API routes:**
- `GET /api/admin/overview` — per-therapist metrics (clients, sessions total/active/
  completed, session minutes, AI analyses, transcript lines, module launches + top
  modules, invites pending/claimed, document count, access level, last active).
- `PATCH /api/admin/therapists/[id]/access` — set `{ allModulesAllowed, moduleAccess }`.
- `GET/POST /api/admin/admins` — list admins / create-or-promote an admin via Admin SDK.
- `POST /api/usage` — log a usage event (therapist profile id + type).
- Instrumented `POST /api/ai-insight` to log `AI_ANALYSIS`; `GET /api/users/profile` now
  includes the `admin` relation.

**Frontend / role plumbing:**
- `src/app/admin/page.tsx` — Professionals table + summary cards + "Access" modal
  (Allow-all toggle + per-category module checkboxes from the registry).
- `src/app/admin/admins/page.tsx` — admin list + "Add Admin" form.
- `AuthProvider.tsx` resolves the admin profile; `src/app/page.tsx` redirects ADMIN → `/admin`;
  `Sidebar.tsx` gains `adminNav` (Professionals / Admins / Help) + "Admin" role badge.
- `ModuleSelectorPanel.tsx` refactored to import the shared registry and accept
  `allowedModuleIds` (filters the in-session list); `session/[sessionId]/page.tsx`
  passes `resolveAllowedModuleIds(profile)` and logs MODULE_LAUNCH + TRANSCRIPTION usage.

**Seed:** `scripts/seed-admin.cjs` + `npm run seed:admin` — created the bootstrap admin
(uid `Mw151vN18gUjsepKc5nj8967y1P2`).

**Verification:** `npx tsc --noEmit` clean; schema pushed; seed ran successfully.

**Notes:** Usage metrics accrue going forward (AI/module/transcript events log from now;
sessions/clients/invites/access reflect existing data immediately). Admin routes follow
the codebase's existing trust-the-client pattern (no server-side role enforcement yet).

---

### 2026-06-14 — Asset: platform logo replaced (vertical + new horizontal lockup)

**What & why:** Replaced the text "staad." / "STAAD" marks with the supplied SVG logo,
enlarged and aligned per layout. The supplied art is a vertical lockup, so a **horizontal
lockup** (emblem + "STAAD" beside it) and an **emblem-only** mark were derived from it for
horizontal contexts. Initial placement overlapped the "S"; fixed by measuring real path
bounding boxes and laying out emblem + wordmark with a guaranteed gap.

**Files:** `public/assests/staad-logo-fixed.svg` (added `viewBox`); generated
`public/assests/staad-logo-horizontal.svg` + `staad-emblem.svg` (emblem paths vs. wordmark
letter paths split by fill, exact measured viewBoxes). Rendered (sized up) in
`Sidebar.tsx` (expanded = horizontal, collapsed = emblem), `session/[sessionId]/page.tsx`
(top bar), `auth/page.tsx` (hero + card title). `alt="STAAD"` kept for accessibility.

**Verification:** `npx tsc --noEmit` clean.

---

### 2026-06-14 — Fix: wired dead Profile buttons (password reset + account deletion)

**What & why:** Audit of all inputs/dropdowns found everything correctly controlled, but
the Profile page's "Change password" and "Delete" buttons had no handlers.

**Files:** `src/app/profile/page.tsx` — "Change password" → Firebase
`sendPasswordResetEmail`; "Delete" → deletes Firebase Auth user then calls new
`DELETE /api/users/profile` (clears dependent Session/Booking/Note/Invite/DocumentChunk
rows in a transaction, then the User → cascades the profile), then signs out. Handles
`auth/requires-recent-login`. `src/app/api/users/profile/route.ts` — added `DELETE`.

**Verification:** `npx tsc --noEmit` clean.

---

### 2026-06-14 — Feature: scheduled session ends on call-cut → client history

**What & why:** Sessions never transitioned out of SCHEDULED (only a Firestore flag was
set), so they never appeared in the patient's history. Now the Postgres `Session` is
updated on lifecycle changes.

**Files:** new `src/app/api/sessions/[sessionId]/route.ts` — `PATCH { action: 'start' |
'end' }` (ACTIVE+startedAt / COMPLETED+endedAt, idempotent) + `GET`. `session/[sessionId]/
page.tsx` — marks ACTIVE on join and COMPLETED when the call is cut. Completed sessions
then show under "Past" in the client's session history (Clients → View Sessions).

**Verification:** `npx tsc --noEmit` clean.

---

### 2026-06-14 — UI revamp Pt.2: session room glassmorphism restyle (visual only)

**What & why:** Applied a specified dark/light glass palette + accent cards to the session
room chrome. Visual-only — no layout, text, logic, props, or token changes.

**Files:** `GlassModulePanel.tsx`, `NotesPanel.tsx`, `ModuleSelectorPanel.tsx`,
`ReactionOverlay.tsx`, `LocalVideoPip.tsx`, `RemoteVideoArea.tsx`,
`session/AIInsightBar.tsx`, `session/AIConsentBanner.tsx` — backgrounds/borders/blur/
shadow/radius + paired accent text colors (dark glass `rgba(28,28,28,0.55)`, light glass
`rgba(255,255,255,0.16)`, gold/mint/coral/beige accent cards). The top/bottom control bars
live in `session/[sessionId]/page.tsx` and were left untouched per the "don't edit that
file's logic" rule.

**Verification:** `npx tsc --noEmit` clean.

---

### 2026-06-14 — Feature: Help & Support (helpdesk ticket → email)

**What & why:** Added a Help & Support section to the nav for **both** roles with a
ticket form that emails submissions to `om.cofounder@staad.in`.

**Files:** `Sidebar.tsx` (Help nav for both roles); `src/app/help/page.tsx` (ticket form);
`src/app/api/support/route.ts` (Nodemailer/SMTP, `replyTo` = submitter). Added `nodemailer`
+ `@types/nodemailer` (via `--legacy-peer-deps` due to a pre-existing eslint peer conflict)
and SMTP placeholders in `.env`.

**Verification:** `npx tsc --noEmit` clean.
**Note:** Requires `SMTP_USER`/`SMTP_PASS` (Gmail App Password) to actually send.

---

### 2026-06-14 — Fix: page alignment — wrap all pages in DashboardLayout

**What & why:** Only the home dashboard used `DashboardLayout` (fixed sidebar + 220px
content offset); the other pages rendered flush-left with no sidebar. Wrapped them all.

**Files:** `clients`, `sessions`, `schedule`, `modules`, `profile`, `my-sessions`,
`progress` `page.tsx` — wrapped content in `<DashboardLayout role={role} profile={profile}>`
(modules also gained `useAuthStore` for role/profile).

**Verification:** `npx tsc --noEmit` clean.

---

### 2026-06-13 — Feature: therapist-invites-patient onboarding flow

**What & why:** New patient-acquisition flow. A therapist adds a patient (name +
disorder only) → the app creates an **Invite** (+ assigned session) and a **shareable
link** → patient opens link → auth page (forced CLIENT, "invited by" banner) → patient
signs up themselves → onboarding pre-fills/locks name + diagnosis, patient adds DOB →
profile + assigned session created, invite marked CLAIMED → patient sees & joins the
session. Open self-signup still works for non-invited users (both paths coexist).

**Decisions (from user):** link grants patient + a session now; patient fills the
signup form himself; invite form holds only name + disorder; self-signup stays open;
delivery = copyable/shareable link (no email service).

**Data model — `prisma/schema.prisma`:**
- Added `enum InviteStatus { PENDING CLAIMED EXPIRED }`.
- Added `model Invite { id, token @unique, therapistId→ProfileTherapist, firstName,
  lastName, diagnosis String[], scheduledAt, status, claimedClientId?, createdAt,
  expiresAt? }` + `invites Invite[]` relation on `ProfileTherapist`.
- Pushed to Neon via `prisma db push` (then `prisma generate`; needed dev server stopped
  due to a Windows EPERM lock on the query-engine DLL).

**API routes:**
- `POST /api/invites` — therapist creates invite, returns `{ token, invite }`.
- `GET /api/invites?therapistId=` — list a therapist's invites.
- `GET /api/invites/[token]` — invite details (name, diagnosis, status, therapistName)
  for the banner + onboarding prefill.
- `POST /api/users/profile` — extended with optional `inviteToken`: on CLIENT signup it
  also creates the assigned `Session` (from invite.therapistId + new client + scheduledAt)
  and marks the invite `CLAIMED`, all in the existing transaction. Now also returns the
  created `profile` (fixes a latent bug where onboarding read `data.user.client`, which
  was always undefined).

**Frontend:**
- `src/app/page.tsx` — "Add Patient" button + modal (first/last name + disorder). On
  submit shows the generated invite link with Copy + WhatsApp/Email share. New state +
  `handleAddPatient`/`handleCopyInvite`/`resetAddPatient`. Icons: `UserPlus`,`Copy`,`Check`.
- `src/app/auth/page.tsx` — reads `?invite=TOKEN`; forces signup-as-CLIENT, loads invite,
  shows "invited by Dr. X" banner, hides role selector, carries token to onboarding
  (email + Google paths). Wrapped in `<Suspense>` (required for `useSearchParams` in
  `next build`).
- `src/app/onboarding/page.tsx` — invite-aware: forces CLIENT, pre-fills + locks
  (readOnly) name & diagnosis, shows a patient banner, sends `inviteToken` on save, uses
  returned `data.profile`. Also wrapped in `<Suspense>`.

**Verification:** `npx tsc --noEmit` clean; `npm run build` succeeds — `/api/invites` and
`/api/invites/[token]` registered, `/auth` + `/onboarding` prerender cleanly.

**Notes / open items:** Routes follow the existing codebase pattern of trusting
client-passed IDs (no Firebase Admin token verification) — consistent but worth
hardening later. Session `scheduledAt` defaults to now (no time picker in the minimal
invite form). If an already-claimed invite link is reopened, the banner tells the user to
log in instead.

---

### 2026-06-13 — Fix: dark-green surfaces leaking into light mode (Tailwind darkMode)

**Symptom:** In "light" mode, stat cards / Session Rooms & Client Directory panels /
auth card still showed dark-green backgrounds.

**Root cause (diagnosed, differs from the initial report):** Not hardcoded light-mode
backgrounds. Every dark surface is a Tailwind `dark:bg-[#16221e]` *variant*
(there is no `bg-sage-900` / `#1C2B23` / `#162219` anywhere). `tailwind.config.ts` had
**no `darkMode` setting**, so Tailwind defaulted to `darkMode: 'media'` → `dark:`
variants followed the **OS** `prefers-color-scheme`, not the `.dark` class that
`ThemeProvider` toggles. On an OS-dark machine the app showed `dark:` card backgrounds
even while the app's theme state was "light", while the CSS-variable styles (`.dark {}`,
class-based) correctly followed the toggle — producing the cream-page / dark-card mismatch.

**Fix:** Added `darkMode: 'class'` to `tailwind.config.ts`. Now all 13 `dark:` utilities
(dashboard cards, both panels, auth + onboarding cards, and the shadcn `ui/*` components)
follow the `.dark` class. Light mode falls back to the cream base classes/tokens; dark
mode is unchanged.

**Why not the requested sweep:** Replacing each `dark:` background with hardcoded cream
+ a `.light` guard would have masked the symptom on only the listed components, left the
others broken, and decoupled them from real dark-mode theming. The one-line config fix
resolves the actual cause globally. **No `.dark` overrides were touched** (per request).

**Files changed:** `tailwind.config.ts` (added `darkMode: 'class'`).
**Verification:** `npx tsc --noEmit` passes clean.

---

### 2026-06-13 — UI revamp Pt.1e: precise warm-creamy light-mode spec for the dashboard

**What & why:** User supplied an exact design spec for the light-mode "Core Therapy
Space" (dashboard). Implemented it as token + utility changes (light only; dark mode
preserved via `.dark` overrides). Spec values applied verbatim.

**Tokens — `src/app/globals.css` `:root` (light):**
- `--page-bg`: `#F5EFE4` + repeating dot texture — `radial-gradient(rgba(196,168,130,0.18)
  1px, transparent 1px) 0 0 / 28px 28px` (28px grid, 18% opacity dot of #C4A882).
- `--glass-bg`: `rgba(255,251,244,0.75)`; `--glass-border`: `#D4C4A8`; `--radius`: `14px`.
- `--nav-bg`: `rgba(245,239,228,0.7)` (new) for the sticky navbar.
- `--ink`: `#2C1F0E` (headings); `--ink-muted`: `#8B7355` (secondary labels).
- `--sage` (primary accent): `#8B6340`; `--sage-mid`: `#A87A4F`; `--sage-light`
  (inner panels): `#F0E8D8`.
- `--c-accent` (secondary, new): `#C4784A` + `--c-accent-bg rgba(196,120,74,0.14)`.
- `--primary`/`--ring` → `28 37% 40%` (≈ #8B6340); `--border`/`--input` → `38 34% 75%`
  (≈ #D4C4A8).

**Dark preservation — `.dark`:** added overrides for `--nav-bg`, `--sage`, `--sage-light`,
`--sage-mid`, `--c-accent`, `--c-accent-bg` so the new light values don't leak (notably
`--sage-light` stays translucent in dark instead of becoming cream `#F0E8D8`).

**Utilities — `globals.css`:**
- `.btn-press` — `translateY(-1px)` on hover, `scale(0.97)` on active.
- `.stat-hover` — `translateY(-2px)` + soft warm shadow `rgba(139,99,64,0.14)` on hover.
- `@keyframes livePulse` + `.live-dot` — 2s ease-in-out pulsing dot.
- All added to the `prefers-reduced-motion` guard.

**Markup — `src/app/page.tsx`:**
- New card constants: `CARD_BASE` (14px radius, 0.5px `#D4C4A8` border, `--glass-bg`,
  `dark:bg-[#16221e]`, fade-up) → `GLASS_CARD` (+hover-lift) and `STAT_CARD` (+stat-hover).
- Navbar (`GLASS_STRONG`) now `bg-[var(--nav-bg)] backdrop-blur-[8px]`.
- Stat numbers + client streak number set to `font-heading` (DM Serif Display).
- Live indicators recolored to `--c-accent` with `.live-dot`; therapist session rows show
  a pulsing dot next to the time when `status === 'ACTIVE'`.
- Tags ("Upcoming" badge, client diagnosis tags) now use `--c-accent` / `--c-accent-bg`.
- `.btn-press` added to all dashboard + modal buttons.
- Fonts (DM Serif Display + DM Sans) were already imported in `globals.css`.

**Verification:** `npx tsc --noEmit` passes clean. Visual review pending.

---

### 2026-06-13 — UI revamp Pt.1d: full dashboard redesign (white-cream light / current dark)

**What & why:** User asked to redesign the entire dashboard (therapist + client) with a
white/cream aesthetic in **light mode** while keeping the **current aesthetic in dark
mode**. Did a full presentational rewrite of `src/app/page.tsx`. All data fetching,
handlers, state, and both modals are unchanged — only layout/visuals.

**Light vs dark strategy:** Cards use a cream gradient in light mode
(`bg-gradient-to-b from-[#fffdf9] to-[#fbf6ec]`) and fall back to the original dark
surface via `dark:bg-none dark:bg-[#16221e]`. Decorative background blobs render
**only when `theme === 'light'`**, so dark mode keeps its current flat look. Everything
else is token-driven, so dark inherits the existing palette automatically.

**Files changed:**
- `src/app/page.tsx`
  - `GLASS_CARD` constant now light cream-gradient / dark `#16221e`.
  - Header: gradient avatar (user initials), greeting, compact action buttons with
    labels hidden on small screens; sticky glass bar with fade-in.
  - **Therapist:** new 4-up **stat row** (active rooms / appointments / clients / total
    sessions) with staggered entrances; 2-col layout (Session Rooms + Appointment
    Schedule on the left, Client Directory on the right). List rows now have gradient
    initial-avatars, hover-lift, and a solid sage "Enter Room" CTA.
  - **Client:** polished welcome + streak + upcoming-session + activity/note cards
    (same content, refined spacing/typography, hover-lift, staggered fade-ups).
  - Added decorative light-mode-only blobs (reuses `.blob`/`.animate-blob`).
  - New icon imports: `CalendarClock`, `Users`. Added `nameInitials()` + `initials`
    helpers and a `therapistStats` array.
- (No CSS changes needed — reused tokens + animation utilities from earlier steps.)

**Verification:** `npx tsc --noEmit` passes clean. Visual review pending from user.

**Notes:** Client "streak" / "Today's Activity" remain illustrative placeholders (as in
the original). Dark mode intentionally unchanged in feel. Session room still deferred.

---

### 2026-06-13 — UI revamp Pt.1c: stunning landing (auth) page redesign + animated background

**What & why:** User asked for a stunning landing page with a more aesthetic
background (free design choice). Redesigned `/auth` (the logged-out landing) from a
single centered card into a **two-column hero layout** over an **animated warm-cream
background**. All auth logic (email/password, Google, login/signup toggle, role
selector) is unchanged — only the surrounding layout/visuals changed.

**Files changed:**
- `src/app/globals.css`
  - Added `@keyframes blobFloat`, `.blob` (absolute, large blur radius), and
    `.animate-blob` (22s slow drift). Added `.animate-blob` to the
    `prefers-reduced-motion` guard.
- `src/app/auth/page.tsx`
  - Imported lucide icons (`Heart`, `Sparkles`, `Video`, `ShieldCheck`).
  - Wrapped page in a `relative overflow-hidden` container with 3 decorative
    floating radial-gradient blobs (warm terracotta/taupe tones) behind the content.
  - **Left hero column:** "Collaborative therapy" pill, large `STAAD` heading,
    tagline, and 3 glass feature cards (live sessions / calming tools / consent-first)
    with staggered fade-up + hover-lift.
  - **Right column:** the original auth `<Card>` (kept verbatim, still `animate-scale-in`).
  - Responsive: columns stack on mobile (`flex-col lg:flex-row`).

**Verification:** `npx tsc --noEmit` passes clean. Visual review pending from user.

**Notes:** Blobs use the new taupe/terracotta palette and the grain texture shows
through. Hero copy is placeholder-friendly — easy to reword. The dashboard (`/`) was
not touched in this step.

---

### 2026-06-13 — UI revamp Pt.1b: drop green accent → warm taupe (whitish-cream feel)

**What & why:** User feedback — texture and animation are good, but the theme still
read as green (the `--sage` accent dominated buttons, text, and every inner panel via
`--sage-light`). Shifted the accent from sage green to a **warm taupe/mocha** and made
panel tints near-white so the overall look is whitish-creamy.

**Files changed (`src/app/globals.css`, `:root` only):**
- `--sage`: `#4a7c6f` (green) → `#9c7d59` (warm taupe). Variable name kept for
  compatibility — it's referenced across the dashboard/auth pages.
- `--sage-light`: green tint → `rgba(156, 125, 89, 0.08)` (subtle warm, near-white panels).
- `--sage-mid`: `#6ba395` → `#b39873`.
- `--primary` and `--ring`: green HSL `165 25% 39%` → taupe `36 28% 47%` (focus rings /
  shadcn primary no longer green).
- Texture (`--page-bg`) and animation utilities left unchanged (user approved them).

**Note:** `.dark` doesn't redefine `--sage*`, so it inherits the new taupe values.
Semantic green "Live Now" status dot left intact. Palette still open to further tuning.

---

### 2026-06-13 — UI revamp Pt.1: warm cream light theme + subtle motion (dashboard & landing)

**What & why:** Started a UI enhancement toward a lighter, "creamish," gently
animated look. This session covers the **dashboard** (`/`) and the **landing/auth**
page (`/auth`) only — the live session room is intentionally deferred to a later
session. Texture/motion intensity: *subtle & tasteful*. Palette: *warm cream + sage*
(provisional — to be reviewed and possibly re-tuned).

**Approach:** Both pages are fully token-driven (they read `--page-bg`, `--ink`,
`--sage`, `--glass-*`), so the bulk of the work was done centrally in the CSS
variable layer, with light per-page animation touches.

**Files changed:**
- `src/app/globals.css`
  - Retuned `:root` tokens from cool sage off-white → **warm cream + sage**
    (`--background`, `--card`, neutrals, `--border`, warm `--ink`/`--ink-muted`,
    warmer `--glass-bg`/`--glass-border`/`--glass-strong` and soft `--glass-shadow`).
  - Baked a faint **paper-grain texture** (inline SVG `feTurbulence`, ~0.04 opacity)
    + soft top highlight gradient directly into `--page-bg`, so the texture appears
    anywhere `background: var(--page-bg)` is used — no per-page edits needed.
  - Added matching textured `--page-bg` and `--glass-shadow-lg` to the `.dark` block.
  - Added animation utilities: `@keyframes fadeUp/fadeIn/scaleIn`, classes
    `.animate-fade-up/.animate-fade-in/.animate-scale-in`, `.stagger-1..4`,
    `.hover-lift`, plus a `prefers-reduced-motion` guard that disables them.
- `src/app/layout.tsx` — body fallback bg `#f6f8f6` (cool) → `#f6f0e3` (cream) to
  avoid a color flash before tokens apply.
- `src/app/page.tsx` (dashboard) — `GLASS_CARD` now includes `hover-lift
  animate-fade-up`; header gets `animate-fade-in`; session/booking/client list rows
  get `hover-lift`.
- `src/app/auth/page.tsx` — auth card gets `animate-scale-in`.

**Verification:** `npx tsc --noEmit` passes clean. Visual review pending from user.

**Open follow-ups / notes:**
- Cards still use `bg-white` (pure white) rather than the ivory `--card` token — left
  as-is for now; can warm them if the user wants a softer card surface.
- Pre-existing quirk kept intact: `--accent` is declared twice in `:root` (HSL then
  `#c8602a`), the hex overriding the HSL one. Not changed to avoid regressions.
- Palette is provisional — user may request a different cream direction.
- Next session: extend the theme to the live session room (video area, top/bottom
  bars, panels, modules).
