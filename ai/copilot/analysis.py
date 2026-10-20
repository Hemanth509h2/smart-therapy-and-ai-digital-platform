"""The copilot analysis: one structured insight for the last few minutes of a session.

Two model calls run in parallel: the main analysis (prompt.py) and a dedicated
safety scan (safety.py). The safety verdict is authoritative for risk, so a
'watch' or 'urgent' raises the flag even if the analysis missed it.

Never log client identity, transcript text or clinical inferences here; these
logs leave the app. Counts and timings only.
"""

import asyncio
import logging
import os
import time

import openrouter
from copilot import safety, study_material
from copilot.prompt import SYSTEM_PROMPT, build_analysis_prompt

log = logging.getLogger("copilot")

AVAILABLE_MODULES = [
    "word-building",
    "whack-a-mole-math",
    "pixel-art-coding",
    "bubble-splash",
    "n-back-challenge",
    "virtual-maze",
    "simon-says",
    "grounding-game",
    "emotional-charades",
    "box-popping",
    "worry-box",
    "drag-drop-sorting",
    "social-story",
    "virtual-shop",
    "emotion-wheel",
    "defusion-river",
    "thought-challenger",
    "micro-quest-board",
    "values-card-sort",
    "worry-vault",
    "facts-vs-feelings",
]
MAX_LIST_ITEMS = 10
PREVIOUS_NOTES = 3


def format_transcript(chunks, minutes, now_ms=None):
    """The last `minutes` of the transcript as '[SPEAKER]: text' lines."""
    if not chunks:
        return "No transcript available for this session yet."
    now_ms = time.time() * 1000 if now_ms is None else now_ms
    cutoff = now_ms - minutes * 60_000
    recent = [c for c in chunks if isinstance(c, dict) and _number(c.get("timestamp")) >= cutoff]
    if not recent:
        return "No transcript available for this time window."
    return "\n".join(f"[{str(c.get('speaker') or 'unknown').upper()}]: {c.get('text', '')}" for c in recent)


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _strings(value):
    return [v for v in value if isinstance(v, str) and v] if isinstance(value, list) else []


def normalise_client(raw):
    raw = raw if isinstance(raw, dict) else {}
    return {
        "name": str(raw.get("name") or "Unknown"),
        "age": _number(raw.get("age")),
        "conditions": [str(c) for c in raw.get("conditions") or [] if c is not None]
        if isinstance(raw.get("conditions"), list) else [],
        "sessionNumber": _number(raw.get("sessionNumber")) or 1,
    }


def normalise_notes(raw):
    """Previous session notes, newest first: [{content, createdAt (ISO), sessionNumber}]."""
    notes = []
    for n in raw if isinstance(raw, list) else []:
        if isinstance(n, dict) and isinstance(n.get("content"), str) and n["content"].strip():
            notes.append({"content": n["content"], "createdAt": str(n.get("createdAt") or ""),
                          "sessionNumber": _number(n.get("sessionNumber")) or len(notes) + 1})
    return notes[:PREVIOUS_NOTES]


async def build_context(request, search=None, env=os.environ, now_ms=None):
    """Everything the prompt needs, from the backend's request plus the study material."""
    search = search or study_material.search
    minutes = _number(request.get("windowMinutes")) or 5
    transcript = format_transcript(request.get("transcript") if isinstance(request.get("transcript"), list)
                                   else [], minutes, now_ms)
    material = await search(str(request.get("therapistUid") or ""), transcript, env)
    return {
        "client": normalise_client(request.get("client")),
        "transcript": transcript,
        "window_minutes": minutes,
        "module_events": _strings(request.get("moduleEvents")),
        "in_call_notes": _strings(request.get("inCallNotes")),
        "study_material": material,
        "previous_notes": normalise_notes(request.get("previousNotes")),
        "available_modules": AVAILABLE_MODULES,
    }


def parse_insight(raw, window_minutes):
    parsed = openrouter.extract_json(raw)
    now = int(time.time() * 1000)
    if parsed is None:
        log.warning("[copilot] model returned invalid JSON, using fallback")
        return {"emotions": [], "summary": "Analysis failed: could not parse LLM response",
                "steps": ["Review the transcript manually"], "module": "", "riskFlag": False,
                "generatedAt": now, "transcriptWindowMinutes": window_minutes}
    return {
        "emotions": _strings(parsed.get("emotions"))[:MAX_LIST_ITEMS],
        "summary": parsed["summary"] if isinstance(parsed.get("summary"), str) else "",
        "steps": _strings(parsed.get("steps"))[:MAX_LIST_ITEMS],
        "module": parsed["module"] if isinstance(parsed.get("module"), str) else "",
        "riskFlag": parsed["riskFlag"] if isinstance(parsed.get("riskFlag"), bool) else False,
        "riskDetail": parsed["riskDetail"] if isinstance(parsed.get("riskDetail"), str) else "",
        "generatedAt": now,
        "transcriptWindowMinutes": window_minutes,
    }


async def run_analysis(request, chat=None, search=None, env=os.environ, now_ms=None):
    """`request` is the backend's insight request (see internal.py). Returns the
    insight the frontend shows. `chat(messages, max_tokens)` defaults to the
    copilot model; raises openrouter.LLMError when the model can't be reached."""
    chat = chat or (lambda messages, max_tokens: openrouter.chat(messages, openrouter.copilot_model(env),
                                                                  max_tokens, env=env))
    context = await build_context(request, search, env, now_ms)
    log.info("[copilot] context: transcript %d chars, %d material chunks, %d previous notes",
             len(context["transcript"]), len(context["study_material"]), len(context["previous_notes"]))

    started = time.monotonic()
    raw, verdict = await asyncio.gather(
        chat([{"role": "system", "content": SYSTEM_PROMPT},
              {"role": "user", "content": build_analysis_prompt(context)}], 1024),
        safety.run_safety_scan(context["transcript"], chat, env),
    )
    log.info("[copilot] analysis + safety scan took %.1fs", time.monotonic() - started)

    insight = parse_insight(raw, context["window_minutes"])
    insight["riskLevel"] = verdict["level"]
    insight["riskDetail"] = verdict["rationale"] or insight.get("riskDetail") or ""
    if verdict["level"] != "none":
        insight["riskFlag"] = True
    return insight
