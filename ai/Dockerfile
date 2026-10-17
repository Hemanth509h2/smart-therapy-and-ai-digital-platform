# STAAD AI service (STT relay), port 4100, served by gunicorn.
#
#   docker build -t staad-ai .
#   docker run -p 4100:4100 -e SARVAM_API_KEY=... -e STT_TOKEN_SECRET=... \
#     -e ALLOWED_ORIGINS=https://app.example.com staad-ai
#   (or mount the file: -v "$PWD/.env:/app/.env:ro"; gunicorn.conf.py loads it)
#
# NODE_ENV=production makes the relay refuse every connection when
# STT_TOKEN_SECRET is missing. WEB_CONCURRENCY sets the worker count (default 1).
# The app user has no home directory, so gunicorn's control socket goes in /tmp.

FROM python:3.12-slim

ENV NODE_ENV=production \
    PORT=4100 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    GUNICORN_CMD_ARGS="--control-socket /tmp/gunicorn.ctl"

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY server.py worker.py gunicorn.conf.py ./
COPY stt ./stt

RUN useradd --system --no-create-home --uid 10001 app
USER app

EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"4100\")}/health', timeout=4)"
CMD ["gunicorn"]
