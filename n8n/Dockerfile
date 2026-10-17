# =============================================================================
# STAAD n8n - Docker image
# =============================================================================
#
# What this is:
#   n8n (workflow automation) with the four STAAD workflows from this folder:
#     01 daily doctor schedule, 02 session reminders,
#     03 send session link, 04 doctor WhatsApp chatbot.
#   It listens on port 5678.
#
# How to build (run inside the n8n/ folder):
#   docker build -t staad-n8n .
#
# How to run:
#   docker run -p 5678:5678 \
#     -v staad-n8n-data:/home/node/.n8n \
#     -e STAAD_BACKEND_URL=https://api.example.com \
#     staad-n8n
#
#   -p 5678:5678                      opens the n8n editor at http://localhost:5678
#   -v staad-n8n-data:/home/node/.n8n keeps workflows, credentials and n8n's
#                                     encryption key between restarts (important!)
#   -e STAAD_BACKEND_URL=...          the backend address used by the workflows
#
# What happens on the first start:
#   docker/entrypoint.sh imports the four workflows, replacing
#   https://YOUR-BACKEND-URL with STAAD_BACKEND_URL. This happens only once per
#   data volume, so changes you make in n8n are never overwritten.
#
# After the first start, in the n8n editor:
#   Create the credentials (x-api-key header auth, WhatsApp, Anthropic), pick
#   them on the nodes, then activate the workflows. See README.md.
# =============================================================================


# Start from the official n8n image (pinned version).
FROM n8nio/n8n:2.43.7

# The workflows are scheduled in India time.
ENV GENERIC_TIMEZONE=Asia/Kolkata
ENV TZ=Asia/Kolkata

# Copy the four workflow files.
COPY --chown=node:node 0*.json /staad/workflows/

# Copy the start script that imports them once.
COPY --chown=node:node docker/entrypoint.sh /staad/entrypoint.sh

# The port n8n listens on.
EXPOSE 5678

# Docker checks every 30 seconds that n8n still answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5678/healthz > /dev/null || exit 1

# Run our start script first. It then starts n8n the normal way.
ENTRYPOINT ["tini", "--", "/bin/sh", "/staad/entrypoint.sh"]
