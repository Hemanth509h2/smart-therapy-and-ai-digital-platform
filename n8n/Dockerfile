# n8n with the STAAD workflows, port 5678.
#
#   docker build -t staad-n8n .
#   docker run -p 5678:5678 -v staad-n8n-data:/home/node/.n8n \
#     -e STAAD_BACKEND_URL=https://api.example.com \
#     -e N8N_ENCRYPTION_KEY=<openssl rand -hex 32> \
#     -e GENERIC_TIMEZONE=Asia/Kolkata \
#     staad-n8n
#
# On the first start the four workflows are imported (inactive), with
# https://YOUR-BACKEND-URL replaced by STAAD_BACKEND_URL. They are imported only
# once per data volume, so edits made in n8n are never overwritten. Credentials
# (x-api-key header auth, WhatsApp, Anthropic) still have to be created in the
# n8n UI; see README.md.
#
# Keep /home/node/.n8n on a volume and N8N_ENCRYPTION_KEY fixed, or saved
# credentials are lost on restart.

FROM n8nio/n8n:2.43.7

ENV GENERIC_TIMEZONE=Asia/Kolkata \
    TZ=Asia/Kolkata \
    N8N_PORT=5678 \
    N8N_DIAGNOSTICS_ENABLED=false \
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true

COPY --chown=node:node 0*.json /staad/workflows/
COPY --chown=node:node docker/entrypoint.sh /staad/entrypoint.sh

EXPOSE 5678
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${N8N_PORT:-5678}/healthz" >/dev/null || exit 1
ENTRYPOINT ["tini", "--", "/bin/sh", "/staad/entrypoint.sh"]
