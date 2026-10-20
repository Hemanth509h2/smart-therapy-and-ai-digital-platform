# AI service (Python)

All of STAAD's AI work runs here: one Python server (`server.py`, port 4100)
with a package per AI feature. The backend keeps login, plan and consent checks
and all app data; it sends this service only what each AI task needs.

- `server.py`: HTTP `/health`, and routes WebSocket connections to the feature packages
- `stt/`: live speech-to-text. Relays session audio from the browser to Sarvam
  and sends transcripts back (WebSocket `/sarvam-stream`, also `/api/sarvam-stream`).
  Sarvam needs its API key in a WebSocket *header*, which browsers can't set, so
  the browser connects here and this service adds the key.
- `call_plan/`: the call-plan AI agent behind the "Call Plan" tab of the AI Notes
  popup (WebSocket `/call-plan`). The therapist uploads or pastes the client's
  previous notes; the agent reads them, searches the STAAD module reports
  (`module_report_chunks` in the backend's Postgres, filled by
  `backend/scripts/maintenance/ingest-module-reports.ts`), and returns
  recommended modules and a task list for the call. Later in the call it marks
  tasks covered from the live transcript. The token comes from the backend's
  `/api/call-plan-token`, which checks session ownership, plan and AI consent.
  Files are read in memory and never stored; nothing is logged but errors.
- `copilot/`: AI insights, the "Analyse" button. Reads the last few minutes of
  the transcript with the session's module activity, in-call notes, previous
  notes and the therapist's study material (`document_chunks`), and returns
  emotions, a summary, next steps and a module. A separate safety scan runs in
  parallel and decides the risk level.
- `report/`: the end-of-session report, written from the whole transcript,
  activity log, notes and call plan.
- `internal.py`: the endpoint the backend calls for `copilot` and `report`
  (WebSocket `/internal`, not for browsers). The backend's `/api/ai-insight` and
  `/api/session-report` do their checks, send the session data, and save the
  result (`backend/src/lib/ai-service.ts`).
- `openrouter.py`, `rag.py`: shared OpenRouter chat, and Postgres + NVIDIA
  embeddings for the searches.
- `scripts/`: fill the search tables, run by hand (see below).

The backend issues the tokens (`/api/stt-token`, `/api/call-plan-token`, and
its own for `/internal`), each with a scope so one feature's token can't open
another; this service only checks them, using the same `STT_TOKEN_SECRET`. It
needs no Firebase access. It reads `module_report_chunks` and `document_chunks`
in the backend's database (`DATABASE_URL`) and calls OpenRouter and NVIDIA.

## Run locally (port 4100)

```bash
cd ai
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env              # SARVAM_API_KEY + same STT_TOKEN_SECRET as backend/.env
                                  # AI: OPENROUTER_API_KEY, DATABASE_URL, NVIDIA_API_KEY
python server.py
python -m pytest tests            # the AI model is faked
```

Point the frontend at it with `NEXT_PUBLIC_STT_RELAY_URL=http://localhost:4100`
in `frontend/.env`, and the backend with `STT_RELAY_URL=http://localhost:4100`
in `backend/.env`, then restart them.

## Search tables (scripts/)

Run from `ai/` with the virtual environment active; they read `ai/.env`.

```bash
# STAAD module reports (.docx, one sub-folder per category) -> module_report_chunks
python scripts/ingest_module_reports.py "<folder>" --dry-run   # check first
python scripts/ingest_module_reports.py "<folder>"

# A therapist's study material (PDF) -> document_chunks, keyed by Firebase uid
python scripts/study_material.py setup                        # once
python scripts/study_material.py ingest <therapistUid> notes.pdf
python scripts/study_material.py list <therapistUid>
python scripts/study_material.py delete <therapistUid> notes.pdf
```

Both embed with `rag.EMBEDDING_MODEL`; changing it means re-running both.

## Deploy

`docker build -t staad-ai .` then run with `SARVAM_API_KEY`, `STT_TOKEN_SECRET`,
`ALLOWED_ORIGINS`, and for the AI features `OPENROUTER_API_KEY`, `DATABASE_URL`
and `NVIDIA_API_KEY` set (plus any `OPENROUTER_*_MODEL`). The backend needs
`STT_RELAY_URL` set to this service's address. The image runs under gunicorn
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
