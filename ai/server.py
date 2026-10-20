"""STAAD AI service: one server, one package per AI feature.

stt/  Sarvam speech-to-text relay. Sarvam's streaming STT WebSocket only accepts
      the API key as an HTTP *header*, and browsers cannot set headers on a
      WebSocket. So the browser connects here (no key), and the stt package opens
      the upstream Sarvam socket with the header and relays audio frames up and
      transcript messages back down. The key never reaches the client.

call_plan/  AI agent for the AI Notes popup. Reads a client's previous notes
      (uploaded file or pasted text) and recommends modules and a task list for
      the call, then marks tasks covered from the live transcript. Calls
      OpenRouter with OPENROUTER_API_KEY.

Auth: the backend's /api/stt-token and /api/call-plan-token mint short-lived
HMAC tokens bound to the session id (and, for call_plan, a scope); each package
verifies them with the same STT_TOKEN_SECRET. This service needs no database or
Firebase access.
"""

import asyncio
import json
import logging
import os
import time
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from websockets.asyncio.server import ServerConnection, serve

import call_plan
import stt

log = logging.getLogger("ai")

# Largest WebSocket message accepted: a notes file (call_plan.MAX_FILE_BYTES) plus
# headroom. STT audio frames are far smaller.
MAX_MESSAGE_BYTES = call_plan.MAX_FILE_BYTES + 64 * 1024
access_log = logging.getLogger("ai.access")


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


class HandshakeFailureFilter(logging.Filter):
    """websockets logs a full traceback for every failed handshake. A request
    that was parsed is already in the access log; probes answered by
    ProbeAnsweringConnection and bare TCP checks (connect, send nothing, close)
    are dropped. For anything else that never parsed, keep a single line."""

    def filter(self, record):
        if record.getMessage() != "opening handshake failed" or not record.exc_info:
            return True
        ws = getattr(record, "websocket", None)  # set by websockets' LoggerAdapter
        if ws is not None and (ws.request is not None or getattr(ws, "probe_answered", False)
                               or not getattr(ws, "received_bytes", True)):
            return False
        exc = record.exc_info[1]
        record.msg, record.args, record.exc_info = "%s bad request (%s)", (client_ip(ws), type(exc).__name__), None
        record.levelno, record.levelname = logging.INFO, "INFO"
        record.name = access_log.name
        return True


def setup_logging():
    """Same line format as gunicorn's own log, so both read as one stream."""
    logging.basicConfig(level=logging.WARNING, format="[%(asctime)s] [%(process)d] [%(levelname)s] %(message)s",
                        datefmt="%Y-%m-%d %H:%M:%S %z")
    access_log.setLevel(logging.INFO)
    logging.getLogger("websockets.server").addFilter(HandshakeFailureFilter())


def client_ip(connection, request=None):
    forwarded = request.headers.get("X-Forwarded-For") if request is not None else None
    if forwarded:
        return forwarded.split(",")[0].strip()
    try:
        return connection.remote_address[0]
    except (AttributeError, IndexError, TypeError):
        return "-"


HEALTH_PATHS = ("/health", "/")


def health_body():
    return json.dumps({
        "ok": True,
        "sarvamConfigured": bool(os.environ.get("SARVAM_API_KEY")),
        "callPlanConfigured": call_plan.is_configured(),
    })


class ProbeAnsweringConnection(ServerConnection):
    """Answers plain HTTP requests that the WebSocket handshake can't parse.

    websockets only accepts `GET ... HTTP/1.1` and drops anything else without a
    reply. Hosting platforms probe with other requests (Render's port scanner and
    health checks), get nothing back, and decide no HTTP server is listening
    ("No open HTTP ports detected"). Those requests get a minimal response here:
    200 with the health status for / and /health, 400 otherwise.
    """

    received_bytes = False
    probe_answered = False
    _sniffed = False
    _head = b""

    def data_received(self, data):
        if self._sniffed:
            return super().data_received(data)
        self.received_bytes = True
        self._head += data
        line_end = self._head.find(b"\r\n")
        if line_end < 0 and len(self._head) < 8192:
            return  # wait for the whole request line
        self._sniffed = True
        head, self._head = self._head, b""
        parts = (head[:line_end] if line_end >= 0 else head).split(b" ")
        if len(parts) == 3 and parts[0] == b"GET" and parts[2] == b"HTTP/1.1":
            return super().data_received(head)
        self.probe_answered = True
        self.transport.write(probe_response(parts))
        self.transport.close()


