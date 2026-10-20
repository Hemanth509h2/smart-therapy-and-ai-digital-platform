"""Tests for the call-plan agent. The LLM is faked; nothing calls OpenRouter.
Run from ai/: python -m pytest tests"""

import asyncio
import base64
import hashlib
import hmac
import io
import json
import sys
import time
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from websockets.asyncio.client import connect  # noqa: E402

import server  # noqa: E402
from call_plan import agent, llm, module_reports  # noqa: E402
from call_plan.extract import ExtractError, extract_text  # noqa: E402
from call_plan.handler import authorize  # noqa: E402
from stt import verify_stt_token  # noqa: E402

MODULES = [
    {"id": "worry-box", "name": "Worry Box", "category": "Anxiety & Depression", "desc": "Worry containment"},
    {"id": "5-4-3-2-1-grounding", "name": "5-4-3-2-1 Grounding", "category": "Anxiety & Depression", "desc": ""},
    {"id": "thought-challenger", "name": "Thought Challenger", "category": "General", "desc": "CBT"},
]

READING = json.dumps({
    "summary": "Adult client with work anxiety, improving.",
    "concerns": ["work anxiety", "poor sleep"],
    "progress": ["uses breathing exercise"],
    "open_items": ["sleep diary homework"],
    "risk": "none",
    "risk_detail": "",
})

GOOD_PLAN = json.dumps({
    "focus": "Reduce work-related worry.",
    "modules": [{"id": "worry-box", "reason": "Notes describe constant worry about deadlines."}],
    "tasks": [
        {"text": "Check in on the week", "module_id": None},
        {"text": "Review the sleep diary", "module_id": None},
        {"text": "Run Worry Box on deadline worries", "module_id": "worry-box"},
        {"text": "Set next week's homework", "module_id": None},
    ],
})


def fake_chat(*replies):
    """An async chat() that returns `replies` in order and records each call's messages."""
    calls = []
    queue = list(replies)

    async def chat(messages, max_tokens=0):
        calls.append(messages)
        return queue.pop(0)

    chat.calls = calls
    return chat


async def no_reports(query, catalogue):
    return []


def mint(sid, secret, scope=None, exp_in=600):
    payload = {"sid": sid, "exp": int(time.time()) + exp_in}
    if scope:
        payload["scope"] = scope
    b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), b64.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    return f"{b64}.{sig}"


# --- extraction ---------------------------------------------------------------

def make_docx(*paragraphs):
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f'<w:document xmlns:w="{w}"><w:body>{body}</w:body></w:document>')
    return buf.getvalue()


def test_extracts_docx_paragraphs():
    assert extract_text("Notes.DOCX", make_docx("Session 3", "Client slept better")) == "Session 3\nClient slept better"


def test_extracts_text_file():
    assert extract_text("notes.txt", "  hello\n".encode()) == "hello"


@pytest.mark.parametrize("name,data", [
    ("notes.doc", b"old word"),
    ("notes.pdf", b"not a pdf"),
    ("notes.docx", b"not a zip"),
    ("notes.txt", b"   "),
    ("notes.txt", b"x" * (5 * 1024 * 1024 + 1)),
])
def test_rejects_unreadable_files(name, data):
    with pytest.raises(ExtractError):
        extract_text(name, data)


# --- tokens -------------------------------------------------------------------

def test_scoped_tokens_do_not_cross_features():
    plan_token, stt_token = mint("s1", "secret", "call-plan"), mint("s1", "secret")
    assert verify_stt_token(plan_token, "s1", "secret", scope="call-plan")
    assert not verify_stt_token(plan_token, "s1", "secret")  # can't open an STT stream
    assert not verify_stt_token(stt_token, "s1", "secret", scope="call-plan")
    assert not verify_stt_token(plan_token, "s2", "secret", scope="call-plan")


def test_authorize_fails_closed_in_production():
    assert authorize({}, {"NODE_ENV": "production"}) == "Agent auth not configured"
    assert authorize({"sid": "s1", "token": mint("s1", "k", "call-plan")}, {"STT_TOKEN_SECRET": "k"}) is None
    assert authorize({"sid": "s1", "token": "bad"}, {"STT_TOKEN_SECRET": "k"}) == "Unauthorized"


# --- the agent ----------------------------------------------------------------

def test_make_plan_reads_then_plans():
    chat = fake_chat(READING, GOOD_PLAN)
    steps = []

    async def on_step(s):
        steps.append(s)

    plan = asyncio.run(agent.make_plan("notes", MODULES, "Asha", on_step=on_step, chat=chat, search=no_reports))
    assert steps == ["reading", "searching", "planning"]
    assert plan["modules"] == [{"id": "worry-box", "name": "Worry Box",
                                "reason": "Notes describe constant worry about deadlines.", "sources": []}]
    assert plan["usedModuleReports"] is False
    assert [t["id"] for t in plan["tasks"]] == ["t1", "t2", "t3", "t4"]
    assert plan["tasks"][2]["moduleId"] == "worry-box"
    assert not any(t["done"] for t in plan["tasks"])
    assert "worry-box: Worry Box" in chat.calls[1][1]["content"]  # catalogue reached the planner


def test_make_plan_retries_with_the_problems():
    bad = json.dumps({"modules": [{"id": "made-up", "reason": "x"}], "tasks": ["one"]})
    chat = fake_chat(READING, bad, GOOD_PLAN)
    plan = asyncio.run(agent.make_plan("notes", MODULES, chat=chat, search=no_reports))
    retry_prompt = chat.calls[2][-1]["content"]
    assert '"made-up" is not a module id' in retry_prompt
    assert "Write between 3 and 8 tasks." in retry_prompt
    assert plan["modules"][0]["id"] == "worry-box"


