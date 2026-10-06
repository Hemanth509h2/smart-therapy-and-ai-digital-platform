# STAAD — Security Audit v2

**Date:** 2026-10-06 (evening) · **Scope:** full repo — backend API routes, custom server, WhatsApp bot, Firestore/RTDB rules, frontend auth/token handling, guest invite flow, dependencies
**Method:** manual review + two independent automated codebase sweeps; all critical claims re-verified against source.
**Supersedes:** `SECURITY_AUDIT_REPORT.md` (same-day morning audit). Items V-01…V-14 there are cross-referenced below.

> ⚠️ **Context — `AUTH_DISABLED`:** the backend `.env` currently contains `AUTH_DISABLED=true`, a dev bypass added today because this machine's network cannot reach Google APIs (token verification impossible). With it on, `requireAuth` trusts the `x-dev-uid` header. **This must never reach production** — see C-08.

---

## Fixed today (before this audit)

| Fix | Where |
|---|---|
| `/api/users/profile` (GET/POST/PUT/DELETE) verified Firebase ID token; uid/email from token, not client input (was: full IDOR — read/edit/delete any account) | `api/users/profile/route.ts`, `lib/apiAuth.ts` |
| `apiFetch` attaches `Authorization: Bearer <idToken>` automatically | `frontend/src/lib/api.ts` |
| `invites` POST, `stt-token`, `whatsapp/invite`, all `progress/*` now verify via shared `requireAuth`/`requireTherapist` with ownership checks | respective routes |
| Account-deletion order fixed (server data deleted before Firebase user) | `frontend/src/app/profile/page.tsx` |
| Prisma query logs silenced; request logging added (path-only after this audit — see M-07) | `lib/db.ts`, `server.js` |

---

## CRITICAL

### C-01 · All `/api/admin/*` routes are unauthenticated → total admin takeover
- **Where:** `src/app/api/admin/admins/route.ts` (GET/POST), `admin/overview`, `admin/plans(+[id])`, `admin/subscriptions(+[id], requests/[id])`, `admin/therapists/[id](+/access)` — no `requireAuth` anywhere.
- **Evidence:** `POST /api/admin/admins` takes `{email, password}` and calls `auth.createUser()` + `prisma.user.upsert({ role: 'ADMIN' })` with zero checks (`admins/route.ts:31-63`). It even resets the password of an existing Firebase user by email.
- **Impact:** anyone on the internet can create/promote admins, read every therapist + client dossier (`admin/overview`, `admin/therapists/[id]` returns client names + **diagnoses**), edit plans, and — combined with unauthenticated `POST /api/subscriptions/request` + `POST /api/admin/subscriptions/requests/[id] {action:'approve'}` — **self-approve an unlimited subscription**. (V-01)
- **Fix:** verify Firebase ID token + require `User.role === 'ADMIN'` (or `ADMIN` custom claim) on every handler. One shared `requireAdmin()` next to `requireAuth`.

