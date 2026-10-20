# How to run the AI agent (Call Plan)

The Call Plan agent lives in the Python AI service (`ai/`, port 4100), next to
the speech-to-text relay. The therapist uses it from the **Call Plan** tab of
the AI Notes popup during a call:

1. The therapist uploads or pastes the client's previous notes.
2. The agent recommends modules and writes a task list for the call.
3. As the call goes on, it ticks off the tasks the conversation has covered.

How the pieces connect:

```
browser (Call Plan tab)
   │ 1. POST /api/call-plan-token  → backend   (checks owner, plan, AI consent)
   │ 2. WebSocket /call-plan?token → ai :4100  (checks token with STT_TOKEN_SECRET)
   ▼
ai/call_plan → OpenRouter (LLM) + NVIDIA (embeddings) + Postgres (module reports)
```

---

## 1. One-time setup

```bash
cd ai
python3 -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env
```

## 2. Fill in `ai/.env`

| Variable | Needed? | Value |
|---|---|---|
| `OPENROUTER_API_KEY` | **Yes**: without it the agent is off | Same key as `backend/.env` |
| `STT_TOKEN_SECRET` | **Yes** | Must be the **same** as `STT_TOKEN_SECRET` in `backend/.env` |
| `DATABASE_URL` | Recommended | Same as `backend/.env`. Without it the agent plans from the module list only (no module-report search). |
| `NVIDIA_API_KEY` | Recommended | Same as `backend/.env`. Without it the report search is by keyword instead of by meaning. |
| `OPENROUTER_AGENT_MODEL` | Optional | Model override. Default: `nvidia/nemotron-3-super-120b-a12b:free` |
| `SARVAM_API_KEY` | Only for live speech-to-text | Not needed for Call Plan itself |
| `PORT` | Optional | Default `4100` |

Restart the service after any change to `.env`.

## 3. Start the AI service

```bash
cd ai
source .venv/bin/activate
python server.py
```

You should see:

```
> AI service ready on http://localhost:4100 (STT WebSocket at /sarvam-stream, call-plan agent at /call-plan)
```

If it prints `OPENROUTER_API_KEY is not set - the call-plan agent is off.`, fix `ai/.env` and restart.

Check it's up:

```bash
curl http://localhost:4100/health
# {"ok": true, "sarvamConfigured": true, "callPlanConfigured": true}
```

`callPlanConfigured` must be `true`.

## 4. Point the frontend and backend at it

- **`frontend/.env`**: `NEXT_PUBLIC_STT_RELAY_URL=http://localhost:4100`, then restart the frontend.
  If this isn't set, the frontend uses `http://localhost:4100` anyway.
- **`backend/.env`**: `STT_TOKEN_SECRET` (same value as in `ai/.env`).
- **Admin settings**: the **AI insights** feature must be switched on. Otherwise the token request fails with
  "AI insights are turned off by an admin."

Then run the backend (`npm run dev` in `backend/`) and the frontend (`npm run dev` in `frontend/`) as usual.

## 5. Load the module reports (once, or when reports change)

The agent searches the STAAD module reports stored in the `module_report_chunks` table. Load them from the backend:

```bash
cd backend
npm run ingest:module-reports -- "<folder with the .docx reports>" --dry-run   # check first
npm run ingest:module-reports -- "<folder with the .docx reports>"
```

The folder needs one sub-folder per category (`adhd`, `sld`, `cbt, act`, `anxiety and depression`, `id`,
`skill development`) with the `.docx` files inside. Running it again replaces each file's chunks. If you skip
this step, the agent still works but only picks from the module list.

## 6. Use it in a call

1. Start a session as the **therapist**. The therapist needs an active plan.
2. **Both** the therapist and the client must allow AI assistance in the call.
   - Dev shortcut: set `NEXT_PUBLIC_STT_TEST_MODE=true` in `backend/.env` to skip the consent check.
   - This shortcut never works in production.
3. Open the **AI Notes** popup and go to the **Call Plan** tab.
4. Upload the previous notes (`.pdf`, `.docx`, `.txt` or `.md`, max 5 MB) or paste them in.
5. You get:
   - recommended modules (click one to launch it)
   - a task list for the call
   - tasks that get ticked as the conversation covers them
6. The plan also goes into the end-of-session report.

## 7. Run the tests

```bash
cd ai
source .venv/bin/activate
python -m pytest tests     # the AI model is faked, so no keys are needed
```

---

## Run with Docker (server / production)

`docker-compose.yml` already has the `ai` service. Caddy routes `wss://APP_DOMAIN/call-plan` to it.

```bash
docker compose up -d --build ai
docker compose logs -f ai
```

In production `NODE_ENV=production` is set by the image. If `STT_TOKEN_SECRET` is missing there, every
connection is refused.

## Troubleshooting

| Problem | Cause / fix |
|---|---|
| `callPlanConfigured: false` | `OPENROUTER_API_KEY` is missing in `ai/.env`; restart after adding it |
| "AI insights are turned off by an admin." | Turn on AI insights in the admin settings |
| "Both you and the client need to allow AI assistance first." | Both people must accept AI consent in the call (or use the dev test mode above) |
| "STT_TOKEN_SECRET not configured" | Add `STT_TOKEN_SECRET` to `backend/.env` |
| Tab connects then fails / refused | `STT_TOKEN_SECRET` differs between `backend/.env` and `ai/.env` |
| Can't connect at all | AI service not running, or `NEXT_PUBLIC_STT_RELAY_URL` points at the wrong place |
| Plan ignores report details | Module reports not loaded (step 5), or `DATABASE_URL` missing in `ai/.env` |
| "Upload a PDF, Word (.docx) or text file." | Wrong file type; only `.pdf`, `.docx`, `.txt`, `.md` work |
