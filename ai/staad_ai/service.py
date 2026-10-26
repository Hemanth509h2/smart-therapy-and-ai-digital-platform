"""Entry point for running the STAAD pipeline from the AI features (call_plan/,
copilot/). It has no endpoint of its own.

session_history(session_id): what the AI assistant and the call plan use. The
client's records (earlier session reports, progress notes and metrics,
non-private therapist notes) as redacted text, scoped to the session's owner.

run(request, session_id) with request["type"]:
  "context"        ->  {"type": "context", "context": {systemPrompt, userPrompt,
                        sections, tokenEstimate, metadata}}   (no model call)
  "staad-insight"  ->  {"type": "staad-insight", "insight": {...}}  (same shape as copilot's)
session_id must be the session the caller's token was verified for.

Request fields (camelCase, like the copilot's):
  therapistUid   required; every database read is scoped to it
  clientId, semanticQuery, module, eventType, intent, windowMinutes, topK,
  similarityThreshold, notesLimit, reportsLimit, metricsLimit, tokenBudget   optional
  transcript     [{speaker, text, timestamp (ms), isFinal?}]   live, from the backend
  moduleEvents, inCallNotes   [str | {...}]                    live, from the backend
  activeModuleId

Client, session ownership, notes, reports, metrics and study material come from
the HIPAA database (postgres_adapters.py); the live session data comes with the
request, because the database doesn't hold it. Request contents are never logged.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Mapping

import openrouter
from copilot import safety

from . import postgres_adapters
from .models import PipelineInput, TranscriptTurn
from .pipeline import analyze, process_pipeline_with_details
from .retrieval import UnifiedRetriever

log = logging.getLogger("staad")

TYPES = ("context", "staad-insight")
SPEAKERS = ("therapist", "client", "unknown")
HISTORY_MAX_CHARS = 4000

# Request field -> PipelineInput field.
_OPTIONAL_FIELDS = {
    "clientId": "client_id",
    "semanticQuery": "semantic_query",
    "module": "module",
    "eventType": "event_type",
    "intent": "intent",
    "windowMinutes": "transcript_window_minutes",
    "topK": "top_k",
    "similarityThreshold": "similarity_threshold",
    "notesLimit": "notes_limit",
    "reportsLimit": "reports_limit",
    "metricsLimit": "metrics_limit",
    "tokenBudget": "token_budget",
}


def is_configured(env=os.environ) -> bool:
    return postgres_adapters.is_configured(env)


def pipeline_input(request: Mapping[str, Any], session_id: str) -> PipelineInput:
    """Raises ValueError for a missing therapistUid or an out-of-range field."""
    therapist = request.get("therapistUid")
    if not isinstance(therapist, str) or not therapist.strip():
        raise ValueError("therapistUid is required")
    if not session_id:
        raise ValueError("A session is required")
    fields = {name: request[key] for key, name in _OPTIONAL_FIELDS.items() if request.get(key) is not None}
    # Private notes never reach the model through this endpoint.
    return PipelineInput(therapist_id=therapist, session_id=session_id, allow_private_notes=False, **fields)


def _turn(raw: Any) -> TranscriptTurn | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("text"), str) or not raw["text"].strip():
        return None
    speaker = str(raw.get("speaker") or "").lower()
    timestamp = raw.get("timestamp")
    when = (datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
            if isinstance(timestamp, (int, float)) and not isinstance(timestamp, bool) else None)
    return TranscriptTurn(text=raw["text"], speaker=speaker if speaker in SPEAKERS else "unknown",
                          timestamp=when, is_final=raw.get("isFinal") is not False)


def live_session_data(request: Mapping[str, Any]) -> dict[str, Any]:
    """The live session data the backend sent, in the session retriever's shape."""
    def items(key):
        value = request.get(key)
        return [v for v in value if isinstance(v, dict) or (isinstance(v, str) and v.strip())] \
            if isinstance(value, list) else []

    transcript = request.get("transcript") if isinstance(request.get("transcript"), list) else []
    active = request.get("activeModuleId")
    return {
        "transcript": [t for t in map(_turn, transcript) if t is not None],
        # The pipeline filters module events by their fields, so plain strings become {"event": ...}.
        "moduleEvents": [e if isinstance(e, dict) else {"event": e} for e in items("moduleEvents")],
        "inCallNotes": items("inCallNotes"),
        "activeModuleId": active if isinstance(active, str) and active else None,
    }


