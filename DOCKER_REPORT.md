# Docker report: running STAAD on a cloud server

Updated 2026-10-17.

This guide puts the whole platform on one Linux cloud server (any provider:
AWS EC2, DigitalOcean, Hetzner, Azure, GCP, ...). It runs with Docker Compose
behind Caddy, which serves everything over HTTPS with free certificates.

---

## 1. What runs where

```
                    internet
                       |
              ports 80 and 443 only
                       |
                 +-----------+
                 |   caddy   |  HTTPS certificates, forwards each request
                 +-----------+
        ┌──────────────┼───────────────────┬─────────────────┐
        |              |                   |                 |
 https://APP_DOMAIN                https://FEEDBACK_DOMAIN  https://N8N_DOMAIN
        |                                  |                 |
  /            -> frontend:3000      feedback-board:3100   n8n:5678
  /api/...     -> backend:4000             |                 |
  /sarvam-stream -> ai:4100          feedback-db:5432     (calls backend:4000)
```

| Service | What it is | Public address |
|---|---|---|
| caddy | HTTPS front door | ports 80 and 443 |
| frontend | the website | `https://APP_DOMAIN` |
| backend | the API | `https://APP_DOMAIN/api/...` |
| ai | speech-to-text relay | `wss://APP_DOMAIN/sarvam-stream` |
| feedback-board | anonymous feedback board | `https://FEEDBACK_DOMAIN` |
| feedback-db | Postgres for the feedback board | not public |
| n8n | automation workflows | `https://N8N_DOMAIN` |

Why one domain for the website, API and speech-to-text: the browser only ever
talks to its own address. That avoids CORS problems, needs only one
certificate, and the microphone works because the page is served over HTTPS.

The main database is not in Docker. The backend keeps using the Postgres in
`DATABASE_URL` (Neon), so nothing moves.

---

## 2. What you need

- **A cloud server:** Ubuntu 24.04 (or similar), with at least **4 GB RAM** and
  **30 GB disk**. Building the two Next.js apps needs a lot of memory. With
  2 GB, add swap (step 3) and build one service at a time (step 7).
- **A domain** where you can add DNS records, for example `staad.in`.
- **Three names on that domain**, for example:
  - `app.staad.in` (main app)
  - `feedback.staad.in` (feedback board)
  - `n8n.staad.in` (n8n)
- **The `.env` files you already use locally** for `backend/`, `frontend/`,
  `ai/` and `feedback-board/`.

---

## 3. Prepare the server (once)

Log in with SSH, then:

```bash
# Install Docker and Docker Compose
curl -fsSL https://get.docker.com | sudo sh

# Let your user run docker without sudo (log out and back in afterwards)
sudo usermod -aG docker $USER

# Firewall: allow SSH, HTTP and HTTPS only
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443
sudo ufw enable
```

Also open ports **80** and **443** in your cloud provider's firewall or
security group, if it has one (AWS, Azure and GCP do).

Only on a server with less than 4 GB RAM, add 4 GB of swap:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 4. Point the domains to the server

At your DNS provider, add an **A record** for each name, pointing to the
server's public IP address:

| Type | Name | Value |
|---|---|---|
| A | `app` | server IP |
| A | `feedback` | server IP |
| A | `n8n` | server IP |

Wait until they resolve (`ping app.staad.in` shows the server IP). Caddy
cannot get HTTPS certificates before that.

---

## 5. Get the code onto the server

```bash
git clone <your repository URL> staad
cd staad
```

---

## 6. Create the settings files

### 6a. Server settings: `.env` next to `docker-compose.yml`

```bash
cp .env.example .env
nano .env
```

| Setting | Example | What it is |
|---|---|---|
| `APP_DOMAIN` | `app.staad.in` | website, API and speech-to-text |
| `FEEDBACK_DOMAIN` | `feedback.staad.in` | feedback board |
| `N8N_DOMAIN` | `n8n.staad.in` | n8n |
| `ACME_EMAIL` | `you@staad.in` | Let's Encrypt expiry warnings |
| `FEEDBACK_DB_PASSWORD` | output of `openssl rand -hex 24` | feedback database password; set it before the first start |
| `TURNSTILE_SITE_KEY` | (optional) | feedback board CAPTCHA |