def probe_response(parts):
    method = parts[0] if parts else b""
    path = urlsplit(parts[1].decode("latin-1")).path if len(parts) > 1 else ""
    if method in (b"GET", b"HEAD") and path in HEALTH_PATHS:
        status, body, ctype = "200 OK", health_body().encode(), "application/json"
    else:
        status, body, ctype = "400 Bad Request", b"Bad Request\n", "text/plain"
    headers = f"HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n"
    return headers.encode() + (b"" if method == b"HEAD" else body)


def process_request(connection, request):
    connection.started_at = time.monotonic()
    # Never log request.path: the query string carries the STT token.
    path = urlsplit(request.path).path
    if path in HEALTH_PATHS:
        response = connection.respond(HTTPStatus.OK, health_body())
        del response.headers["Content-Type"]  # Headers is a multidict; replace, don't append
        response.headers["Content-Type"] = "application/json"
        return response
    if path not in stt.STREAM_PATHS and path not in call_plan.PATHS:
        return connection.respond(HTTPStatus.FORBIDDEN, "Forbidden\n")
    return None  # continue with the WebSocket handshake


def process_response(connection, request, response):
    # One line per HTTP request, path only (the query string carries the STT token).
    path = urlsplit(request.path).path if request else "?"
    ms = (time.monotonic() - getattr(connection, "started_at", time.monotonic())) * 1000
    is_ws = request is not None and request.headers.get("Upgrade", "").lower() == "websocket"
    agent = request.headers.get("User-Agent", "-") if request else "-"
    access_log.info('%s "%s %s" %s %.0fms "%s"', client_ip(connection, request), "WS" if is_ws else "GET",
                    path, response.status_code, ms, agent)
    return None


async def handler(ws):
    path = urlsplit(ws.request.path).path
    query = first_values(urlsplit(ws.request.path).query)
    try:
        if path in call_plan.PATHS:
            await call_plan.handle_connection(ws, query)
        else:
            await stt.handle_proxy_connection(ws, query)
    finally:
        secs = time.monotonic() - getattr(ws, "started_at", time.monotonic())
        reason = f" {ws.close_reason}" if ws.close_reason else ""
        access_log.info('%s "WS %s" closed %s%s after %.1fs', client_ip(ws, ws.request), path, ws.close_code,
                        reason, secs)


def make_server(port=None, host=None, sock=None):
    """Returns the websockets server (use with `async with`). host=None = all interfaces.
    Pass `sock` instead of port/host to serve on an already-bound socket (gunicorn)."""
    return serve(handler, host, port, sock=sock, process_request=process_request,
                 process_response=process_response, origins=allowed_origins(), max_size=MAX_MESSAGE_BYTES,
                 create_connection=ProbeAnsweringConnection)


def warn_if_misconfigured():
    if os.environ.get("NODE_ENV") == "production" and not os.environ.get("STT_TOKEN_SECRET"):
        log.warning("[ai] STT_TOKEN_SECRET is not set - every STT and call-plan connection will be refused.")
    if not call_plan.is_configured():
        log.warning("[ai] OPENROUTER_API_KEY is not set - the call-plan agent is off.")


async def main():
    port = int(os.environ.get("PORT") or "4100")
    warn_if_misconfigured()
    async with make_server(port) as server:
        print(f"> AI service ready on http://localhost:{port} (STT WebSocket at /sarvam-stream, "
              f"call-plan agent at /call-plan)", flush=True)
        await server.serve_forever()


if __name__ == "__main__":
    load_env_file(Path(__file__).with_name(".env"))
    setup_logging()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