def test_make_plan_gives_up_after_two_bad_plans():
    chat = fake_chat(READING, "no json", "still none")
    with pytest.raises(llm.LLMError):
        asyncio.run(agent.make_plan("notes", MODULES, chat=chat, search=no_reports))


def test_risk_puts_a_safety_task_first():
    risky = json.loads(READING) | {"risk": "watch", "risk_detail": "mentions feeling hopeless"}
    plan = asyncio.run(agent.make_plan("notes", MODULES, chat=fake_chat(json.dumps(risky), GOOD_PLAN),
                                         search=no_reports))
    assert plan["risk"] == "watch"
    assert plan["tasks"][0]["text"] == "Safety check-in first: mentions feeling hopeless"


def test_module_report_excerpts_ground_the_plan():
    queries = []

    async def search(query, catalogue):
        queries.append((query, set(catalogue)))
        return [
            {"moduleId": "worry-box", "moduleName": "Worry Box", "section": "Conditions and target problems",
             "text": "For persistent, uncontrollable worry.", "score": 0.61},
            {"moduleId": "worry-box", "moduleName": "Worry Box", "section": "Safety considerations and limitations",
             "text": "Not a substitute for crisis care.", "score": None},
        ]

    chat = fake_chat(READING, GOOD_PLAN)
    plan = asyncio.run(agent.make_plan("notes", MODULES, chat=chat, search=search))
    query, ids = queries[0]
    assert "work anxiety" in query and "sleep diary homework" in query  # searched with the reading
    assert ids == {"worry-box", "5-4-3-2-1-grounding", "thought-challenger"}  # only allowed modules
    planner_prompt = chat.calls[1][1]["content"]
    assert "[worry-box] Worry Box - Conditions and target problems:\nFor persistent, uncontrollable worry." in planner_prompt
    assert plan["usedModuleReports"] is True
    assert plan["modules"][0]["sources"] == ["Conditions and target problems", "Safety considerations and limitations"]


def test_module_report_search_is_off_without_config():
    catalogue = agent.normalise_catalogue(MODULES)
    assert asyncio.run(module_reports.search("anxiety", catalogue, env={})) == []


def test_database_url_drops_prisma_options():
    url = "postgresql://u:p@host/db?sslmode=require&pool_timeout=0&connection_limit=5"
    assert module_reports.libpq_url(url) == "postgresql://u:p@host/db?sslmode=require"
    assert module_reports.name_key("5-4-3-2-1 Grounding") == module_reports.name_key("5 4 3 2 1 grounding")


def test_keyword_query_is_plain_words_only():
    assert module_reports.keyword_query("Exam anxiety; anxiety & 'racing' thoughts!") == "exam | anxiety | racing | thoughts"
    assert module_reports.keyword_query("a b 12") == ""


def test_make_plan_needs_notes_and_modules():
    with pytest.raises(ValueError):
        asyncio.run(agent.make_plan("  ", MODULES, chat=fake_chat()))
    with pytest.raises(ValueError):
        asyncio.run(agent.make_plan("notes", [], chat=fake_chat()))


def test_check_progress_returns_only_open_task_ids():
    tasks = [{"id": "t1", "text": "Check in", "done": True}, {"id": "t2", "text": "Review diary", "done": False}]
    chat = fake_chat(json.dumps({"covered": ["t1", "t2", "t9"], "next": "Try Worry Box."}))
    result = asyncio.run(agent.check_progress(tasks, [{"speaker": "therapist", "text": "How was the diary?"}], chat=chat))
    assert result == {"covered": ["t2"], "next": "Try Worry Box."}


def test_check_progress_needs_a_transcript():
    with pytest.raises(ValueError):
        asyncio.run(agent.check_progress([{"id": "t1", "text": "x"}], [], chat=fake_chat()))


# --- over the WebSocket -------------------------------------------------------

def test_plan_over_websocket_with_file(monkeypatch):
    monkeypatch.setenv("STT_TOKEN_SECRET", "k")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    monkeypatch.setattr(llm, "chat", fake_chat(READING, GOOD_PLAN))
    monkeypatch.setattr(module_reports, "search", no_reports)

    async def run():
        async with server.make_server(0, "127.0.0.1") as srv:
            port = srv.sockets[0].getsockname()[1]
            url = f"ws://127.0.0.1:{port}/call-plan?sid=s1&token={mint('s1', 'k', 'call-plan')}"
            async with connect(url) as ws:
                await ws.send(json.dumps({"type": "plan", "modules": MODULES, "file": {"name": "n.docx"}}))
                await ws.send(make_docx("Client worries about deadlines"))
                return [json.loads(m) async for m in ws]

    messages = asyncio.run(run())
    assert [m["type"] for m in messages] == ["status", "status", "status", "plan"]
    assert messages[-1]["plan"]["modules"][0]["id"] == "worry-box"


def test_websocket_rejects_an_stt_token(monkeypatch):
    monkeypatch.setenv("STT_TOKEN_SECRET", "k")

    async def run():
        async with server.make_server(0, "127.0.0.1") as srv:
            port = srv.sockets[0].getsockname()[1]
            async with connect(f"ws://127.0.0.1:{port}/call-plan?sid=s1&token={mint('s1', 'k')}") as ws:
                await ws.wait_closed()
                return ws.close_code, ws.close_reason

    assert asyncio.run(run()) == (1008, "Unauthorized")