### C-02 · LiveKit tokens minted for anyone, with role forgery and room admin
- **Where:** `src/app/api/livekit-token/route.ts` — no auth at all; `room`, `name`, `role` taken from the query string; `roomAdmin: role === 'therapist'` (line 70).
- **Impact:** `GET /api/livekit-token?room=<sessionId>&name=x&role=therapist` → join **any live therapy room as admin** — watch/listen/record real sessions. Session ids are enumerable via C-01 (`GET /api/sessions?therapistId=…`) or a leaked invite. Worst PHI breach vector in the system. (V-05)
- **Fix:** `requireAuth`; derive room/role server-side from the DB session (caller must be that session's therapist or client). Never sign role/admin from client input.

### C-03 · Mass PHI exposure: unauthenticated patient-data routes
- **Where / evidence:**
  - `GET /api/clients` with **no params returns every client** incl. user emails, DOB, diagnoses, phone numbers (`clients/route.ts:52-56`, comment says "Backward-compatible").
  - `GET /api/sessions?therapistId=|clientId=` — full session lists with client PII, no auth.
  - `GET /api/sessions/[sessionId]` — session + full client + therapist, no auth.
  - `GET/POST /api/notes?sessionId=` — read **and write** confidential clinical notes, no auth.
  - `GET /api/bookings?…` — booking lists with PII, no auth. `POST` forges bookings.
  - `GET /api/progress-features/reports/[clientId]` — **downloadable clinical PDF**, no auth; `progress-features/measurement/[clientId]` likewise.
  - `GET/PATCH /api/session-report` — read/overwrite AI session reports, no auth.
- **Impact:** complete patient-database harvest with zero credentials. (V-07)
- **Fix:** `requireAuth` everywhere + per-resource ownership (therapist may only see own clients; client only own data; admin via `requireAdmin`).

### C-04 · Stored XSS: `eval()` on peer-controlled module state
- **Where:** `frontend/src/components/modules/TalkingCalculatorModule.tsx:45` — `eval(state.display)`.
- **Mechanism:** `state.display` syncs via Firestore `moduleStates/{sessionId}_talking_calculator`, writable by **any session member with no schema validation** (`firestore.rules:128-132`). A malicious peer (including a guest holding a leaked invite link, see C-05) writes JavaScript into `display`; when the victim presses `=`, it executes **in the victim's browser** → Firebase token theft, session hijack, PHI access. (V-02)
- **Fix:** delete `eval` — parse arithmetic with a safe evaluator (e.g. mathjs, or a tiny recursive-descent parser); validate `moduleStates` writes in rules (field types/lengths).

### C-05 · Invite tokens harvestable; invites never expire; guest rejoin is a permanent skeleton key
- **Where:**
  - `GET /api/invites?therapistId=` — **no auth**, returns invite rows **including the secret `token`** and patient phone numbers (`invites/route.ts:55-71`).
  - `POST /api/invites` never sets `expiresAt`; nothing ever sets it anywhere (`schema.prisma:217` nullable; the `expiresAt` check in `join/route.ts:38` is dead). No revocation, no max-claims, no single-use.
  - `POST /api/invites/[token]/join` (new guest flow) returns the same `sessionId` forever and unions any caller-supplied `guestUid` into `liveSessions.allowedUids`.
  - `GET /api/invites/[token]` returns patient name + **diagnosis** to any link holder.
- **Impact:** enumerate therapist ids (C-01) → harvest all invite tokens → join every patient's session as "the client", read session transcript/notes/insight via Firestore — **indefinitely**. (Existed as token leak before; guest join made it weaponizable.)
- **Fix:** auth + ownership on `GET /api/invites`; set `expiresAt` (e.g. 7 days) at creation and honor it; consider single-use `maxClaims`/revocation; return minimal fields from `GET /api/invites/[token]` (drop diagnosis).

### C-06 · Unauthenticated paid-relay abuse: Sarvam WS proxy + Deepgram + LLM routes
- **Where:**
  - `server.js:131-142` — `/api/sarvam-stream` WebSocket upgrade has **no authentication** (code admits it in a TODO). Anyone relays unlimited STT through your paid Sarvam key. (V-04)
  - `POST /api/deepgram-token` — only checks an `Authorization` header **exists**, never verifies it (route.ts:8-14); `Authorization: x` mints real Deepgram keys. (V-06)
  - `POST /api/ai-insight`, `POST /api/session-report` — unauthenticated LLM generation (consent gate is Firestore-writable by any session member, rules:94).
  - `POST /api/sessions` — sends real **WhatsApp messages** via Twilio, unauthenticated (spam at your expense).
- **Fix:** verify the HMAC `STT_TOKEN` on the WS proxy (mirror `whatsapp-bot/index.js:258-262`, which does it correctly); `requireAuth` + ownership on the rest.

### C-07 · Production secrets must be considered compromised
- `backend/.env` was committed to git history in the past (V-03: commits `e456da2`, `d395d95`) — recoverable from any clone/fork/cache. Exposed: `DATABASE_URL`, `FIREBASE_PRIVATE_KEY` (full service account), `TWILIO_AUTH_TOKEN`, `LIVEKIT_API_SECRET`, `SARVAM_API_KEY`, `DEEPGRAM_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`.
- Also: `CRON_SECRET=staad-cron-secret-dev-only` (guessable → unauthenticated transcript wipe via `GET /api/cleanup-transcripts`); `scripts/seed-admin.cjs` defaults to password **`123456`** and resets the account's password.
- **Fix:** rotate **all** of the above now (Neon, Firebase service account, Twilio, LiveKit, Sarvam, Deepgram, NVIDIA, OpenRouter); strong `CRON_SECRET`; require `SEED_ADMIN_PASSWORD` with no fallback. (Firebase *web* apiKey in `firebase.ts`/docs is public-by-design — informational only.)

### C-08 · `AUTH_DISABLED=true` is a production kill-switch
- **Where:** `backend/.env:66` (`AUTH_DISABLED=true` today, dev); `src/lib/apiAuth.ts:24-37` — bypass trusts `x-dev-uid` header **or `?uid=` query param** with **no `NODE_ENV`/production guard**; `src/middleware.ts` allows those headers in CORS, so **any website** could drive it cross-origin from a victim's browser.
- **Impact if shipped:** every token-protected route (profile, invites POST, stt-token, progress/*, whatsapp/invite) accepts one-header impersonation of any therapist/admin. Silent — the frontend sends `x-dev-uid` automatically (`api.ts:34`).
- **Fix:** hard-refuse the bypass when `NODE_ENV === 'production'` (fail fast at boot); strip `x-dev-uid` from CORS allow-headers; set `AUTH_DISABLED=false` in any deployed env; keep `true` only in local `.env`.

---

## HIGH

| # | Finding | Evidence | Fix |
|---|---|---|---|
| H-01 | `PATCH /api/sessions/[sessionId]` unauthenticated — anyone can start/**end/cancel/reschedule any session** (disrupt live therapy) | `sessions/[sessionId]/route.ts:30` | `requireAuth` + participant check |
| H-02 | Firestore `sessions` update has **no field restrictions**: any session member can rewrite `transcript`, `therapistNotes`, `aiInsight`, and flip the **other party's** `aiConsent` | `firestore.rules:94`; consent write at `app/session/[sessionId]/page.tsx:457` | Field-level rules: consent writable only under own role key; transcript/notes append-only by writer role |
| H-03 | `patients/{uid}`: any THERAPIST reads/writes ANY patient | `firestore.rules:141-152` | `allowedUids` per-therapist assignment list (V-09) |
| H-04 | `moduleStates` writes unvalidated → feeds C-04 eval sink | `firestore.rules:128-132` | Schema validation in rules |
| H-05 | `progress/*` POSTs: therapist can write metrics/notes/reports onto **any** client (existence-only check) | `progress/metrics/route.ts:72-75` etc. | Verify client has a session with the calling therapist |
| H-06 | RTDB has **no deployed rules** (`database.rules.json` absent; `firebase.json` declares none). Instance state unknown — if test mode, world read/write | `firebase.json`, RTDB init in `src/lib/firebase.ts:9` | Add deny-by-default `database.rules.json` + wire into `firebase.json` (or remove dead RTDB code) (V-13) |
| H-07 | `POST /api/support` — anonymous SMTP relay + **HTML injection** (`name`/`subject` interpolated unescaped into email HTML; only `message` is escaped) | `support/route.ts:74-92` | Escape all fields, validate email, rate-limit, CAPTCHA |
| H-08 | `POST /api/usage`, `POST /api/subscriptions/request`, `GET /api/subscriptions` — unauthenticated stat forging / billing-data disclosure | respective routes | `requireAuth` + ownership |
| H-09 | No rate limiting anywhere (login, invites, join, support, token mints) | whole API | Add per-IP/user rate limiting (esp. public endpoints) |

## MEDIUM

| # | Finding | Evidence | Fix |
|---|---|---|---|
| M-01 | Guest `guestUid` never verified against Firebase (any string accepted) — token-as-capability design, but it means an invite holder can attach **arbitrary** uids to `allowedUids` | `invites/[token]/join/route.ts:26,99` | Verify the anonymous session (verifyIdToken when available) or sign a short-lived guest grant server-side |
| M-02 | STT token passed in **WebSocket URL query** → lands in access logs/history | `useSessionTranscription.ts:52` | Move token to first WS message; until then, path-only request logging (done in this commit) |
| M-03 | No security headers (CSP, X-Frame-Options, …) on frontend or backend | `frontend/next.config.mjs`, no backend config | Add headers middleware (V-14) |
| M-04 | `apiFetch` silently swallows `getIdToken()` failure → request goes out unauthenticated and fails later, masking the cause | `frontend/src/lib/api.ts:27` | Surface a console warning when token fetch fails |
| M-05 | `NEXT_PUBLIC_STT_TEST_MODE=true` currently on — bypasses the AI-consent gate client-side | `frontend/.env:2` | Set `false` outside local dev |
| M-06 | CORS `Access-Control-Allow-Origin: *` for all `/api/*` (recent local edit). Bearer-token APIs are not directly rideable cross-origin, but combined with C-08 it arms the bypass from any website | `src/middleware.ts:21` | Allow-list real frontend origins; keep `*` only for local dev |
| M-07 | ~~Request logging wrote full URLs incl. `?token=`~~ | `server.js` | **Fixed in this commit — path-only logging** |
| M-08 | `GET /api/cleanup-transcripts` cron uses header secret comparison (non-timing-safe) | `cleanup-transcripts/route.ts:16` | timingSafeEqual + strong secret |

## LOW / HYGIENE

- **L-01** `next ^14.2.35` — old 14.2.x line; upgrade to latest 14.2.x (or 15.x) to pick up security patches; run `npm audit` regularly (registry was unreachable from this network, so no fresh advisory count).
- **L-02** `eslint ^8` EOL; `@whiskeysockets/baileys 6.7.24` pinned; `firebase-tools` dev dep — review on next dep pass.
- **L-03** Signup role self-selection (`POST /api/users/profile` accepts `THERAPIST`) — by design today, but therapist verification/vetting is a business-risk decision worth revisiting.
- **L-04** Dead client code (`sessionSync.initLiveSession`) attempts rule-denied writes — fails closed; remove to avoid confusion.
- **L-05** `.env.example` files are clean; `.gitignore` correctly excludes `.env*` — verified.

---

## Top exploit chains today (zero credentials)

1. **Admin takeover:** `POST /api/admin/admins {email,password}` → admin. (C-01)
2. **Watch a live therapy session:** `GET /api/sessions?therapistId=X` → `GET /api/livekit-token?room=<id>&role=therapist` → join as admin. (C-01+C-02)
3. **PHI harvest:** `GET /api/clients` → `GET /api/progress-features/reports/[id]` (PDF) + `GET /api/notes?sessionId=`. (C-03)
4. **Patient impersonation:** `GET /api/invites?therapistId=X` → harvest token → `POST /api/invites/<token>/join` → in-room as "client", Firestore transcript access, potential C-04 XSS on the therapist. (C-05)
5. **Bill burning:** Sarvam WS relay, Deepgram mints, `ai-insight`/`session-report` LLM calls, Twilio WhatsApp sends. (C-06)

## Remediation priority

- **P0 (this week):** C-01 admin auth, C-02 livekit-token, C-03 patient-data routes, C-04 remove `eval`, C-05 invites GET auth + expiry, C-07 rotate all secrets, C-08 production guard on AUTH_DISABLED.
- **P1:** C-06 proxy/token verification, H-01 session PATCH auth, H-02/H-03/H-04 Firestore rule tightening, H-07 support hardening.
- **P2:** rate limiting (H-09), security headers (M-03), RTDB rules (H-06), M-01/M-02, dependency upgrades.
