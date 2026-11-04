# STAAD — Smart Therapy & AI Digital Platform

Monorepo with three deployables that talk **only over HTTP/WebSocket**:

```
├── frontend/   # Next.js UI (pages, components, hooks, store) — port 3000
│   └── src/lib/api.ts        # apiFetch(): prefixes NEXT_PUBLIC_API_URL
├── backend-express/   # Express 5 API server (routes + Prisma) — port 4000
│   ├── src/server.ts         # entry: network tweaks, .env loading, listener
│   ├── src/app.ts            # logging, CORS, body parsing, routers, error handler
│   ├── src/middleware/cors.ts # CORS headers for cross-origin frontend calls
│   ├── src/routes/           # one Express router per API area, mounted under /api
│   ├── api/index.js          # Vercel entry: serves the compiled app from dist/
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
│   │   └── automation/       #   n8n automation endpoints' logic
│   ├── prisma/               # DB schema + migrations
│   └── scripts/              # seed/, maintenance/, checks/ (RAG/provider smoke tests), reports/
├── ai/         # Python AI service — port 4100
│   ├── server.py             # entry: /health + routes WebSockets to feature packages
│   └── stt/                  # package: Sarvam speech-to-text relay
└── ...
```

## Run

```bash
# 1. Backend (API at http://localhost:4000)
cd backend-express
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
(`/api/stt-token`); `STT_TOKEN_SECRET` must match in `backend-express/.env` and
`ai/.env`.

## Docker (cloud server)

The whole platform runs on one cloud server with Docker Compose, behind Caddy
(automatic HTTPS):

```bash
cp .env.example .env      # domains and e-mail
# plus backend-express/.env, frontend/.env and ai/.env
docker compose up -d --build
```

| Address | Goes to |
|---|---|
| `https://APP_DOMAIN` | website (frontend) |
| `https://APP_DOMAIN/api/...` | backend |
| `wss://APP_DOMAIN/sarvam-stream` | ai (speech-to-text) |
| `https://N8N_DOMAIN` | n8n |

Only ports 80 and 443 are open. The step-by-step server setup (DNS, firewall,
settings, Firebase and webhook changes, backups) is in `DOCKER_REPORT.md`.
