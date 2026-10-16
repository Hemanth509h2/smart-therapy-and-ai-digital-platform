# STAAD — Smart Therapy & AI Digital Platform

Monorepo with two deployables that talk **only over HTTP APIs**:

```
├── frontend/   # Next.js UI (pages, components, hooks, store) — port 3000
│   └── src/lib/api.ts        # apiFetch(): prefixes NEXT_PUBLIC_API_URL
├── backend/    # Next.js API server (app/api routes + Prisma + STT proxy) — port 4000
│   ├── server.js             # custom server entry: API + Sarvam STT WebSocket proxy
│   ├── server/stt-proxy.js   # STT WebSocket relay (token check + Sarvam upstream)
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
│   ├── tests/                # Firestore rules + STT proxy tests
│   └── _archive/             # unused code kept for reference; not built or type-checked
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
```

The frontend calls the backend via `apiFetch('/api/...')`, which resolves to
`NEXT_PUBLIC_API_URL` (default `http://localhost:4000`). Set
`NEXT_PUBLIC_STT_RELAY_URL` in `frontend/.env` to the backend origin so the
browser connects to its Sarvam STT WebSocket proxy.
