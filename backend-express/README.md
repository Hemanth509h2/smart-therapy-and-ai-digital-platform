# STAAD backend (Express)

The STAAD API on Express 5 (ported from the earlier Next.js route handlers,
which have been removed). The frontend reaches it via `NEXT_PUBLIC_API_URL`
(port 4000 locally).

## Run

```bash
cp .env.example .env     # fill in secrets
npm install              # also generates both Prisma clients
npm run dev              # tsx watch, http://localhost:4000
npm run build && npm start   # compiled: node dist/server.js
npm run typecheck
```

## Deploy to Vercel

Set the Vercel project's **Root Directory** to `backend-express` and add the
same environment variables as `.env`. `vercel.json` sets `framework: null`, so
Vercel does not treat it as a Next.js app (the "No Next.js version detected"
error), runs `npm run build`, and sends every request to `api/index.js`, which
serves the compiled Express app from `dist/`. `public/` is an intentionally
empty output directory.

## Layout

```
src/
  server.ts            network tweaks, .env, listen (was server.js)
  app.ts               logging, CORS, body parsing, routers, 404 + error handler
  middleware/cors.ts   was src/middleware.ts
  routes/              one router per API area, mounted under /api
    index.ts           mounts every router under /api
    admin/*.ts         /api/admin/<area>/...
  lib/                 shared server code, grouped by feature
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

- Scheduled jobs: on Vercel, `vercel.json` runs them (with
  `Authorization: Bearer $CRON_SECRET`). Elsewhere (Docker), call
  `GET /api/cleanup-transcripts` (daily 02:00) and `GET /api/cron/subscriptions`
  (daily 02:30) from any scheduler with `x-cron-secret: $CRON_SECRET`.
- `.env` is loaded with dotenv (`.env` only, not `.env.local` /
  `.env.development`).
- An unknown path answers `404 {"error":"Not found"}` as JSON, and a wrong
  method on a known path is also a 404 (Next answered 405).
