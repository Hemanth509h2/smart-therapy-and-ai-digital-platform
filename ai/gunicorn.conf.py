"""Gunicorn settings for the AI service. Run `gunicorn` from ai/ and this file is
picked up automatically. Worker count comes from WEB_CONCURRENCY (default 1)."""

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import server  # noqa: E402

server.load_env_file(HERE / ".env")
server.setup_logging()

wsgi_app = "server:handler"  # gunicorn requires an app; worker.WebSocketWorker serves it
worker_class = "worker.WebSocketWorker"
bind = f"0.0.0.0:{os.environ.get('PORT') or '4100'}"


def on_starting(arbiter):
    server.warn_if_misconfigured()
