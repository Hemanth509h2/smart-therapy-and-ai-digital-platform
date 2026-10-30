# STAAD backend (Express)

The same API as `../backend` (Next.js route handlers), running on Express 5.
Every endpoint, request body and response is unchanged, so the frontend can
point at either one (`NEXT_PUBLIC_API_URL` / port 4000).

## Run

```bash
cp .env.example .env     # same variables as ../backend/.env
npm install              # also generates both Prisma clients
npm run dev              # tsx watch, http://localhost:4000
npm run build && npm start   # compiled: node dist/server.js
npm run typecheck
```

## Layout

```
src/
  server.ts            network tweaks, .env, listen (was server.js)
  app.ts               logging, CORS, body parsing, routers, 404 + error handler
  middleware/cors.ts   was src/middleware.ts
  routes/              one router per API area; paths mirror ../backend/src/app/api
    index.ts           mounts every router under /api
    admin/*.ts         /api/admin/<area>/...
  lib/                 copied from ../backend/src/lib
    http/reply.ts      Express helpers (new)
```

Each router declares its full path, so `GET /api/admin/users/:uid` lives in
`routes/admin/users.ts` as `router.get('/admin/users/:uid', ...)`.

## Conventions

- Handlers are wrapped in `handle()` and always `return res.status(...).json(...)`.
- Shared helpers (`requireAuth`, `requireAdmin`, `requireActivePlan`,
  `errorResponse`, `notYourProfile`, ...) return a `Reply` instead of a
  `NextResponse`. Send it with `send(res, reply)`:

  ```ts
  const auth = await requireAuth(req);
  if (!auth.ok) return send(res, auth.response);
  ```

  `handle()` makes returning an unsent `Reply` a type error.
- Query strings: `queryParams(req).get('x')` (same semantics as
  `URLSearchParams`). Headers: `req.get('x')`. Body: `req.body` (`{}` when
  the request has none). Route params: `req.params.id`.
- `POST /api/payments/cashfree/webhook` receives its body as raw text (for
  the signature check); every other route gets parsed JSON (limit 10 MB).

## Differences from the Next.js backend

- Scheduled jobs: `vercel.json` crons do not apply here. Call
  `GET /api/cleanup-transcripts` (daily 02:00) and `GET /api/cron/subscriptions`
  (daily 02:30) from any scheduler with `x-cron-secret: $CRON_SECRET`.
- `.env` is loaded with dotenv (`.env` only, not `.env.local` /
  `.env.development`).
- An unknown path answers `404 {"error":"Not found"}` as JSON, and a wrong
  method on a known path is also a 404 (Next answered 405).
