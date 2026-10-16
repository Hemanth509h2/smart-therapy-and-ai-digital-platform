"""Sarvam speech-to-text WebSocket proxy (served by ai/server.py).

Sarvam's streaming endpoint takes the API key as an HTTP header, which browsers
cannot set on a WebSocket. The browser connects here without a key; the key is
read from the environment and attached to the upstream connection only.
Nothing in this file logs the key, headers, query strings, or transcript text.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
from urllib.parse import urlencode

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.protocol import State

log = logging.getLogger("stt-proxy")

DEFAULT_SARVAM_WS = "wss://api.sarvam.ai/speech-to-text/ws"

# WebSocket paths the browser connects to.
STREAM_PATHS = {"/sarvam-stream", "/api/sarvam-stream"}

# Query params forwarded to Sarvam. input_audio_codec + sample_rate are REQUIRED
# for raw PCM; dropping them makes Sarvam parse the audio as WAV.
PASS_PARAMS = [
    "model", "mode", "language-code", "language_code", "sample_rate", "input_audio_codec",
    "high_vad_sensitivity", "vad_signals", "flush_signal",
]
SAFE_VALUE = re.compile(r"[A-Za-z0-9_:.\-]{1,32}")
MAX_QUEUED = 200  # ~ 200 * 256ms of audio; bounds memory if upstream never opens


def upstream_url(query, env=os.environ):
    """`query` maps each param to its first value (like URLSearchParams.get)."""
    params = []
    for k in PASS_PARAMS:
        v = query.get(k)
        if v is not None and SAFE_VALUE.fullmatch(v):
            params.append((k, v))
    base = env.get("SARVAM_WS_URL") or DEFAULT_SARVAM_WS
    return f"{base}?{urlencode(params)}"


def _b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def verify_stt_token(token, sid, secret, now_ms=None):
    """Token format from backend/src/lib/sessions/stt-token.ts:
    base64url(payload).base64url(hmac-sha256), payload = {"sid", "exp" (seconds)}."""
    if not isinstance(token, str) or not sid:
        return False
    parts = token.split(".")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return False
    payload_b64, sig = parts
    expected = _b64url(hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig.encode(), expected.encode()):
        return False
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, TypeError):
        return False
    if not isinstance(payload, dict):
        return False
    exp = payload.get("exp")
    if isinstance(exp, bool) or not isinstance(exp, (int, float)):
        return False
    now_ms = time.time() * 1000 if now_ms is None else now_ms
    return payload.get("sid") == sid and exp * 1000 > now_ms


def authorize(query, env=os.environ):
    """Returns None when allowed, otherwise a short close reason."""
    secret = env.get("STT_TOKEN_SECRET")
    if not secret:
        # Fail closed in production; dev may run without a token secret.
        return "STT auth not configured" if env.get("NODE_ENV") == "production" else None
    return None if verify_stt_token(query.get("token"), query.get("sid"), secret) else "Unauthorized"


async def _safe_close(ws, code=1000, reason=""):
    try:
        await ws.close(code, reason)
    except Exception:
        pass


def _as_text(msg):
    return msg if isinstance(msg, str) else msg.decode("utf-8", "replace")


async def handle_proxy_connection(client, query, env=os.environ):
    denied = authorize(query, env)
    if denied:
        return await _safe_close(client, 1008, denied)
    api_key = env.get("SARVAM_API_KEY")
    if not api_key:
        return await _safe_close(client, 1011, "STT not configured")

    queue = []  # browser audio that arrives before Sarvam is ready
    state = {"upstream": None}

    async def pump_client():
        try:
            async for msg in client:
                text = _as_text(msg)
                upstream = state["upstream"]
                if upstream is not None:
                    await upstream.send(text)
                elif len(queue) < MAX_QUEUED:
                    queue.append(text)
        except ConnectionClosed:
            pass

    async def open_upstream():
        return await connect(
            upstream_url(query, env),
            additional_headers={"api-subscription-key": api_key},
            ping_interval=None,  # Sarvam is not known to answer pings; don't risk timeouts
            max_size=None,
        )

    client_task = asyncio.create_task(pump_client())
    connect_task = asyncio.create_task(open_upstream())
    try:
        # The browser may leave while Sarvam is still connecting.
        await asyncio.wait({client_task, connect_task}, return_when=asyncio.FIRST_COMPLETED)
        if not connect_task.done():
            connect_task.cancel()
            return
        try:
            upstream = connect_task.result()
        except InvalidStatus as e:
            status = e.response.status_code
            log.error("[stt-proxy] Sarvam handshake rejected, status %s", status)
            reason = "Upstream auth failed" if status in (401, 403) else "Upstream unavailable"
            return await _safe_close(client, 1011, reason)
        except Exception as e:
            log.error("[stt-proxy] upstream error: %s", type(e).__name__)
            return await _safe_close(client, 1011, "Upstream unavailable")

        async def pump_upstream():
            try:
                async for msg in upstream:
                    if client.state is State.OPEN:
                        await client.send(_as_text(msg))
            except ConnectionClosed:
                pass

        try:
            if client_task.done():  # browser left right as Sarvam opened
                return
            # Drain anything queued while connecting, then go live. Messages that
            # arrive during a send are appended and drained by the same loop.
            while queue:
                await upstream.send(queue.pop(0))
            state["upstream"] = upstream
            upstream_task = asyncio.create_task(pump_upstream())
            await asyncio.wait({client_task, upstream_task}, return_when=asyncio.FIRST_COMPLETED)
            upstream_task.cancel()
        except ConnectionClosed:
            pass
        finally:
            queue.clear()
            await _safe_close(upstream)
            await _safe_close(client)
    finally:
        client_task.cancel()
