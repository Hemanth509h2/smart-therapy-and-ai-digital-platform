"""Tests for staad_ai/service.py, the entry point the AI features use to run the
STAAD pipeline. The database and the AI model are faked."""

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from staad_ai import postgres_adapters, service  # noqa: E402
from staad_ai.models import ClientContext, RetrievedChunk  # noqa: E402
from staad_ai.retrieval import UnifiedRetriever  # noqa: E402

ENV = {"DATABASE_URL_2": "postgres://fake", "OPENROUTER_API_KEY": "k"}
NOW_MS = 1_800_000_000_000


class FakeClients:
    async def get_client(self, client_id, session_id, therapist_id):
        if therapist_id != "t-1":
            raise PermissionError("Client or session not found in the requested therapist scope.")
        return ClientContext(client_id="c-1", therapist_id="t-1", name="Asha Rao", age=9,
                             conditions=["ADHD"], phone="+91 98765 43210")


class FakeSessions:
    async def get_session(self, session_id, client_id, therapist_id, minutes):
        return {"sessionId": session_id, "therapistId": therapist_id, "clientId": client_id,
                "transcript": [], "moduleEvents": [], "inCallNotes": [], "activeModuleId": None,
                "state": {"status": "IN_PROGRESS"}}


class FakeHistory:
    async def get_history(self, client_id, therapist_id, request):
        return {"previousNotes": [], "reports": [], "progressMetrics": []}


class FakeSemantic:
    async def search(self, query, therapist_id, client_id, top_k, threshold):
        return [RetrievedChunk(text="Grounding helps with worry.", file_name="notes.pdf", similarity=0.9)]


@pytest.fixture(autouse=True)
def fake_database(monkeypatch):
    monkeypatch.setattr(postgres_adapters, "create_postgres_retriever",
                        lambda env: UnifiedRetriever(FakeClients(), FakeSessions(), FakeHistory(), FakeSemantic()))


def request(**extra):
    return {"type": "context", "therapistUid": "t-1", "semanticQuery": "worry",
            "transcript": [{"speaker": "client", "text": "I keep worrying about school", "timestamp": NOW_MS},
                           {"speaker": "Therapist", "text": "Tell me more", "timestamp": NOW_MS + 1000}],
            "moduleEvents": ["worry-box opened"], "inCallNotes": ["calmer after breathing"],
            "activeModuleId": "worry-box", **extra}


def test_context_combines_database_and_live_data():
    reply = asyncio.run(service.run(request(), "s-1", ENV))

    assert reply["type"] == "context"
    sections = reply["context"]["sections"]
    assert "CLIENT: I keep worrying about school" in sections["transcript"]
    assert "THERAPIST: Tell me more" in sections["transcript"]
    assert "worry-box opened" in sections["activity"]
    assert "calmer after breathing" in sections["activity"]
    assert "Grounding helps with worry." in sections["knowledge"]
    assert reply["context"]["metadata"]["sessionId"] == "s-1"
    assert reply["context"]["metadata"]["activeModuleId"] == "worry-box"
    # Only the first name reaches the prompt; the phone number never does.
    assert "Rao" not in reply["context"]["userPrompt"]
    assert "98765" not in reply["context"]["userPrompt"]


def test_session_comes_from_caller_not_body():
    reply = asyncio.run(service.run(request(sessionId="someone-elses"), "s-1", ENV))

    assert reply["context"]["metadata"]["sessionId"] == "s-1"


def test_other_therapist_is_forbidden():
    with pytest.raises(PermissionError):
        asyncio.run(service.run(request(therapistUid="t-2"), "s-1", ENV))


@pytest.mark.parametrize("change", [{"therapistUid": ""}, {"topK": 0}, {"windowMinutes": "5"}])
def test_bad_requests(change):
    with pytest.raises(ValueError):
        asyncio.run(service.run(request(**change), "s-1", ENV))


def test_is_configured_needs_hipaa_database():
    assert service.is_configured(ENV)
    assert not service.is_configured({"OPENROUTER_API_KEY": "k"})


def fake_chat(replies):
    async def chat(messages, max_tokens):
        system = messages[0]["content"]
        return replies["safety"] if "safeguarding monitor" in system else replies["main"]
    return chat


