# =============================================================================
# STAAD AI service - Docker image
# =============================================================================
#
# What this is:
#   The Python speech-to-text relay. The browser sends session audio here, this
#   service forwards it to Sarvam (adding the secret API key) and sends the
#   transcript back. It listens on port 4100 and is started by gunicorn.
#
# How to build (run inside the ai/ folder):
#   docker build -t staad-ai .
#
# How to run:
#   docker run -p 4100:4100 --env-file .env staad-ai
#
#   -p 4100:4100     makes the relay reachable at http://localhost:4100
#   --env-file .env  gives the container your settings
#
# Where the settings come from:
#   SARVAM_API_KEY, OPENROUTER_API_KEY, DATABASE_URL, NVIDIA_API_KEY,
#   STT_TOKEN_SECRET (same value as in backend/.env) and ALLOWED_ORIGINS are
#   read when the container starts.
#   WEB_CONCURRENCY sets how many worker processes run (default 1).
#
# Safety:
#   NODE_ENV=production is set below. In production the relay refuses every
#   connection if STT_TOKEN_SECRET is missing, instead of letting anyone in.
# =============================================================================


# Start from the official Python image.
FROM python:3.12-slim

# All following commands run inside /app.
WORKDIR /app

# Production mode (see "Safety" above).
ENV NODE_ENV=production

# Print logs immediately instead of buffering them.
ENV PYTHONUNBUFFERED=1

# Do not write .pyc files into the image.
ENV PYTHONDONTWRITEBYTECODE=1

# gunicorn opens a small control socket. The "app" user below has no home
# folder, so the socket goes in /tmp.
ENV GUNICORN_CMD_ARGS="--control-socket /tmp/gunicorn.ctl"

# Copy only the dependency list first. Docker caches this step, so packages
# are reinstalled only when requirements.txt changes.
COPY requirements.txt ./

# Install websockets, gunicorn, pypdf and psycopg.
RUN pip install --no-cache-dir -r requirements.txt

# Copy the service code:
#   server.py         the WebSocket server and /health
#   worker.py         lets gunicorn run the WebSocket server
#   gunicorn.conf.py  port, worker type and logging
#   internal.py       the endpoint the backend calls for insights and reports
#   openrouter.py     OpenRouter chat, shared by the AI features
#   rag.py            Postgres + NVIDIA embeddings, shared by the searches
#   stt/              the speech-to-text relay
#   call_plan/        the call-plan AI agent
#   copilot/          AI insights ("Analyse") and the safety scan
#   report/           the end-of-session report
# scripts/ (filling the search tables) is run by hand, not in the image.
COPY server.py worker.py gunicorn.conf.py internal.py openrouter.py rag.py ./
COPY stt ./stt
COPY call_plan ./call_plan
COPY copilot ./copilot
COPY report ./report

# Create a normal user and stop running as root.
RUN useradd --system --uid 10001 app
USER app

# The port the relay listens on.
EXPOSE 4100

# Docker checks every 30 seconds that /health still answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4100/health', timeout=4)"

# Start gunicorn. It reads its settings from gunicorn.conf.py.
CMD ["gunicorn"]
