# Production Configuration Plan: 80–100 Users

**Date:** 2026-10-12 · **For:** backend team · **Status:** draft for discussion

> These numbers are estimates from reading the code and making the usage assumptions below. Nothing has been load-tested. Vendor prices change, so the cost column is left for the team to fill in from each vendor's current pricing page.

---

## 0. Assumptions

| Item | Assumption |
|---|---|
| Users | ~100 total: **~15 therapists + ~85 patients** |
| Sessions | Each patient has 1–2 sessions/week → **~600 sessions/month** |
| Session length | ~45 min, 2 participants (therapist + patient) |
| Peak concurrency | At most one live session per therapist → **plan for 15 concurrent sessions** (30 people in calls) |
| AI usage | Most sessions consent to AI. ~3 copilot "Analyse" clicks per session; 1 report per session |
| Location | Users in India |

If these assumptions change (e.g. 30 therapists), scale sections 2–3 linearly.

---

## 1. Current deployment and what changes

| Piece | Today (from repo) | At 100 users |
|---|---|---|
| Frontend (`frontend/`) | Next.js, Vercel | Same. **Vercel Pro** is required: Hobby is for non-commercial use only |
| Backend API (`backend/`) | Next.js API routes on **Vercel** (`backend/vercel.json` crons) | Same, on Vercel **Pro**. Set function region and timeouts (§3.1) |
| STT relay (Sarvam WebSocket) | `backend/server.js` (local only). Prod uses `NEXT_PUBLIC_STT_RELAY_URL` (Fly.io). **The relay code that verified tokens was removed from `whatsapp-bot/` in `e349a2e`, so the repo has no deployable relay that verifies tokens** | Deploy a **dedicated, always-on relay** that verifies `STT_TOKEN_SECRET` (§3.3) |
| WhatsApp | Baileys bot (`whatsapp-bot/`) on Railway, 1 replica | Move to the **official WhatsApp Cloud API** (`lib/whatsapp-cloud-api.ts` already exists) (§3.6) |
| Postgres | Neon (+ pgvector) via Prisma | Neon **paid plan**, pooled connection string (§3.2) |
| Auth / realtime | Firebase Auth + Firestore | Firebase **Blaze** (pay-as-you-go) (§3.4) |
| Video | LiveKit Cloud | LiveKit Cloud paid tier (§3.5) |
| STT | Sarvam `saaras:v3` (translate) | Same; check the concurrent-stream limit (§3.5) |
| LLM | OpenRouter **free** Nemotron models + NVIDIA embeddings | **Paid model with zero data retention** (§3.7) |

---

## 2. Monthly usage estimate

| Resource | Calculation | Estimate / month |
|---|---|---|
| Session-minutes | 600 × 45 min | **27,000** |
| LiveKit participant-minutes | 27,000 × 2 participants | **~54,000** |
| Sarvam audio-minutes | 2 streams per session (therapist mic + patient mic, `useSessionTranscription.ts`) | **~54,000 min ≈ 900 h** |
| STT relay bandwidth | Each stream sends raw 16 kHz 16-bit PCM as base64 JSON ≈ **~340 kbps**. 2 streams per session, traffic both in and out of the relay | **~140 GB in + ~140 GB out**; peak ≈ **10 Mbps each way** at 15 sessions |
| Firestore writes | Transcript ~8 lines/min/session + room/module state + attention log | **~0.5–1.5 M writes** (busy days exceed the free-tier limit of 20k/day) |
| LLM calls | 600 reports + 1,800 copilot clicks × 2 (each click also runs a safety scan) | **~4,200 calls** (~140/day); report prompts ~8–10k tokens each |
| Postgres | Users, sessions, reports, embeddings | < 2 GB storage, low CPU |
| WhatsApp messages | Booking confirmation + join link per session | **~1,200 messages** |

> ⚠️ **Correction to `VPS_HOSTING_REQUIREMENTS.md`:** that doc says 32–64 kbps per session for the audio relay. The code sends **uncompressed PCM**, which is ~340 kbps per stream, about 5–10× more. The **therapist's own internet upload** also carries this extra ~0.7 Mbps on top of video. A later optimisation could resample or encode before sending.

---

## 3. Configuration per component

### 3.1 Vercel (frontend + backend)

- Plan: **Pro** (commercial use, longer function timeouts, and cron jobs can run more often than once a day).
- Region: run functions **close to the database**. In `backend/vercel.json`:
  ```json
  {
    "regions": ["bom1"],
    "crons": [
      { "path": "/api/cleanup-transcripts", "schedule": "0 2 * * *" },
      { "path": "/api/cron/subscriptions", "schedule": "30 2 * * *" }
    ]
  }
  ```
  If Neon is in Singapore, use `sin1` instead. Function and database must be in the same region.