### 6b. Each service's own settings

Copy your local files to the server (for example with `scp`), or create them
from the examples:

```bash
cp backend/.env.example        backend/.env
cp frontend/.env.example       frontend/.env
cp ai/.env.example             ai/.env
cp feedback-board/.env.example feedback-board/.env
```

You do **not** need to change localhost addresses in these files. On the
server, `docker-compose.yml` replaces them:

| File | Replaced automatically on the server |
|---|---|
| `backend/.env` | `APP_URL`, `ALLOWED_ORIGINS` → `https://APP_DOMAIN`; `STT_RELAY_URL` → the ai container |
| `frontend/.env` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STT_RELAY_URL` → `https://APP_DOMAIN` |
| `ai/.env` | `ALLOWED_ORIGINS` → `https://APP_DOMAIN`; `NODE_ENV` → `production` |
| `feedback-board/.env` | `DATABASE_URL` → the feedback-db container |

These must still be filled in by you:

- **backend/.env:** `DATABASE_URL`, `FIREBASE_*`, `LIVEKIT_*`, `STT_TOKEN_SECRET`
  and the API keys you use. `AUTH_DISABLED` must be `false`.
- **frontend/.env:** the `NEXT_PUBLIC_FIREBASE_*` values and
  `NEXT_PUBLIC_LIVEKIT_URL`.
- **ai/.env:** `SARVAM_API_KEY`, and `STT_TOKEN_SECRET` with the **same value**
  as in `backend/.env`.
- **feedback-board/.env:** `HMAC_SECRET` and `ADMIN_PASSWORD` (generate with
  `openssl rand -hex 32`; never leave them as `change-me`).

---

## 7. Start everything

```bash
docker compose up -d --build
```

The first build takes several minutes. Later builds are much faster: the npm
downloads and the Next.js compile cache are kept in Docker's build cache
(`docker builder prune` clears it). Then:

```bash
docker compose ps          # every service should be "running" (and "healthy")
docker compose logs -f     # watch the logs; Ctrl+C to stop watching
```

`up --build` compiles the three Next.js apps at the same time. With 8 GB RAM or
less this runs out of memory and slows to a crawl (swapping), so build one
service at a time instead:

```bash
docker compose build backend
docker compose build frontend
docker compose build feedback-board
docker compose up -d
```

Open `https://APP_DOMAIN`. The first visit can take a few seconds while Caddy
gets the certificate.

---

## 8. Settings outside the server (once)

These services need to know your new public address:

| Where | What to set |
|---|---|
| Firebase console → Authentication → Settings → Authorized domains | add `APP_DOMAIN`, otherwise sign-in fails |
| Cashfree dashboard → Developers → Webhooks | `https://APP_DOMAIN/api/payments/cashfree/webhook` |
| n8n editor (`https://N8N_DOMAIN`) | create the owner account, the credentials, then activate the workflows (see `n8n/README.md`) |
| Meta WhatsApp webhook (n8n workflow 04) | the webhook URL n8n shows, on `https://N8N_DOMAIN` |

---

## 9. Everyday commands

| Task | Command |
|---|---|
| Update after `git pull` | `docker compose up -d --build` |
| Restart one service | `docker compose restart backend` |
| Logs of one service | `docker compose logs -f backend` |
| Stop everything | `docker compose down` |
| Change a frontend `NEXT_PUBLIC_*` value | edit `frontend/.env`, then `docker compose up -d --build frontend` |
| Change a backend or ai setting | edit its `.env`, then `docker compose up -d backend` (or `ai`) |
| Backend database schema change | from `backend/` on your own machine: HIPAA database `npx prisma db push`; app database **never** `db push` (it would drop tables), apply the SQL in `scripts/maintenance/` with `npx prisma db execute --schema prisma/app/schema.prisma --file <file>` |
| Free disk space from old builds | `docker image prune -f` and `docker builder prune -f` |

