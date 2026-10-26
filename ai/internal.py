"""Internal endpoint the backend calls for AI work (served by ai/server.py).

Not for browsers. The backend's routes keep auth, plan and consent checks and
all reads and writes of app data; they send the data here and save the result
(backend/src/lib/ai-service.ts). One request per connection, over a WebSocket so
it shares the server, port and token scheme with stt and call_plan:

  /internal?sid=<sessionId>&token=<token>   token scope "internal", minted by the backend

  {"type": "insight", ...}  ->  {"type": "insight", "insight": {...}}     (copilot/)
  {"type": "report", ...}   ->  {"type": "report", "content": "...", "model": "..."}  (report/)

Any failure replies {"type": "error", "error": "...", "code": "bad_request" | "model" | "not_configured"}.
Request contents are never logged.
"""

import asyncio
import json
import logging
import os

from websockets.exceptions import ConnectionClosed

import copilot
import openrouter
import report
from stt import verify_stt_token

log = logging.getLogger("ai.internal")

PATHS = {"/internal"}
TOKEN_SCOPE = "internal"
RECEIVE_TIMEOUT = 30  # seconds to wait for the request


def authorize(query, env=os.environ):
    """Returns None when allowed, otherwise a short close reason. Same rules as stt."""
    secret = env.get("STT_TOKEN_SECRET")
    if not secret:
        return "Internal auth not configured" if env.get("NODE_ENV") == "production" else None
    ok = verify_stt_token(query.get("token"), query.get("sid"), secret, scope=TOKEN_SCOPE)
    return None if ok else "Unauthorized"


def _error(code, message):
    return {"type": "error", "code": code, "error": message}


async def run(request, env=os.environ, sid=None):
    """One request dict -> one reply dict. `sid` is the session the token was minted for."""
    kind = request.get("type") if isinstance(request, dict) else None
    if kind not in ("insight", "report"):
        return _error("bad_request", "Unknown request type.")
    if not openrouter.is_configured(env):
        return _error("not_configured", "OPENROUTER_API_KEY is not set on the AI service.")
    try:
        if kind == "insight":
            return {"type": "insight", "insight": await copilot.run_analysis(request, env=env, session_id=sid)}
        inputs = request.get("inputs") if isinstance(request.get("inputs"), dict) else {}
        return {"type": "report", **await report.write_report(inputs, request.get("client"), env=env)}
    except openrouter.LLMError as e:
        log.error("[internal] %s failed: %s", kind, e)  # status and OpenRouter's reason only
        return _error("model", "The AI model could not answer. Try again in a minute.")


async def handle_connection(ws, query, env=os.environ):
    denied = authorize(query, env)
    if denied:
        return await ws.close(1008, denied)
    try:
        try:
            request = json.loads(await asyncio.wait_for(ws.recv(), RECEIVE_TIMEOUT))
        except (ValueError, TypeError):
            request = None
        await ws.send(json.dumps(await run(request, env, query.get("sid"))))
    except (ConnectionClosed, asyncio.TimeoutError):
        pass  # backend gave up or never sent the request
    finally:
        await ws.close()
