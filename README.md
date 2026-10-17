# STAAD — Smart Therapy & AI Digital Platform

Monorepo with three deployables that talk **only over HTTP/WebSocket**:

```
├── frontend/   # Next.js UI (pages, components, hooks, store) — port 3000
│   └── src/lib/api.ts        # apiFetch(): prefixes NEXT_PUBLIC_API_URL
├── backend/    # Next.js API server (app/api routes + Prisma) — port 4000
│   ├── server.js             # custom server entry (network tweaks + request logging)
│   ├── src/middleware.ts     # CORS headers for cross-origin frontend calls
│   ├── src/app/api/          # route handlers (folder path = URL, so these don't move)
│   ├── src/lib/              # shared server code, grouped by feature:
│   │   ├── core/             #   db, Firebase Admin, settings, app URL, phone
│   │   ├── http/             #   auth guards (apiAuth, progressAuth), error responses
│   │   ├── admin/            #   admin roles, list helpers, audit log
│   │   ├── billing/          #   Cashfree, coupons, subscriptions
│   │   ├── sessions/         #   provisioning, STT token, transcript crypto, attention
│   │   ├── modules/          #   therapy module library
│   │   ├── progress/         #   progress measurement + reports
│   │   ├── ai/rag/           #   in-call copilot (retrieval, safety, prompt, ingest)
│   │   ├── ai/report/        #   end-of-session report generation (OpenRouter)
│   │   ├── messaging/        #   WhatsApp Cloud API + bot
│   │   └── automation/       #   n8n automation endpoints' logic
│   ├── prisma/               # DB schema + migrations
│   ├── scripts/              # seed/, maintenance/, checks/ (RAG/provider smoke tests), reports/
│   └── _archive/             # unused code kept for reference; not built or type-checked
├── ai/         # Python AI service — port 4100
│   ├── server.py             # entry: /health + routes WebSockets to feature packages
│   └── stt/                  # package: Sarvam speech-to-text relay
└── ...
```

## Run

```bash
# 1. Backend (API at http://localhost:4000)
cd backend
cp .env.example .env      # fill in secrets
npm run dev

# 2. Frontend (UI at http://localhost:3000)
cd frontend
cp .env.example .env
npm run dev

# 3. AI service (STT WebSocket at ws://localhost:4100/sarvam-stream)
#    see ai/README.md
```

The frontend calls the backend via `apiFetch('/api/...')`, which resolves to
`NEXT_PUBLIC_API_URL` (default `http://localhost:4000`). Live captions go
straight from the browser to the STT relay at `NEXT_PUBLIC_STT_RELAY_URL`
(default `http://localhost:4100`). The backend only mints the relay's token
(`/api/stt-token`); `STT_TOKEN_SECRET` must match in `backend/.env` and
`ai/.env`.

## Docker

Every deployable has its own `Dockerfile` (multi-stage, runs as a non-root
user, with a health check). Build from inside each folder:

| Folder | Image | Port | Runtime config | Build args (baked in) |
|---|---|---|---|---|
| `backend/` | `docker build -t staad-backend backend` | 4000 | mount `-v "$PWD/backend/.env:/app/.env:ro"` | `NEXT_PUBLIC_LIVEKIT_URL`, `NEXT_PUBLIC_STT_RELAY_URL` |
| `frontend/` | `docker build -t staad-frontend frontend` | 3000 | none | every `NEXT_PUBLIC_*` from `frontend/.env.example` (and `BACKEND_URL` if proxying) |
| `ai/` | `docker build -t staad-ai ai` | 4100 | mount `-v "$PWD/ai/.env:/app/.env:ro"` | none |
| `feedback-board/` | `docker build -t staad-feedback feedback-board` | 3100 | `--env-file feedback-board/.env` | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_PUBLIC_URL` |
| `n8n/` | `docker build -t staad-n8n n8n` | 5678 | `STAAD_BACKEND_URL`, `N8N_ENCRYPTION_KEY`, volume on `/home/node/.n8n` | none |

`NEXT_PUBLIC_*` values end up in the browser bundle, so they are build args
and changing one means rebuilding. Never bake secrets in as build args.
Database tasks for the backend use the `tools` target:
`docker build --target tools -t staad-backend-tools backend`, then
`docker run --rm -v "$PWD/backend/.env:/app/.env:ro" staad-backend-tools npx prisma db push`.
The backend and AI service read `/app/.env` themselves, so mounting the file
keeps `.env` syntax. `--env-file` passes values literally: quotes and inline
`# comments` (there are some in `backend/.env.example`) become part of the value.
Each Dockerfile's header comment has the full run command.
