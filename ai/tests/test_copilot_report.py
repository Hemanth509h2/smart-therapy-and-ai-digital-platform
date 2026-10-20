"""Tests for the copilot (AI insight), the session report, and the internal
endpoint the backend calls them through. The AI model is faked."""

import asyncio
import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from websockets.asyncio.client import connect  # noqa: E402

import internal  # noqa: E402
import openrouter  # noqa: E402
import server  # noqa: E402
from copilot import analysis, safety, study_material  # noqa: E402
from copilot.prompt import build_analysis_prompt  # noqa: E402
from report.generate import format_inputs, write_report  # noqa: E402
from scripts.study_material import chunk_text, clean_pdf_text  # noqa: E402
from test_call_plan import mint  # noqa: E402

NOW = 1_800_000_000_000  # ms

INSIGHT = json.dumps({
    "emotions": ["sad", "tired", ""],
    "summary": "Client describes low mood and withdrawal.",
    "steps": ["Explore sleep", "Plan one activity"],
    "module": "emotion-wheel",
    "riskFlag": False,
    "riskDetail": "",
})


def verdict(level, rationale=""):
    return json.dumps({"level": level, "cue": "what's the point" if level != "none" else "", "rationale": rationale})


def fake_chat(insight_reply, safety_reply):
    """Answers by prompt, since the analysis and the safety scan run in parallel."""
    calls = []

    async def chat(messages, max_tokens=0):
        calls.append((messages, max_tokens))
        return safety_reply if messages[0]["content"] == safety.SAFETY_SYSTEM_PROMPT else insight_reply

    chat.calls = calls
    return chat


async def no_material(therapist_uid, query_text, env=None):
    return []


def request(**overrides):
    return {
        "type": "insight",
        "therapistUid": "uid-1",
        "client": {"name": "Test Client", "age": 14, "conditions": ["anxiety"], "sessionNumber": 3},
        "windowMinutes": 5,
        "transcript": [
            {"speaker": "client", "text": "I sleep all day.", "timestamp": NOW - 60_000},
            {"speaker": "therapist", "text": "How is your mood?", "timestamp": NOW - 30_000},
            {"speaker": "client", "text": "Too old to show.", "timestamp": NOW - 10 * 60_000},
        ],
        "moduleEvents": ["Finished Worry Box with 3 worries"],
        "inCallNotes": ["Seems tired"],
        "previousNotes": [{"content": "Low mood last week.", "createdAt": "2026-10-13T10:00:00.000Z",
                           "sessionNumber": 1}],
        **overrides,
    }


def analyse(req, chat):
    return asyncio.run(analysis.run_analysis(req, chat=chat, search=no_material, now_ms=NOW))


# --- copilot ------------------------------------------------------------------

def test_transcript_window_keeps_only_recent_lines():
    text = analysis.format_transcript(request()["transcript"], 5, now_ms=NOW)
    assert text == "[CLIENT]: I sleep all day.\n[THERAPIST]: How is your mood?"
    assert analysis.format_transcript([], 5, now_ms=NOW) == "No transcript available for this session yet."
    old = [{"speaker": "client", "text": "x", "timestamp": NOW - 99 * 60_000}]
    assert analysis.format_transcript(old, 5, now_ms=NOW) == "No transcript available for this time window."


def test_prompt_has_every_part_of_the_context():
    context = asyncio.run(analysis.build_context(request(), search=no_material, now_ms=NOW))
    prompt = build_analysis_prompt(context)
    for part in ["session number 3 for Test Client, age 14", "[CLIENT]: I sleep all day.",
                 "- Finished Worry Box with 3 worries", "- Seems tired", "Session 1 (2026-10-13):",
                 "Low mood last week.", "AVAILABLE THERAPY MODULES: word-building"]:
        assert part in prompt
    assert "Too old to show" not in prompt
    assert "RELEVANT STUDY MATERIAL" not in prompt


def test_insight_is_parsed_and_cleaned():
    insight = analyse(request(), fake_chat(INSIGHT, verdict("none")))
    assert insight["emotions"] == ["sad", "tired"]
    assert insight["module"] == "emotion-wheel"
    assert insight["riskFlag"] is False and insight["riskLevel"] == "none"
    assert insight["transcriptWindowMinutes"] == 5


def test_safety_scan_raises_the_flag_the_analysis_missed():
    insight = analyse(request(), fake_chat(INSIGHT, verdict("watch", "Passive hopelessness.")))
    assert insight["riskFlag"] is True
    assert insight["riskLevel"] == "watch"
    assert insight["riskDetail"] == "Passive hopelessness."


def test_unreadable_safety_reply_is_a_soft_flag_not_safe():
    insight = analyse(request(), fake_chat(INSIGHT, "sorry, I can't"))
    assert insight["riskLevel"] == "watch" and insight["riskFlag"] is True


def test_unreadable_insight_falls_back():
    insight = analyse(request(), fake_chat("not json", verdict("none")))
    assert insight["summary"] == "Analysis failed: could not parse LLM response"
    assert insight["steps"] == ["Review the transcript manually"]


def test_safety_scan_skips_an_empty_transcript():
    chat = fake_chat(INSIGHT, verdict("urgent"))
    assert asyncio.run(safety.run_safety_scan("  ", chat))["level"] == "none"
    assert chat.calls == []