Data kept between restarts (Docker volumes):

| Volume | Holds | If lost |
|---|---|---|
| `caddy-data` | HTTPS certificates | Caddy requests new ones (Let's Encrypt has rate limits) |
| `feedback-data` | feedback board database | all feedback is gone; back it up |
| `n8n-data` | workflows, credentials, n8n encryption key | n8n must be set up again; back it up |

Back up the feedback database:

```bash
docker compose exec feedback-db pg_dump -U feedback feedback > feedback-backup.sql
```

---

## 10. The files

| File | What it does |
|---|---|
| `docker-compose.yml` | starts all services, connects them, replaces the localhost addresses |
| `Caddyfile` | HTTPS and which path or domain goes to which container |
| `.env.example` | server settings: domains, e-mail, feedback database password |
| `backend/Dockerfile` | builds the API: install, `next build`, keep production packages only |
| `frontend/Dockerfile` | builds the website as a small standalone Next.js server |
| `feedback-board/Dockerfile` | builds the feedback board as a standalone Next.js server |
| `ai/Dockerfile` | the speech-to-text relay, started by gunicorn |
| `n8n/Dockerfile` | n8n plus a one-time import of the STAAD workflows |

Every Dockerfile explains each of its steps in comments. The five images built
from this repository run as a normal (non-root) user and have a health check.
Every container keeps at most 30 MB of logs.

---

## 11. Code changes made for Docker

1. **Backend clients start on first use.** The NVIDIA client, the Deepgram
   client and the RAG database connection were created as soon as their files
   loaded, so the build failed without secrets. They are now created the first
   time they are used, like the OpenRouter client already was.
2. **Frontend lockfile repaired.** `npm ci` refused the old
   `package-lock.json`, which was missing three `@emnapi/*` entries.
3. **Standalone build, only in Docker.** `frontend/next.config.mjs` and
   `feedback-board/next.config.mjs` build a standalone server only when
   `NEXT_OUTPUT=standalone`, which the Dockerfiles set. Other hosts build as
   before.
4. **AI service runs on gunicorn**, with one log line per request.

---

## 12. What was tested

| Part | Result |
|---|---|
| backend | real `docker build` succeeded; the built app started and answered, and the Prisma engine loaded |
| frontend | built and started outside Docker with the same steps; pages, JS and the MediaPipe model loaded |
| feedback-board | built and started outside Docker; pages and CSS loaded; schema script works |
| ai | under gunicorn: health check, token check, relaying audio and clean shutdown all worked |
| n8n | the import-once script was tested with stand-in commands; not run in real n8n |
| `docker-compose.yml` | `docker compose config` is valid; it stops with a clear message if the server `.env` is missing |
| `Caddyfile` | `caddy validate` (Caddy 2.11.7): valid configuration |

**Not tested yet:** the whole stack together on a real server with real
domains (`docker compose up` and HTTPS). Do that first and check every item in
step 8.

---

## 13. Known notes

- **Backend image size:** about 1.6 GB of production packages, because the
  backend's `dependencies` include UI packages (Excalidraw, LiveKit components,
  MediaPipe).
- **`[Admin overview error]` during the backend build** is harmless. The route
  is still built as dynamic. `export const dynamic = 'force-dynamic'` in
  `backend/src/app/api/admin/overview/route.ts` would silence it.
- **`npm warn install-scripts` during builds:** `allowScripts` in
  `package.json` lists older versions than are installed, so those install
  scripts are skipped. Nothing depends on them.
- **`npm audit`** reports 46 vulnerabilities in the backend's production
  packages (2 critical). Unrelated to Docker, but worth reviewing.
- **Local development is unchanged.** `npm run dev` and `python server.py` work
  as before; Docker is only for the server.