- Timeouts: LLM routes can run for 20–60 s. Add to these route files:
  ```ts
  export const maxDuration = 60
  ```
  → `api/session-report/route.ts`, `api/ai-insight/route.ts`, `api/progress-features/reports/[clientId]/route.js` (PDF generation).
- The end-of-call report is fired with `keepalive` from the browser. Add a server-side safety net: if a session is `COMPLETED` with no `SessionReport`, the cron generates the report **before** the 24h transcript cleanup.

### 3.2 Neon Postgres

- Plan: the **paid tier** (for point-in-time restore and to avoid scale-to-zero cold starts during clinic hours).
- Compute: **0.25–1 CU autoscaling**. Set **minimum 0.5 CU from 8am to 10pm IST**, or turn off scale-to-zero.
- Connections: Vercel functions open many short-lived connections, so **use the pooled endpoint**:
  ```env
  # runtime (pooled, PgBouncer)
  DATABASE_URL=postgresql://USER:PASS@ep-xxx-pooler.REGION.aws.neon.tech/staad?sslmode=require&pgbouncer=true&connection_limit=3
  # migrations only (direct)
  DIRECT_URL=postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/staad?sslmode=require
  ```
  and in `prisma/schema.prisma`:
  ```prisma
  datasource db {
    provider  = "postgresql"
    url       = env("DATABASE_URL")
    directUrl = env("DIRECT_URL")
  }
  ```
- Backups: turn on PITR (7+ days). Also run a **weekly `pg_dump`** to separate storage.
- Run `npx prisma migrate deploy` in CI, not `db push`.

### 3.3 STT relay (new, dedicated service)

Vercel can't host WebSockets, so the relay needs its own always-on host. Suggested: **Fly.io, region `bom` (Mumbai)**.

- What it must do: (1) **verify the HMAC token** from `/api/stt-token` (`lib/stt-token.ts` format: `base64url(payload).base64url(hmac)`, check `exp`, check `sid` matches); (2) relay to `wss://api.sarvam.ai/speech-to-text/ws` with `api-subscription-key`; (3) limit to 2 streams per `sid`.
- Size: 15 sessions × 2 streams = **30 WebSockets, ~10 Mbps each way**. Mostly I/O, so a small machine is enough:
  ```toml
  # relay/fly.toml
  app = "staad-stt-relay"
  primary_region = "bom"

  [http_service]
    internal_port = 8080
    force_https = true
    auto_stop_machines = "off"
    min_machines_running = 2      # 2 machines in case one restarts mid-session

  [[vm]]
    size = "shared-cpu-1x"
    memory = "512mb"

  [[http_service.checks]]
    path = "/health"
    interval = "15s"
    timeout = "5s"
  ```
- Env: `SARVAM_API_KEY`, `STT_TOKEN_SECRET` (the same value as on Vercel), `ALLOWED_ORIGINS=https://app.staad.in`.
- Upgrade when CPU stays above 60% or concurrent sessions exceed ~40: move to `shared-cpu-2x` / 1 GB.

### 3.4 Firebase

- Plan: **Blaze** (pay-as-you-go). The free plan's 20k writes/day runs out on busy days, and when it does transcription writes start failing silently (the client only logs a warning).
- Set a **budget alert** in Google Cloud Billing (e.g. warn at 50% / 90% of the expected monthly amount).
- Deploy rules: `firebase deploy --only firestore:rules,firestore:indexes` from `backend/`.
- Authorized domains: add the production frontend domain only, and remove `localhost` from the production project.
- Backups: a **daily scheduled Firestore export** to a GCS bucket in the same region, with a 30-day lifecycle rule. Transcripts are already deleted at 24h, so this mainly protects `moduleEvents`, `therapistNotes`, `reportStats` and `rawSessionLog`.
- Document size: each session's transcript sits in one Firestore document, which has a 1 MB limit. A 45-min session is ~70–100 KB, so this is fine, but sessions over ~6 hours would hit the limit.

### 3.5 LiveKit + Sarvam

- **LiveKit Cloud:** ~54k participant-minutes/month. Pick the tier that covers this with room to spare, and set a usage alert. **Do not self-host at this scale.**
- **Sarvam:** ~900 audio-hours/month, **30 concurrent streams at peak**. Confirm that the account's **concurrent WebSocket limit** is at least 30 (40+ to be safe) and ask Sarvam for a rate-limit increase if needed. Also ask whether they offer data-retention or no-training terms for medical audio.

### 3.6 WhatsApp

- The Baileys bot is an unofficial client: **the number can be banned** and it needs a QR re-login. At ~1,200 messages/month, move to the **WhatsApp Cloud API** (Meta) with approved templates for "session booked" and "join link". The code for this already exists in `lib/whatsapp-cloud-api.ts`.
  ```env
  WHATSAPP_ACCESS_TOKEN=        # permanent System User token
  WHATSAPP_PHONE_NUMBER_ID=
  ```
- Keep the Railway bot only as a fallback, or switch it off.

