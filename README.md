# STAAD — Smart Therapy & AI Digital Platform

Monorepo with two deployables that talk **only over HTTP APIs**:

```
├── frontend/   # Next.js UI (pages, components, hooks, store) — port 3000
│   └── src/lib/api.ts        # apiFetch(): prefixes NEXT_PUBLIC_API_URL
├── backend/    # Next.js API server (app/api routes + Prisma + STT proxy) — port 4000
│   ├── server.js             # custom server: API + Sarvam STT WebSocket proxy
│   ├── src/middleware.ts     # CORS headers for cross-origin frontend calls
│   ├── prisma/               # DB schema + migrations
│   ├── scripts/              # seeding, pgvector setup, RAG test scripts
│   └── whatsapp-bot/         # standalone Fly.io WhatsApp bot service
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
