# Tests for the HTTP/WebSocket front door in server.py (health, paths, origins, .env).
import asyncio
import json
import urllib.error
import urllib.request

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

import server


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ("STT_TOKEN_SECRET", "SARVAM_API_KEY", "SARVAM_WS_URL", "NODE_ENV", "ALLOWED_ORIGINS"):
        monkeypatch.delenv(k, raising=False)


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 10))


async def with_server(fn):
    async with server.make_server(0, host="127.0.0.1") as srv:
        return await fn(srv.sockets[0].getsockname()[1])


def http_get(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.status, r.headers.get("Content-Type"), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type"), e.read().decode()


async def ws_status(url, origin=None):
    """'open:<code> <reason>' if the handshake succeeded, else 'http <status>'."""
    try:
        async with connect(url, origin=origin) as c:
            try:
                while True:
                    await c.recv()
            except ConnectionClosed as e:
                return f"open:{e.rcvd.code} {e.rcvd.reason}" if e.rcvd else "open:"
    except InvalidStatus as e:
        return f"http {e.response.status_code}"


@pytest.mark.parametrize("path", ["/health", "/"])
def test_health_reports_ok_and_whether_sarvam_is_configured(monkeypatch, path):
    monkeypatch.setenv("SARVAM_API_KEY", "dummy-not-real")

    async def go(port):
        return await asyncio.to_thread(http_get, f"http://127.0.0.1:{port}{path}")

    status, ctype, body = run(with_server(go))
    assert status == 200
    assert ctype == "application/json"
    assert json.loads(body) == {"ok": True, "sarvamConfigured": True}


def test_both_stream_paths_reach_the_proxy_and_others_are_forbidden():
    async def go(port):
        base = f"ws://127.0.0.1:{port}"
        return [await ws_status(base + p) for p in ("/sarvam-stream?sid=s", "/api/sarvam-stream?sid=s", "/nope")]

    # No SARVAM_API_KEY: a socket that reaches the proxy is closed as "not configured".
    assert run(with_server(go)) == ["open:1011 STT not configured", "open:1011 STT not configured", "http 403"]


def test_allowed_origins_is_enforced_when_set(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://ok.test, https://app.staad.in")

    async def go(port):
        url = f"ws://127.0.0.1:{port}/sarvam-stream?sid=s"
        return [await ws_status(url, "http://ok.test"), await ws_status(url, "http://evil.test"), await ws_status(url)]

    assert run(with_server(go)) == ["open:1011 STT not configured", "http 403", "http 403"]


def test_any_origin_allowed_when_unset():
    async def go(port):
        return await ws_status(f"ws://127.0.0.1:{port}/sarvam-stream?sid=s", "http://localhost:3000")

    assert run(with_server(go)) == "open:1011 STT not configured"


def test_first_values_matches_urlsearchparams_get():
    q = server.first_values("a=1&a=2&b=&c=x+y&d=%3A")
    assert q == {"a": "1", "b": "", "c": "x y", "d": ":"}


def test_load_env_file_does_not_override_existing_env(tmp_path, monkeypatch):
    monkeypatch.setenv("KEEP_ME", "from-env")
    for k in ("NEW_PLAIN", "NEW_QUOTED", "NEW_COMMENT"):
        monkeypatch.delenv(k, raising=False)
    env = tmp_path / ".env"
    env.write_text('# comment\nKEEP_ME=from-file\nNEW_PLAIN=abc=def\nNEW_QUOTED="q v"\nNEW_COMMENT=val # note\n\n')
    server.load_env_file(env)
    import os
    assert os.environ["KEEP_ME"] == "from-env"
    assert os.environ["NEW_PLAIN"] == "abc=def"
    assert os.environ["NEW_QUOTED"] == "q v"
    assert os.environ["NEW_COMMENT"] == "val"
    server.load_env_file(tmp_path / "missing.env")  # no error
