# STAAD Therapy — Technical Knowledge Base

> A single, current reference for the engineering side of the platform. It consolidates
> and **supersedes** the older [`architecture.md`](./architecture.md) where they differ
> (that doc predates the Admin, Invites, Subscriptions, multi-role nav, and warm-cream
> theming work — see [`claude_code_1.md`](./claude_code_1.md) for the dated change log).

---

## 1. What this is, in one paragraph

STAAD Therapy is a **Next.js 14 (App Router)** web app for **collaborative tele-therapy**:
a therapist and a client join a live **LiveKit** video room, the therapist's browser opens a
**per-participant** **Sarvam AI** stream for live **multilingual** (Indian languages +
code-switching) transcription — translated to **English** — and an on-demand **RAG + LLM**
pipeline (**NVIDIA NIM**) produces structured clinical insights (emotions, summary, next
steps, suggested therapy module, risk flag). Inside the room the therapist can launch ~24
interactive **therapy modules**, whose meaningful client actions are logged to a session
event timeline. At session end an **OpenRouter** LLM generates an editable **English session
report** from the full transcript + module activity + in-call notes. Persistent relational
data lives in **Neon PostgreSQL (Prisma)** with **pgvector** for study-material retrieval;
real-time session state, consent, transcript, module events, notes, and AI insight live in
**Firestore**. Auth is **Firebase**. An **Admin** role monitors usage and governs
per-therapist tool access; a **Subscription** layer (no payments yet) lets therapists request
plans that the admin approves.

---

## 2. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router), React 18, TypeScript 5 | API routes + RSC/client components |
| Styling | Tailwind CSS 3 + CSS variables + inline `style` | Glassmorphism; warm-cream light / dark themes, `darkMode: 'class'` |
| State | Zustand | `useAuthStore` (uid/email/role/profile), `useSessionStore` |
| Auth | Firebase Auth (client) + Firebase Admin SDK (server) | `src/lib/firebase.ts`, `src/lib/firebaseAdmin.ts` |
| Relational DB | Neon PostgreSQL + Prisma 6 | Server-only via `src/lib/db.ts` |
| Vector search | pgvector (1024-dim, cosine, IVFFlat) | `document_chunks.embedding` |
| Realtime DB | Firestore (client + Admin SDK) | `liveSessions/*`, `sessions/*` |
| Video/Audio | LiveKit (`livekit-client`, `@livekit/components-react`) + LiveKit Cloud | SFU |
| Speech-to-text | Sarvam AI `saaras:v3` (browser WebSocket, per-track) | `translate` mode → English; 22 Indian langs + code-switching; 16kHz pcm_s16le. Replaced Deepgram Nova-3. |
| Insight LLM | NVIDIA NIM `meta/llama-3.1-70b-instruct` | live AI insight; JSON out, temp 0.2, ~1024 tokens |
| Report LLM | OpenRouter (`OPENROUTER_MODEL`, default `deepseek/deepseek-chat-v3:free`) | end-of-session English report; OpenAI-compatible, swappable via env |
| Embeddings | NVIDIA NIM `nv-embedqa-e5-v5` | 1024-dim, needs `input_type` |
| Email | Nodemailer (SMTP) | Help/support tickets |
| Hosting | Vercel (+ Vercel Cron) | Daily transcript cleanup 02:00 |

---

## 3. Roles & access model

Three roles on the `User.role` enum: **THERAPIST**, **CLIENT**, **ADMIN**.

- **AuthProvider** (`src/components/AuthProvider.tsx`) resolves the Firebase user → `GET
  /api/users/profile?uid=` → sets `{ role, profile }` in `useAuthStore`. `profile` is the
  role's profile row (`ProfileTherapist` / `ProfileClient` / `ProfileAdmin`).
- **Routing/nav** is role-driven in `Sidebar.tsx` (`therapistNav` / `clientNav` / `adminNav`);
  `src/app/page.tsx` redirects ADMIN → `/admin`.
- **Tool (module) access** is per-therapist: `ProfileTherapist.allModulesAllowed` (true ⇒ all)
  and `moduleAccess: string[]`. Resolved by `resolveAllowedModuleIds()` in `src/lib/modules.ts`
  and enforced by `ModuleSelectorPanel`. Admin edits it directly, or it's set on subscription
  approval.

> ⚠️ **Security posture:** API routes currently **trust client-passed IDs** — there is no
> server-side Firebase ID-token verification or role enforcement yet (the Admin SDK is wired
> for privileged ops like creating admins, but not as a request gate). This is consistent
> across invites/admin/subscriptions and is the top hardening item.

