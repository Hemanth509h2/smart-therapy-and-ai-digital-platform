"""Postgres + NVIDIA embeddings, shared by everything that searches stored text:
the module reports (call_plan/module_reports.py, module_report_chunks), the
therapist's study material (copilot/study_material.py, document_chunks), and the
scripts that fill those tables (scripts/).

Needs DATABASE_URL (the backend's Postgres, with pgvector) and NVIDIA_API_KEY.
Both tables are embedded with EMBEDDING_MODEL at EMBEDDING_DIMENSIONS: stored
text with input_type "passage", searches with "query". Mixing models makes the
similarity scores meaningless, so change them only together with a re-ingest.
"""

import json
import os
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

NVIDIA_EMBEDDINGS_URL = "https://integrate.api.nvidia.com/v1/embeddings"
EMBEDDING_MODEL = "nvidia/llama-nemotron-embed-vl-1b-v2"
EMBEDDING_DIMENSIONS = 1024
CONNECT_TIMEOUT_SECONDS = 20
# NVIDIA usually answers in under a second but sometimes hangs; retry instead of waiting.
EMBED_TIMEOUT_SECONDS = 6
EMBED_ATTEMPTS = 3

# Prisma-only options in the backend's DATABASE_URL that libpq rejects.
_PRISMA_PARAMS = {"pool_timeout", "connection_limit", "pgbouncer", "schema", "socket_timeout",
                  "connect_timeout", "statement_cache_size"}


def is_configured(env=os.environ):
    return bool(env.get("DATABASE_URL"))


def can_embed(env=os.environ):
    return bool(env.get("NVIDIA_API_KEY"))


def libpq_url(url):
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k not in _PRISMA_PARAMS]
    return urlunsplit(parts._replace(query=urlencode(query)))


def connect(env=os.environ):
    import psycopg  # imported here so the service starts without it when search is off

    return psycopg.connect(libpq_url(env["DATABASE_URL"]), connect_timeout=CONNECT_TIMEOUT_SECONDS)


def vector_literal(embedding):
    """pgvector text form, for `%s::vector` parameters."""
    return "[" + ",".join(f"{x:.7f}" for x in embedding) + "]"


def embed(texts, input_type, env=os.environ, timeout=EMBED_TIMEOUT_SECONDS, attempts=EMBED_ATTEMPTS):
    """Blocking. Returns one embedding per text, in order. Retries timeouts, 429s
    and 5xx with a short backoff; anything else raises at once."""
    for attempt in range(1, attempts + 1):
        try:
            return _embed_once(texts, input_type, env, timeout)
        except (TimeoutError, urllib.error.URLError) as e:
            retryable = not isinstance(e, urllib.error.HTTPError) or e.code == 429 or e.code >= 500
            if not retryable or attempt == attempts:
                raise
            time.sleep(min(2 ** (attempt - 1), 8) if isinstance(e, urllib.error.HTTPError) else 0)


def _embed_once(texts, input_type, env, timeout):
    body = json.dumps({
        "model": EMBEDDING_MODEL,
        "input": list(texts),
        "input_type": input_type,
        "dimensions": EMBEDDING_DIMENSIONS,
        "encoding_format": "float",
        "truncate": "END",  # cut inputs over the model's 512 tokens rather than reject them
    }).encode()
    req = urllib.request.Request(NVIDIA_EMBEDDINGS_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {env.get('NVIDIA_API_KEY', '')}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=timeout) as res:
        data = sorted(json.loads(res.read())["data"], key=lambda d: d["index"])
    embeddings = [d["embedding"] for d in data]
    if len(embeddings) != len(texts) or any(len(e) != EMBEDDING_DIMENSIONS for e in embeddings):
        raise ValueError(f"expected {len(texts)} embeddings of {EMBEDDING_DIMENSIONS} dimensions")
    return embeddings