class LiveSessionRetriever:
    """Session ownership and state from the database, live data from the request.
    Ownership fields (sessionId, therapistId, clientId) always come from the database."""

    def __init__(self, stored, live: Mapping[str, Any]):
        self.stored = stored
        self.live = live

    async def get_session(self, session_id, client_id, therapist_id, transcript_window_minutes):
        session = dict(await self.stored.get_session(session_id, client_id, therapist_id,
                                                     transcript_window_minutes))
        session.update({k: v for k, v in self.live.items() if v})
        return session


def make_retriever(request: Mapping[str, Any], env=os.environ) -> UnifiedRetriever:
    stored = postgres_adapters.create_postgres_retriever(env)
    stored.sessions = LiveSessionRetriever(stored.sessions, live_session_data(request))
    return stored


class OpenRouterModel:
    """ModelService for pipeline.analyze: the copilot model, and copilot's safety scan."""

    def __init__(self, chat=None, env=os.environ):
        self.env = env
        self.chat = chat or (lambda messages, max_tokens: openrouter.chat(
            messages, openrouter.copilot_model(env), max_tokens, env=env))

    async def complete_json(self, system_prompt, user_prompt):
        return await self.chat([{"role": "system", "content": system_prompt},
                                {"role": "user", "content": user_prompt}], 1024)

    async def scan_safety(self, transcript):
        return await safety.run_safety_scan(transcript, self.chat, self.env)


def context_reply(payload) -> dict[str, Any]:
    return {"systemPrompt": payload.system_prompt, "userPrompt": payload.user_prompt,
            "sections": payload.structured_sections, "tokenEstimate": payload.token_estimate,
            "metadata": payload.metadata}


async def run(request: Mapping[str, Any], session_id: str, env=os.environ, retrieval=None, model=None):
    """One request -> one reply dict. Raises ValueError (bad request), PermissionError
    (outside the therapist's scope) or RuntimeError (the model failed)."""
    kind = request.get("type")
    pipeline_request = pipeline_input(request, session_id)
    retrieval = retrieval or make_retriever(request, env)
    if kind == "context":
        payload, _ = await process_pipeline_with_details(pipeline_request, retrieval)
        return {"type": "context", "context": context_reply(payload)}
    insight = await analyze(pipeline_request, retrieval, model or OpenRouterModel(env=env))
    return {"type": "staad-insight", "insight": insight.to_dict()}


async def session_history(session_id, env=os.environ, owner=None):
    """The client's records for this session, as redacted prompt text; "" when there
    are none. Never raises: no database or any failure means no history, and the
    feature goes on without it. session_id must be the one the caller's token was
    verified for; the therapist is the session's owner in the database, so a
    browser-supplied identity is never trusted. `owner(session_id, env)` is for tests."""
    if not session_id or not is_configured(env):
        return ""
    try:
        therapist = await asyncio.to_thread(owner or postgres_adapters.session_owner, session_id, env)
        if not therapist:
            return ""
        reply = await run({"type": "context", "therapistUid": therapist, "notesLimit": 3, "reportsLimit": 3,
                           "metricsLimit": 10, "tokenBudget": 3000}, session_id, env)
        return reply["context"]["sections"].get("historical", "")[:HISTORY_MAX_CHARS]
    except Exception as e:  # type only: messages can quote data
        log.warning("[staad] client records unavailable: %s", type(e).__name__)
        return ""