---

## 4. Data model (Prisma / Neon)

Source of truth: `prisma/schema.prisma`. Enums: `Role`, `SessionStatus`, `InviteStatus`,
`SubscriptionStatus`, `SubRequestStatus`.

**Identity & profiles**
- `User` (id = Firebase UID, email, role) → 1:1 `ProfileTherapist` | `ProfileClient` | `ProfileAdmin`.
- `ProfileTherapist`: name, specialty[], qualification/experience/bio, **`allModulesAllowed`**,
  **`moduleAccess[]`**; relations: sessions, notes, bookings, invites, usageEvents,
  **subscriptions**, **subscriptionRequests**.
- `ProfileClient`: name, DOB, gender, diagnosis[], parentEmail.
- `ProfileAdmin`: name. Admins can create more admins.

**Clinical / scheduling**
- `Booking` (therapist↔client, dateTime, duration, status).
- `Session` (therapist↔client, `SessionStatus` SCHEDULED→ACTIVE→COMPLETED/CANCELLED,
  scheduledAt/startedAt/endedAt, confirmedByPatient) → 1:N `TherapistNote`, 1:1 `SessionReport`.
- `TherapistNote` (per session, content, isPrivate).
- `SessionReport` (1:1 with Session, `sessionId @unique`): end-of-session AI report. `content`
  (Markdown, English, therapist-editable), `model`, `aiGenerated`, `editedByTherapist`/`editedAt`,
  `visibleToClient` (false now — lets us expose reports to clients later without a schema change).
- `DocumentChunk` (`document_chunks`): therapist study material — fileName, chunkIndex,
  chunkText, `embedding vector(1024)`, metadata; `@@index([therapistId])`.

**Acquisition**
- `Invite` (token unique, therapist, name, diagnosis[], scheduledAt, `InviteStatus`
  PENDING/CLAIMED/EXPIRED, claimedClientId). Therapist-invites-patient flow.

**Usage telemetry**
- `UsageEvent` (therapist, sessionId?, `type` = AI_ANALYSIS | TRANSCRIPTION | MODULE_LAUNCH,
  label?, count). Accrues **going forward**; powers the admin overview.

**Subscriptions (no payments)**
- `Plan` (name unique, description, `priceMonthly` display-only INR, `durationMonths`,
  `toolQuota Int?` null ⇒ all tools, isActive, sortOrder).
- `Subscription` (therapist↔plan, `SubscriptionStatus`, months, startedAt,
  `currentPeriodEnd`, renewedAt?, renewalCount, moduleAccess[]).
- `SubscriptionRequest` (therapist↔plan, months, modules[], `SubRequestStatus`
  PENDING/APPROVED/REJECTED, note?, reviewedAt?).

> **Dual-DB rationale:** Postgres for relational integrity + vector search; Firestore for
> low-latency `onSnapshot` realtime (room state, transcript, consent, AI insight).

---

## 5. API surface (`src/app/api/**/route.ts`)

**Auth / profile**
- `GET/POST/PUT/DELETE /api/users/profile` — fetch (incl. therapist/client/admin relations),
  create profile (+ claim invite + create assigned session), update, full delete (clears
  dependent rows in a tx, then cascades the user).

**Sessions / scheduling / clients**
- `GET/POST /api/sessions`, `GET + PATCH /api/sessions/[sessionId]` (`action: 'start'|'end'`
  drives ACTIVE/COMPLETED + timestamps), `GET/POST /api/bookings`, `GET /api/clients`,
  `GET/POST /api/notes`.

**Live session / AI**
- `GET /api/livekit-token` — LiveKit join token.
- `POST /api/sarvam-token` — returns the Sarvam STT key for the browser WebSocket (auth-gated).
  ⚠️ Sarvam has no ephemeral-token mechanism + browser WS can't set headers, so the key is
  ultimately a query param (tracked tech debt; route isolates future hardening).
- `POST /api/deepgram-token` — **legacy** (~10s temp key); unused since the Sarvam switch, kept as fallback.
- `POST /api/ai-insight` — gates on AI consent + transcript presence, runs `runAnalysis()`,
  writes `aiInsight` to Firestore, logs an `AI_ANALYSIS` UsageEvent.
- `GET/POST/PATCH /api/session-report` — GET stored report; POST generates/regenerates it
  (full transcript + module events + in-call notes → OpenRouter → upsert `SessionReport`);
  PATCH saves the therapist's edits. Auto-triggered on session End via a `keepalive` POST.
