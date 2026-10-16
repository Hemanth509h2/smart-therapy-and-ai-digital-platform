"""STAAD AI service: one server, one package per AI feature.

stt/  Sarvam speech-to-text relay. Sarvam's streaming STT WebSocket only accepts
      the API key as an HTTP *header*, and browsers cannot set headers on a
      WebSocket. So the browser connects here (no key), and the stt package opens
      the upstream Sarvam socket with the header and relays audio frames up and
      transcript messages back down. The key never reaches the client.

Auth: the backend's /api/stt-token mints a short-lived HMAC token bound to
the session id; stt verifies it with the same STT_TOKEN_SECRET. This service
needs no database or Firebase access.
"""

import asyncio
import json
import logging
import os
import time
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from websockets.asyncio.server import serve

import stt

log = logging.getLogger("ai")


def load_env_file(path):
    """Minimal .env loader. Variables already set in the environment win."""
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        os.environ.setdefault(key, value)


def first_values(query_string):
    """Query params as {name: first value}, like URLSearchParams.get."""
    out = {}
    for k, v in parse_qsl(query_string, keep_blank_values=True):
        out.setdefault(k, v)
    return out


def allowed_origins(env=os.environ):
    # Optional comma-separated allow-list, e.g. "https://app.staad.in". Unset = any
    # origin (local dev); the HMAC token is still required when the secret is set.
    origins = [o.strip() for o in env.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    return origins or None


def log_line(text):
    print(f"[ai] {text}", flush=True)


def process_request(connection, request):
    connection.started_at = time.monotonic()
    # Never log request.path: the query string carries the STT token.
    path = urlsplit(request.path).path
    if path in ("/health", "/"):
        response = connection.respond(HTTPStatus.OK, json.dumps({
            "ok": True,
            "sarvamConfigured": bool(os.environ.get("SARVAM_API_KEY")),
        }))
        del response.headers["Content-Type"]  # Headers is a multidict; replace, don't append
        response.headers["Content-Type"] = "application/json"
        return response
    if path not in stt.STREAM_PATHS:
        return connection.respond(HTTPStatus.FORBIDDEN, "Forbidden\n")
    return None  # continue with the WebSocket handshake


def process_response(connection, request, response):
    # One line per HTTP request, path only (the query string carries the STT token).
    path = urlsplit(request.path).path if request else "?"
    ms = (time.monotonic() - getattr(connection, "started_at", time.monotonic())) * 1000
    is_ws = request is not None and request.headers.get("Upgrade", "").lower() == "websocket"
    if response.status_code == HTTPStatus.SWITCHING_PROTOCOLS:
        log_line(f"WS  {path} → open ({ms:.0f}ms)")
    else:
        log_line(f"{'WS ' if is_ws else 'GET'} {path} → {response.status_code} ({ms:.0f}ms)")
    return None


async def handler(ws):
    path = urlsplit(ws.request.path).path
    try:
        await stt.handle_proxy_connection(ws, first_values(urlsplit(ws.request.path).query))
    finally:
        secs = time.monotonic() - getattr(ws, "started_at", time.monotonic())
        reason = f" {ws.close_reason}" if ws.close_reason else ""
        log_line(f"WS  {path} → closed {ws.close_code}{reason} after {secs:.1f}s")


def make_server(port, host=None):
    """Returns the websockets server (use with `async with`). host=None = all interfaces."""
    return serve(handler, host, port, process_request=process_request, process_response=process_response,
                 origins=allowed_origins())


async def main():
    port = int(os.environ.get("PORT") or "4100")
    if os.environ.get("NODE_ENV") == "production" and not os.environ.get("STT_TOKEN_SECRET"):
        log.warning("[ai] STT_TOKEN_SECRET is not set - every STT connection will be refused.")
    async with make_server(port) as server:
        print(f"> AI service ready on http://localhost:{port} (STT WebSocket at /sarvam-stream)", flush=True)
        await server.serve_forever()


if __name__ == "__main__":
    load_env_file(Path(__file__).with_name(".env"))
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