def test_staad_insight_uses_safety_scan_for_risk():
    model = service.OpenRouterModel(chat=fake_chat({
        "main": json.dumps({"emotions": ["anxious"], "summary": "Worried about school.",
                            "steps": ["Try grounding"], "module": "grounding-game", "riskFlag": False}),
        "safety": json.dumps({"level": "watch", "cue": "keep worrying", "rationale": "Persistent worry."}),
    }), env=ENV)

    reply = asyncio.run(service.run(request(type="staad-insight"), "s-1", ENV, model=model))

    insight = reply["insight"]
    assert reply["type"] == "staad-insight"
    assert insight["summary"] == "Worried about school."
    assert insight["module"] == "grounding-game"
    assert insight["riskFlag"] is True
    assert insight["riskLevel"] == "watch"
    assert insight["riskDetail"] == "Persistent worry."


def test_staad_insight_model_failure():
    async def failing(messages, max_tokens):
        raise RuntimeError("OpenRouter returned 500")
    model = service.OpenRouterModel(chat=failing, env=ENV)

    with pytest.raises(RuntimeError):
        asyncio.run(service.run(request(type="staad-insight"), "s-1", ENV, model=model))


class HistoryWithRecords(FakeHistory):
    async def get_history(self, client_id, therapist_id, request):
        return {"previousNotes": [], "progressMetrics": [{"metricType": "anxiety", "value": 6}],
                "reports": [{"type": "session_report", "content": "Practised box breathing. Call Asha on +91 98765 43210."}]}


def use_history(monkeypatch, history):
    monkeypatch.setattr(postgres_adapters, "create_postgres_retriever",
                        lambda env: UnifiedRetriever(FakeClients(), FakeSessions(), history, FakeSemantic()))


def test_session_history_is_redacted_records_for_the_session_owner(monkeypatch):
    use_history(monkeypatch, HistoryWithRecords())

    text = asyncio.run(service.session_history("s-1", ENV, owner=lambda sid, env: "t-1"))

    assert "Practised box breathing." in text
    assert "metricType: anxiety" in text
    assert "98765" not in text


def test_session_history_is_empty_without_database_session_or_owner():
    assert asyncio.run(service.session_history("s-1", {})) == ""
    assert asyncio.run(service.session_history(None, ENV)) == ""
    assert asyncio.run(service.session_history("s-1", ENV, owner=lambda sid, env: None)) == ""


def test_session_history_never_raises():
    def broken(sid, env):
        raise ConnectionError("postgres://user:pass@host is down")

    assert asyncio.run(service.session_history("s-1", ENV, owner=broken)) == ""


def test_copilot_prompt_includes_client_records():
    from copilot import analysis
    from copilot.prompt import build_analysis_prompt

    async def no_search(uid, transcript, env):
        return []

    async def records(sid, env):
        return "session_report: Practised box breathing." if sid == "s-1" else ""

    context = asyncio.run(analysis.build_context({"transcript": []}, no_search, {}, session_id="s-1", history=records))

    assert "CLIENT RECORDS" in build_analysis_prompt(context)
    assert "Practised box breathing." in build_analysis_prompt(context)


def test_copilot_prompt_has_no_records_section_when_empty():
    from copilot import analysis
    from copilot.prompt import build_analysis_prompt

    async def no_search(uid, transcript, env):
        return []

    context = asyncio.run(analysis.build_context({"transcript": []}, no_search, {}))

    assert "CLIENT RECORDS" not in build_analysis_prompt(context)


def test_call_plan_notes_include_client_records():
    from call_plan.handler import with_client_records

    async def records(sid, env):
        return "session_report: Practised box breathing." if sid == "s-1" else ""

    assert asyncio.run(with_client_records("My notes", "s-1", {}, records)).endswith(
        "FROM THE CLIENT'S RECORDS (earlier reports, progress notes and metrics):\n"
        "session_report: Practised box breathing.")
    assert asyncio.run(with_client_records("My notes", "s-2", {}, records)) == "My notes"


def test_live_data_ignores_malformed_items():
    live = service.live_session_data({"transcript": [None, {"text": ""}, {"text": "hi", "speaker": "robot"}],
                                      "moduleEvents": [1, "", "ok"], "inCallNotes": "not a list"})

    assert [(t.text, t.speaker) for t in live["transcript"]] == [("hi", "unknown")]
    assert live["moduleEvents"] == [{"event": "ok"}]
    assert live["inCallNotes"] == []