- `GET /api/cleanup-transcripts` — cron; clears transcripts >24h (gated by `CRON_SECRET`).

**Acquisition**
- `POST /api/invites`, `GET /api/invites?therapistId=`, `GET /api/invites/[token]`.

**Admin**
- `GET /api/admin/overview` — per-therapist metrics (clients, sessions, minutes, AI/
  transcript/module usage, invites, docs, access level, last active).
- `PATCH /api/admin/therapists/[id]/access` — set `{ allModulesAllowed, moduleAccess }`.
- `GET/POST /api/admin/admins` — list / create-or-promote admin (Firebase Admin SDK).

**Usage**
- `POST /api/usage` — log a usage event.

**Subscriptions**
- `GET /api/plans` (`?all=1` includes inactive).
- `GET/POST /api/admin/plans`, `PATCH/DELETE /api/admin/plans/[id]` (DELETE soft-disables if referenced).
- `GET /api/subscriptions?therapistId=` (current + pendingRequest + history).
- `POST /api/subscriptions/request` (enforces `toolQuota`, one pending at a time).
- `GET /api/admin/subscriptions` (every pro's current term + pending requests).
- `POST /api/admin/subscriptions/requests/[id]` (`approve`/`reject`; approve expires prior
  ACTIVE term, creates Subscription, writes therapist tool access).
- `PATCH /api/admin/subscriptions/[id]` (`renew`/`cancel`/`reactivate`).

**Support**
- `POST /api/support` — Nodemailer ticket email (`replyTo` = submitter). Needs `SMTP_*`.

---

## 6. RAG + AI pipeline (`src/lib/rag/`)

| Module | Role |
|---|---|
| `chunker.ts` | 400-word chunks, 80-word overlap |
| `nvidia-client.ts` | NVIDIA NIM embedding + LLM wrappers |
| `ingest.ts` | PDF → chunk → embed → pgvector |
| `retrieval.ts` | 3-source context: Firestore transcript + pgvector study material (top-3, cosine > 0.25) + last 3 notes |
| `prompt.ts` | `SYSTEM_PROMPT` + `buildAnalysisPrompt()` (client/session context, transcript, study material, prior notes, available module names) |
| `analysis.ts` | `runAnalysis()` — retrieve → prompt → LLM → parse/validate |
| `transcription.ts` | Deepgram WebSocket class (Node) |
| `transcript-store.ts` | Firestore CRUD (Admin SDK), `checkAIConsent`, `getSessionTranscript` |
| `types.ts` | `TranscriptChunk`, `AIInsight`, etc. |

**AIInsight contract (JSON):** `{ emotions[], summary, steps[], module, riskFlag, riskDetail }`.
`riskFlag` must trip on any self-harm/suicide/violence/danger signal (even indirect),
otherwise conservative-false. Live transcription runs **therapist-browser-only** (cost +
dedupe). Speaker labelling is now **per-track** (one Sarvam socket per LiveKit participant —
therapist mic → `therapist`, client mic → `client`), so labels are exact, not diarized guesses.

**End-of-session report pipeline (`src/lib/report/`):**
| Module | Role |
|---|---|
| `session-data.ts` | Admin-SDK read of `sessions/{id}` → transcript + `moduleEvents` + `therapistNotes` |
| `openrouter-client.ts` | OpenAI-compatible OpenRouter client; `REPORT_MODEL` from `OPENROUTER_MODEL` |
| `generate.ts` | `REPORT_SYSTEM_PROMPT` + `generateSessionReport()` → structured English Markdown report |

Inputs all live on one Firestore doc: the (English) `transcript[]`, the `moduleEvents[]`
activity timeline (`src/lib/sessionEvents.ts` `logModuleEvent()`), and `therapistNotes[]`
(appended by `NotesPanel`). The report is generated on Session End (and on first view if
missing / on Regenerate), persisted to Postgres `SessionReport`, and edited via the report
drawer in `/sessions`.

**Module activity logging:** `logModuleEvent(sessionId, {module, type, detail})` appends to
`sessions/{id}.moduleEvents[]` from the single actor's browser (no dupes). Wired so far into
Whack-a-Mole Math, Social Story Sequencing, Virtual Shop, and Defusion River; expand to more
modules by adding one call at each meaningful client action.

---

## 7. Live session room

Route: `src/app/session/[sessionId]/page.tsx` (large, deliberately the source of truth for
session logic — other session components avoid editing its logic). Tree:
`StaadVideo` (`<LiveKitRoom>` + `RoomCtx`) → TopBar / Video area
(`RemoteVideoArea`, `LocalVideoPip`, `AIInsightBar`, `ModuleSelectorPanel`, `NotesPanel`,
`ReactionOverlay`) / `GlassModulePanel` (renders active module) / `AIConsentBanner` / BottomBar.

Firestore docs per session: `liveSessions/{id}` (activeModuleId, therapistControl lock,
participants, timestamps, per-module `moduleState`) and `sessions/{id}` (aiConsent,
transcript[], aiInsight, transcriptLastUpdated, **moduleEvents[]** activity timeline,
**therapistNotes[]** in-call notes). Lifecycle also updates the Postgres `Session`
(start/end) so completed sessions surface in client history, and triggers `SessionReport`
generation on End.

**Therapy modules:** canonical registry in `src/lib/modules.ts` —
`MODULE_CATEGORIES` (SLD, ADHD, Anxiety & Depression, ID, General), `ALL_MODULE_IDS`,
`resolveAllowedModuleIds()`. ~24 modules implemented under `src/components/modules/**`
(plus a few legacy top-level module files). Module ids in the registry must match what
`GlassModulePanel` switches on / `ModuleSelectorPanel` launches.

---

## 8. Frontend pages (`src/app/**/page.tsx`)

Dashboard `/` (role-aware), `/auth`, `/onboarding`, therapist: `/clients` `/sessions`
`/schedule` `/modules` `/plans` `/profile`, client: `/my-sessions` `/progress`, shared
`/help`, admin: `/admin` `/admin/subscriptions` `/admin/plans` `/admin/admins`. All
non-auth pages wrap in `DashboardLayout` (fixed `Sidebar`, 220px offset). Theming is
token-driven via `globals.css` (`--page-bg`, `--ink`, `--sage`, `--glass-*`, `--c-accent`),
`darkMode: 'class'` toggled by `ThemeProvider`.

---

## 9. Environment, scripts, infra

**Env vars:** `DATABASE_URL`; `LIVEKIT_API_KEY/SECRET`, `NEXT_PUBLIC_LIVEKIT_URL`;
`NVIDIA_API_KEY`; `SARVAM_API_KEY` (live STT); `OPENROUTER_API_KEY` + optional
`OPENROUTER_MODEL`/`OPENROUTER_SITE_URL` (report LLM); `DEEPGRAM_API_KEY/PROJECT_ID` (legacy);
`CRON_SECRET`; `SMTP_HOST/PORT/USER/PASS/FROM`;
`FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`.

**Scripts:** `dev`/`build`/`lint`/`start`; RAG/infra tests
(`test:pgvector|nvidia|ingest|transcription|retrieval|analysis|e2e`, `debug:embedding|models`,
`setup:pgvector`); seeds `seed:admin` (bootstrap admin) and `seed:plans` (Base/Pro/Unlimited).

**Cron:** `vercel.json` → `/api/cleanup-transcripts` daily at `0 2 * * *`.

**Local DB workflow:** edit `schema.prisma` → `npx prisma db push` → `npx prisma generate`.
On Windows, `generate` hits an **EPERM lock** on `query_engine-windows.dll.node` while a
`next dev` server is running — **stop the dev server first**. Verify with `npx tsc --noEmit`.

---

## 10. Known technical debt / follow-ups

- **No server-side auth/role enforcement** — routes trust client IDs (Firebase Admin SDK
  available to wire as a gate).
- **Subscriptions don't auto-expire** — a term past `currentPeriodEnd` simply stops counting
  as "current"; no scheduled job revokes access. **No payment integration** (`priceMonthly`
  is display-only).
- **UsageEvents accrue forward only** (no backfill).
- **`ScriptProcessorNode`** (deprecated) for audio capture — migrate to `AudioWorklet` for
  production.
- **Sarvam key exposure** — the STT key reaches the browser as a WS query param (no ephemeral
  token available). `/api/sarvam-token` isolates it; harden via Sarvam ephemeral tokens or a
  server audio proxy when available.
- **Report generation is unverified at runtime** — built + type-checked but not yet run against
  live Sarvam/OpenRouter; confirm the Sarvam result field (`transcript` vs `translation`) and
  the report flow in a real session.
- **Report auto-gen relies on `keepalive`** at session End (within the 24h transcript TTL); on
  serverless this should later move to a proper background job/queue.
- **Invite flow** has no time picker (`scheduledAt` defaults to now).
- **CSS quirks:** `--accent` declared twice in `:root` (hex overrides HSL); dashboard cards
  use `bg-white` rather than the `--card` token.
- **Windows EPERM** Prisma generate lock (workflow note above).
