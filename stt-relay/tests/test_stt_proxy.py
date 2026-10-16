# Mocked integration tests for the STT proxy. A local WebSocket server stands in
# for Sarvam (via SARVAM_WS_URL); no real credentials or network are used.
import asyncio
import base64
import hashlib
import hmac
import json
import time
from urllib.parse import urlsplit

import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from server import first_values
from stt_proxy import handle_proxy_connection, upstream_url, verify_stt_token

SECRET = "test-secret"


def mint(sid, exp_sec=None, secret=SECRET):
    exp_sec = int(time.time()) + 60 if exp_sec is None else exp_sec
    p = base64.urlsafe_b64encode(json.dumps({"sid": sid, "exp": exp_sec}).encode()).rstrip(b"=").decode()
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), p.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    return f"{p}.{sig}"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ("STT_TOKEN_SECRET", "SARVAM_API_KEY", "SARVAM_WS_URL", "NODE_ENV"):
        monkeypatch.delenv(k, raising=False)


async def proxy_handler(ws):
    await handle_proxy_connection(ws, first_values(urlsplit(ws.request.path).query))


async def close_info(ws):
    """Waits for the server to close the connection; returns (code, reason)."""
    try:
        while True:
            await ws.recv()
    except ConnectionClosed as e:
        return (e.rcvd.code, e.rcvd.reason) if e.rcvd else (None, "")


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 10))


def test_upstream_url_forwards_codec_and_rate_drops_unknown_and_unsafe():
    q = first_values("model=saaras:v3&mode=translate&sample_rate=16000&input_audio_codec=pcm_s16le"
                     "&sid=abc&token=zzz&language_code=a%26b")
    url = upstream_url(q, {})
    assert "input_audio_codec=pcm_s16le" in url
    assert "sample_rate=16000" in url
    assert "model=saaras%3Av3" in url
    assert "token" not in url
    assert "sid=" not in url
    assert "language_code" not in url
    assert url.startswith("wss://api.sarvam.ai/speech-to-text/ws?")


def test_verify_stt_token():
    assert verify_stt_token(mint("s1"), "s1", SECRET) is True
    assert verify_stt_token(mint("s1"), "s2", SECRET) is False
    assert verify_stt_token(mint("s1", 1), "s1", SECRET) is False
    assert verify_stt_token(mint("s1", secret="other"), "s1", SECRET) is False
    assert verify_stt_token("garbage", "s1", SECRET) is False
    assert verify_stt_token(mint("s1") + ".extra", "s1", SECRET) is False
    assert verify_stt_token(None, "s1", SECRET) is False
    assert verify_stt_token(mint("s1"), None, SECRET) is False


def test_closes_with_stt_not_configured_when_key_missing():
    async def go():
        async with serve(proxy_handler, "127.0.0.1", 0) as srv:
            port = srv.sockets[0].getsockname()[1]
            async with connect(f"ws://127.0.0.1:{port}/?sid=s") as c:
                return await close_info(c)
    assert run(go()) == (1011, "STT not configured")


def test_relays_queued_audio_upstream_with_key_header_and_messages_back(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "dummy-not-real")
    seen = {}
    got = []

    async def fake_sarvam(ws):
        seen["header"] = ws.request.headers.get("api-subscription-key")
        seen["url"] = ws.request.path
        async for m in ws:
            got.append(m)
            await ws.send(json.dumps({"type": "data", "data": {"transcript": "hi"}}))

    async def go():
        async with serve(fake_sarvam, "127.0.0.1", 0) as up:
            monkeypatch.setenv("SARVAM_WS_URL", f"ws://127.0.0.1:{up.sockets[0].getsockname()[1]}/speech-to-text/ws")
            async with serve(proxy_handler, "127.0.0.1", 0) as srv:
                port = srv.sockets[0].getsockname()[1]
                async with connect(f"ws://127.0.0.1:{port}/?sid=s&sample_rate=16000&input_audio_codec=pcm_s16le") as c:
                    # Sent while upstream may still be connecting: must be queued, in order.
                    await c.send("a1")
                    await c.send("a2")
                    replies = [await c.recv(), await c.recv()]
                    return replies

    replies = run(go())
    assert got == ["a1", "a2"]
    assert all(json.loads(r)["data"]["transcript"] == "hi" for r in replies)
    assert seen["header"] == "dummy-not-real"
    assert "input_audio_codec=pcm_s16le" in seen["url"]


def test_reports_upstream_auth_failure_401(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "dummy-not-real")

    async def plain_401(reader, writer):
        await reader.readuntil(b"\r\n\r\n")
        writer.write(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        await writer.drain()
        writer.close()

    async def go():
        http = await asyncio.start_server(plain_401, "127.0.0.1", 0)
        async with http:
            monkeypatch.setenv("SARVAM_WS_URL", f"ws://127.0.0.1:{http.sockets[0].getsockname()[1]}/x")
            async with serve(proxy_handler, "127.0.0.1", 0) as srv:
                port = srv.sockets[0].getsockname()[1]
                async with connect(f"ws://127.0.0.1:{port}/?sid=s") as c:
                    return await close_info(c)

    assert run(go()) == (1011, "Upstream auth failed")


def test_reports_upstream_connection_failure(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "dummy-not-real")
    monkeypatch.setenv("SARVAM_WS_URL", "ws://127.0.0.1:1/x")

    async def go():
        async with serve(proxy_handler, "127.0.0.1", 0) as srv:
            port = srv.sockets[0].getsockname()[1]
            async with connect(f"ws://127.0.0.1:{port}/?sid=s") as c:
                return await close_info(c)

    assert run(go()) == (1011, "Upstream unavailable")


def test_enforces_stt_token_when_secret_is_set(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "dummy-not-real")
    monkeypatch.setenv("STT_TOKEN_SECRET", SECRET)

    async def go():
        async with serve(proxy_handler, "127.0.0.1", 0) as srv:
            port = srv.sockets[0].getsockname()[1]
            async with connect(f"ws://127.0.0.1:{port}/?sid=s1&token={mint('other')}") as c:
                return await close_info(c)

    assert run(go()) == (1008, "Unauthorized")


def test_fails_closed_in_production_without_secret(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "dummy-not-real")
    monkeypatch.setenv("NODE_ENV", "production")

    async def go():
        async with serve(proxy_handler, "127.0.0.1", 0) as srv:
            port = srv.sockets[0].getsockname()[1]
            async with connect(f"ws://127.0.0.1:{port}/?sid=s1") as c:
                return await close_info(c)

    assert run(go()) == (1008, "STT auth not configured")


def test_upstream_closing_closes_the_browser_socket(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "dummy-not-real")

    async def closes_after_first(ws):
        await ws.recv()
        await ws.close()

    async def go():
        async with serve(closes_after_first, "127.0.0.1", 0) as up:
            monkeypatch.setenv("SARVAM_WS_URL", f"ws://127.0.0.1:{up.sockets[0].getsockname()[1]}/x")
            async with serve(proxy_handler, "127.0.0.1", 0) as srv:
                port = srv.sockets[0].getsockname()[1]
                async with connect(f"ws://127.0.0.1:{port}/?sid=s") as c:
                    await c.send("a1")
                    return await close_info(c)

    code, reason = run(go())
    # No auth/config reason, so the browser treats it as transient and retries.
    assert "auth" not in reason.lower() and "not configured" not in reason.lower()
