# STT relay (Python)

Relays live session audio from the browser to Sarvam speech-to-text and sends
transcripts back. Sarvam needs its API key in a WebSocket *header*, which
browsers can't set, so the browser connects here and this service adds the key.

- `server.py`: HTTP `/health` and WebSocket `/sarvam-stream` (also `/api/sarvam-stream`)
- `stt_proxy.py`: checks the STT token, then relays to Sarvam

The backend still issues the token at `/api/stt-token`. This relay only checks
it, using the same `STT_TOKEN_SECRET`, so it needs no database or Firebase access.

## Run locally (port 4100)

```bash
cd stt-relay
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env              # SARVAM_API_KEY + same STT_TOKEN_SECRET as backend/.env
python server.py
```

Point the frontend at it with `NEXT_PUBLIC_STT_RELAY_URL=http://localhost:4100`
in `frontend/.env`, then restart the frontend.

## Test

```bash
python -m pytest
```

## Deploy

`docker build -t staad-stt-relay .` then run with `SARVAM_API_KEY`,
`STT_TOKEN_SECRET` and `ALLOWED_ORIGINS` set. The image sets `NODE_ENV=production`,
which refuses all connections if `STT_TOKEN_SECRET` is missing.
