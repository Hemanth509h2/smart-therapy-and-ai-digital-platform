# AI service (Python)

One Python server (`server.py`, port 4100) with a package per AI feature:

- `server.py`: HTTP `/health`, and routes WebSocket connections to the feature packages
- `stt/`: live speech-to-text. Relays session audio from the browser to Sarvam
  and sends transcripts back (WebSocket `/sarvam-stream`, also `/api/sarvam-stream`).
  Sarvam needs its API key in a WebSocket *header*, which browsers can't set, so
  the browser connects here and this service adds the key.

The backend still issues the STT token at `/api/stt-token`. `stt` only checks
it, using the same `STT_TOKEN_SECRET`, so this service needs no database or
Firebase access.

## Run locally (port 4100)

```bash
cd ai
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env              # SARVAM_API_KEY + same STT_TOKEN_SECRET as backend/.env
python server.py
```

Point the frontend at it with `NEXT_PUBLIC_STT_RELAY_URL=http://localhost:4100`
in `frontend/.env`, then restart the frontend.

## Deploy

`docker build -t staad-ai .` then run with `SARVAM_API_KEY`,
`STT_TOKEN_SECRET` and `ALLOWED_ORIGINS` set. The image runs under gunicorn
(`gunicorn.conf.py`, binds `0.0.0.0:$PORT`, default 4100). `server.py` is a
plain `websockets` server, not WSGI, so `worker.py` provides a gunicorn worker
that serves it. Set `WEB_CONCURRENCY` for more worker processes (default 1).
To run it the same way locally: `gunicorn` from this folder.

Every request gets one access-log line, in the same format as gunicorn's own
lines: client IP (first `X-Forwarded-For` entry when behind a proxy), method,
path, status, time and user agent. WebSocket closes get their own line, and so
do requests that can't be parsed. Query strings are never logged because they
carry the STT token. gunicorn's `accesslog` setting has no effect here, because
the custom worker handles HTTP itself. The image sets `NODE_ENV=production`,
which refuses all STT connections if `STT_TOKEN_SECRET` is missing.
