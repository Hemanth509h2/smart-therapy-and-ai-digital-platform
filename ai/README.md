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
`STT_TOKEN_SECRET` and `ALLOWED_ORIGINS` set. The image sets `NODE_ENV=production`,
which refuses all STT connections if `STT_TOKEN_SECRET` is missing.
