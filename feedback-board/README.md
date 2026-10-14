# STAAD Feedback

Anonymous feedback board for STAAD (Smart Therapy & AI Digital Platform), for attendees at conferences and meetings.
Next.js (App Router) implementation of `docx/Anonymous-Feedback-Comment-System-Design.docx`.

## Pages

- `/` - the whole board on one page, in a light, minimalist style (subtle neumorphism for content, glass for floating layers). Feedback posts look like YouTube top-level
  comments, their comments show as threaded replies, and a WhatsApp-style bar at the bottom posts feedback or replies
  (emoji picker, category picker, "Replying to" quote).
- `/present` - projector screen: large QR code, live post count and latest feedback (refreshes every 10s).
  Set `NEXT_PUBLIC_PUBLIC_URL` to the public address so the QR code points at the deployed site, not localhost.
- `/admin` - moderation queue

- Anyone can post feedback (idea / issue / praise / question), comment, upvote and report - no sign-in.
- Stores only text, category and minute-rounded timestamps. Author token is kept as SHA-256; voter/reporter keys are HMACs.
- IPs are used only as a daily-salted in-memory hash for rate limiting (5 posts/h, 20 comments/h, 60 votes/h, 10 reports/day).
- Similar-comment suggestions run in the browser (trigram Jaccard >= 0.45); `pg_trgm` server fallback above 300 comments.
- Auto-hide at 3 open reports; admin queue at `/admin` (password from `ADMIN_PASSWORD`).
- Cloudflare Turnstile CAPTCHA is enforced when `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set.

## Run

    cp .env.example .env      # set DATABASE_URL, HMAC_SECRET, ADMIN_PASSWORD
    npm install
    npm run db:init           # applies schema.sql
    npm run dev               # http://localhost:3100

`docker-compose.yml` provides a standalone Postgres for local use.

Notes: rate-limit counters are in-memory (swap `src/lib/ratelimit.ts` for Redis when running multiple instances).
Soft-deleted rows and resolved reports are purged when the admin queue is loaded.

## Deploy to Vercel

`vercel.json` is set up for this folder (Next.js, region `sin1` next to the Neon database in ap-southeast-1).

1. Import the repo in Vercel and set **Root Directory** to `feedback-board`.
2. Add the environment variables from `.env.example`: `DATABASE_URL`, `HMAC_SECRET`, `ADMIN_PASSWORD`,
   and optionally `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `BLOCKLIST`, `AUTO_HIDE_REPORTS`.
3. Set `NEXT_PUBLIC_PUBLIC_URL` to the deployed URL so the `/present` QR code points at it.
4. Run `npm run db:init` once against the database (locally, with `DATABASE_URL` set).

Note: rate-limit counters are in memory, so on Vercel each serverless instance counts separately.
Swap `src/lib/ratelimit.ts` for a shared store (e.g. Upstash Redis) if strict limits matter.