def test_study_material_search_is_off_without_config():
    assert asyncio.run(study_material.search("uid-1", "anxiety", env={})) == []


# --- report -------------------------------------------------------------------

def test_report_prompt_lists_the_session_data():
    text = format_inputs({
        "transcript": [{"speaker": "client", "text": "Hello"}],
        "moduleEvents": [{"detail": "Played Simon Says"}],
        "therapistNotes": [],
        "callPlan": {"focus": "Sleep", "modules": [{"name": "Worry Box"}],
                     "tasks": [{"text": "Review diary", "done": True}, {"text": "Homework", "done": False}]},
    }, {"name": "Test Client", "age": 9, "conditions": ["ADHD"], "sessionNumber": 4})
    for part in ["Name: Test Client", "Age: 9", "Conditions: ADHD", "Session number: 4", "[client] Hello",
                 "- Played Simon Says", "(No in-call notes were recorded.)", "Focus: Sleep",
                 "Recommended modules: Worry Box", "- [x] Review diary", "- [ ] Homework"]:
        assert part in text


def test_report_prompt_says_when_nothing_was_captured():
    text = format_inputs({}, {"name": "X"})
    assert "(No transcript was captured for this session.)" in text
    assert "(No module activity was recorded.)" in text
    assert "PLAN FOR THIS CALL" not in text


def test_write_report_returns_trimmed_content_and_model(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "some/model")

    async def chat(messages, max_tokens):
        return "\n## Session Summary\nShort.\n"

    result = asyncio.run(write_report({}, {"name": "X"}, chat=chat))
    assert result == {"content": "## Session Summary\nShort.", "model": "some/model"}


# --- study material script ----------------------------------------------------

def test_study_material_chunks_overlap():
    chunks = chunk_text(" ".join(f"w{i}" for i in range(1000)))
    assert [c["word_count"] for c in chunks] == [400, 400, 360]
    assert chunks[1]["text"].split()[0] == "w320"
    assert clean_pdf_text("thera-\npy is\ngood\fNext") == "therapy is good\n\nNext"


# --- the internal endpoint ----------------------------------------------------

def call_internal(sid, token, message):
    async def run():
        async with server.make_server(0, "127.0.0.1") as srv:
            port = srv.sockets[0].getsockname()[1]
            async with connect(f"ws://127.0.0.1:{port}/internal?sid={sid}&token={token}") as ws:
                await ws.send(json.dumps(message))
                replies = [json.loads(m) async for m in ws]
                return replies, ws.close_code, ws.close_reason

    return asyncio.run(run())


def test_internal_insight_over_websocket(monkeypatch):
    monkeypatch.setenv("STT_TOKEN_SECRET", "k")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    fake = fake_chat(INSIGHT, verdict("none"))

    async def chat(messages, model, max_tokens=1500, temperature=0.2, env=None):
        return await fake(messages, max_tokens)

    monkeypatch.setattr(openrouter, "chat", chat)
    monkeypatch.setattr(study_material, "search", no_material)
    req = request(transcript=[{"speaker": "client", "text": "Hi", "timestamp": time.time() * 1000}])
    replies, code, _ = call_internal("s1", mint("s1", "k", "internal"), req)
    assert code == 1000
    assert replies[0]["type"] == "insight"
    assert replies[0]["insight"]["summary"] == "Client describes low mood and withdrawal."


@pytest.mark.parametrize("scope", [None, "call-plan"])
def test_internal_rejects_tokens_for_other_features(monkeypatch, scope):
    monkeypatch.setenv("STT_TOKEN_SECRET", "k")

    async def run():
        async with server.make_server(0, "127.0.0.1") as srv:
            port = srv.sockets[0].getsockname()[1]
            async with connect(f"ws://127.0.0.1:{port}/internal?sid=s1&token={mint('s1', 'k', scope)}") as ws:
                await ws.wait_closed()
                return ws.close_code, ws.close_reason

    assert asyncio.run(run()) == (1008, "Unauthorized")


def test_internal_refuses_everything_in_production_without_a_secret():
    assert internal.authorize({}, env={"NODE_ENV": "production"}) == "Internal auth not configured"
    assert internal.authorize({}, env={}) is None


def test_internal_reports_bad_requests_and_missing_key():
    assert asyncio.run(internal.run({"type": "nope"}, env={}))["code"] == "bad_request"
    assert asyncio.run(internal.run(None, env={}))["code"] == "bad_request"
    assert asyncio.run(internal.run({"type": "report"}, env={}))["code"] == "not_configured"


def test_internal_turns_model_failures_into_an_error_reply(monkeypatch):
    async def failing(*args, **kwargs):
        raise openrouter.LLMError("OpenRouter returned 404")

    monkeypatch.setattr(openrouter, "chat", failing)
    reply = asyncio.run(internal.run({"type": "report", "inputs": {}, "client": {"name": "X"}},
                                     env={"OPENROUTER_API_KEY": "k"}))
    assert reply["code"] == "model"


def test_origin_less_clients_are_allowed_when_origins_are_set():
    assert server.allowed_origins({"ALLOWED_ORIGINS": "https://app.example"}) == ["https://app.example", None]
    assert server.allowed_origins({}) is None