### 3.7 LLM (OpenRouter / NVIDIA)

- **Stop using the `:free` models in production.** Two reasons:
  1. **Limits:** free models are heavily rate-limited (a small daily request cap per account). That is far below the ~140 calls/day estimated above, so reports and copilot would start failing.
  2. **Privacy:** free providers may log or train on prompts, and these prompts contain patient transcripts.
- Config:
  ```env
  OPENROUTER_MODEL=<paid model for reports>
  OPENROUTER_COPILOT_MODEL=<fast paid model for in-call copilot>
  ```
  In the OpenRouter account settings, **turn off prompt logging and allow only zero-data-retention providers**.
- Put a monthly spend cap on the OpenRouter key.
- NVIDIA embeddings (`NVIDIA_API_KEY`) are only used for RAG study-material lookups, so usage is low. Check the free-tier limits.

---

## 4. Production environment checklist (`backend` on Vercel)

| Variable | Production value |
|---|---|
| `AUTH_DISABLED` | **unset / `false`**. The backend should also refuse to start if this is `true` in production (audit C-08) |
| `NEXT_PUBLIC_STT_TEST_MODE` (frontend) | **`false`** |
| `DATABASE_URL` / `DIRECT_URL` | Neon pooled / direct (§3.2) |
| `FIREBASE_*` | **new** service-account key (the old one leaked in git history) |
| `STT_TOKEN_SECRET` | 32+ random bytes, same value on the relay |
| `NEXT_PUBLIC_STT_RELAY_URL` | `https://staad-stt-relay.fly.dev` (or a custom domain) |
| `CRON_SECRET` | 32+ random bytes (the current value is a guessable dev string) |
| `APP_URL` | `https://app.staad.in` (or the real domain) |
| `LIVEKIT_*`, `SARVAM_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY` | **rotated** keys |
| `DEEPGRAM_*` | remove (not used in the live flow) |
| `SEED_ADMIN_PASSWORD` | strong value; never the `123456` fallback |

Generate secrets with: `openssl rand -base64 32`

---

## 5. Must be done before real patients onboard

From `SECURITY_AUDIT_2026-10-06_v2.md` and `TRANSCRIPT_STT_HIPAA_ANSWERS.md`. Scaling infrastructure won't help if these are still open:

1. Add auth + ownership checks to `clients`, `sessions`, `sessions/[id]`, `bookings`, `session-report`, `ai-insight` and **`livekit-token`**.
2. The STT relay verifies its token (§3.3).
3. **Rotate every secret** that was ever committed (C-07).
4. Production guard on `AUTH_DISABLED` (C-08).
5. Restrict CORS from `*` to the real frontend domain (`backend/src/middleware.ts`).
6. Rate limiting on public endpoints (`invites/[token]`, `support`, token mints). The Vercel Firewall or Upstash Redis rate limiting is enough at this size.
7. Paid, zero-retention LLM models (§3.7).

---

## 6. Monitoring & operations

| What | Tool / setting |
|---|---|
| Errors (frontend + API) | **Sentry** (free/dev tier is enough at 100 users) |
| Uptime | Uptime check every 1 min on: frontend, `GET /api/admin/health` (or a public `/api/health`), relay `/health` |
| Cron success | `CronRun` table already records runs. Alert if `cleanup-transcripts` hasn't succeeded in 26h |
| Cost alerts | Budget alerts on Google Cloud, Vercel spend limit, OpenRouter key cap, LiveKit usage alert |
| Logs | Vercel log drain (Pro) or Axiom; Fly logs for the relay. **No transcript text or tokens in logs** |
| On-call | One named person per week for clinic hours (patients are in live sessions) |

---

## 7. When to upgrade (next step: ~300–500 users)

| Signal | Action |
|---|---|
| Peak concurrent sessions > 40 | Relay → 2× `shared-cpu-2x`; raise the Sarvam concurrency limit |
| Neon CPU > 70% at peak or p95 query time > 200 ms | Raise min CU; add indexes (`Session.therapistId`, `Session.clientId`, `Session.scheduledAt`) |
| `GET /api/clients?therapistId=` slow | It runs one query per client (N+1). Rewrite as a single query with `_count` / aggregation |
| Firestore writes > 5 M/month | Batch transcript lines (e.g. flush every 5 s) instead of one write per line |
| LLM cost noticeable | Cache copilot results per transcript window; use a smaller model for the safety scan |

---

## 8. Open questions for the team

1. Is the Fly.io relay currently deployed? If so, which code is running, given that the relay was removed from `whatsapp-bot/` in `e349a2e`?
2. Which Neon region is the database in? (This decides the Vercel function region.)
3. Which Firestore location was the Firebase project created in? (It can't be changed later; data residency question.)
4. Is the target 100 **total** users or 100 **concurrent** users? This plan assumes total. 100 concurrent would mean ~50 live sessions and roughly 3× the relay, Sarvam and LiveKit capacity.
