#!/bin/sh
# Imports the STAAD workflows once per data volume, then starts n8n as usual.
set -e

marker="${N8N_USER_FOLDER:-/home/node}/.n8n/.staad-workflows-imported"

if [ ! -f "$marker" ]; then
  backend="${STAAD_BACKEND_URL:-https://YOUR-BACKEND-URL}"
  backend="${backend%/}"
  tmp="$(mktemp -d)"
  for f in /staad/workflows/*.json; do
    sed "s#https://YOUR-BACKEND-URL#${backend}#g" "$f" > "$tmp/$(basename "$f")"
  done
  echo "[staad] importing workflows (backend: $backend)"
  n8n import:workflow --separate --input="$tmp"
  rm -rf "$tmp"
  mkdir -p "$(dirname "$marker")"
  touch "$marker"
fi

exec /docker-entrypoint.sh "$@"
