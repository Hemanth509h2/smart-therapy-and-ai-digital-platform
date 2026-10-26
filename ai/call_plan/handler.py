"""WebSocket endpoint for the call-plan agent (served by ai/server.py).

One request per connection. The browser connects to /call-plan?sid=...&token=...
with a token from the backend's /api/call-plan-token (which checks the caller
owns the session, has a plan, and that AI consent was given), then sends one
JSON message:

  {"type": "plan", "modules": [{id, name, category, desc}], "clientName"?,
   "notesText"?: "...", "file"?: {"name": "notes.pdf"}}
      With "file", the next message is the file's bytes (binary).
      The agent also reads the client's records for this session (earlier reports,
      progress notes, metrics) from the STAAD pipeline, when the database is set up.
      Replies: {"type": "status", "step": "reading" | "planning" | "revising"} ...
               then {"type": "plan", "plan": {...}}

  {"type": "progress", "tasks": [{id, text, done}], "transcript": [{speaker, text}]}
      Replies: {"type": "progress", "covered": [task ids], "next": "..."}

Any failure replies {"type": "error", "error": "<message for the therapist>"}.
The server closes the socket after the reply. Notes, files and transcripts are
never logged or stored here.
"""

import asyncio
import json
import logging
import os

from websockets.exceptions import ConnectionClosed

from call_plan import agent, llm
from call_plan.extract import MAX_TEXT_CHARS, ExtractError, extract_text
from staad_ai import service as staad
from stt import verify_stt_token

log = logging.getLogger("call-plan")

PATHS = {"/call-plan", "/api/call-plan"}
TOKEN_SCOPE = "call-plan"
RECEIVE_TIMEOUT = 30  # seconds to wait for each browser message


def authorize(query, env=os.environ):
    """Returns None when allowed, otherwise a short close reason. Same rules as stt."""
    secret = env.get("STT_TOKEN_SECRET")
    if not secret:
        return "Agent auth not configured" if env.get("NODE_ENV") == "production" else None
    ok = verify_stt_token(query.get("token"), query.get("sid"), secret, scope=TOKEN_SCOPE)
    return None if ok else "Unauthorized"


async def _send(ws, message):
    await ws.send(json.dumps(message))


async def _receive(ws):
    return await asyncio.wait_for(ws.recv(), RECEIVE_TIMEOUT)


async def _notes_from(ws, request):
    file = request.get("file")
    if isinstance(file, dict):
        data = await _receive(ws)
        if isinstance(data, str):
            raise ExtractError("The file did not arrive. Try uploading it again.")
        return await asyncio.to_thread(extract_text, str(file.get("name", "")), data)
    text = request.get("notesText")
    if not isinstance(text, str) or not text.strip():
        raise ExtractError("Upload the previous notes or paste them in.")
    return text.strip()[:MAX_TEXT_CHARS]


async def with_client_records(notes, sid, env=os.environ, history=None):
    """The therapist's notes plus the client's records from the STAAD pipeline,
    for the session the token was verified for. Unchanged when there are none."""
    records = await (history or staad.session_history)(sid, env)
    if not records:
        return notes
    return f"{notes}\n\nFROM THE CLIENT'S RECORDS (earlier reports, progress notes and metrics):\n{records}"


async def handle_connection(ws, query, env=os.environ):
    denied = authorize(query, env)
    if denied:
        return await ws.close(1008, denied)
    try:
        if not llm.is_configured(env):
            return await _send(ws, {"type": "error", "error": "The AI agent is not set up on the server."})
        try:
            request = json.loads(await _receive(ws))
        except (ValueError, TypeError):
            return await _send(ws, {"type": "error", "error": "Bad request."})
        if not isinstance(request, dict):
            return await _send(ws, {"type": "error", "error": "Bad request."})

        try:
            if request.get("type") == "plan":
                notes = await with_client_records(await _notes_from(ws, request), query.get("sid"), env)
                plan = await agent.make_plan(
                    notes, request.get("modules"), str(request.get("clientName") or "")[:80],
                    on_step=lambda step: _send(ws, {"type": "status", "step": step}),
                )
                await _send(ws, {"type": "plan", "plan": plan})
            elif request.get("type") == "progress":
                result = await agent.check_progress(request.get("tasks"), request.get("transcript"))
                await _send(ws, {"type": "progress", **result})
            else:
                await _send(ws, {"type": "error", "error": "Bad request."})
        except (ExtractError, ValueError) as e:
            await _send(ws, {"type": "error", "error": str(e)})
        except llm.LLMError as e:
            log.error("[call-plan] %s", e)  # status and OpenRouter's reason only, never content
            await _send(ws, {"type": "error", "error": "The AI agent could not finish. Try again in a minute."})
        except asyncio.TimeoutError:
            await _send(ws, {"type": "error", "error": "The upload timed out. Try again."})
    except (ConnectionClosed, asyncio.TimeoutError):
        pass  # browser left or went quiet
    finally:
        await ws.close()

