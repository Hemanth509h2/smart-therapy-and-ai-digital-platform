"""Search the therapist's own study material (document_chunks) for the copilot.

Rows are added by scripts/study_material.py, one per ~400-word chunk of an
uploaded PDF, keyed by the therapist's Firebase uid and embedded with
rag.EMBEDDING_MODEL. Never raises: no database, no NVIDIA key, no material, or
any failure all mean "no study material", and the analysis goes on without it.
"""

import asyncio
import logging
import os

import rag

log = logging.getLogger("copilot")

TOP_K = 3
MIN_SIMILARITY = 0.25

_SEARCH = """
    SELECT chunk_text, file_name, chunk_index, 1 - (embedding <=> %(v)s::vector) AS similarity
    FROM document_chunks
    WHERE therapist_id = %(tid)s AND 1 - (embedding <=> %(v)s::vector) > %(min)s
    ORDER BY embedding <=> %(v)s::vector
    LIMIT %(k)s"""


def _has_material(therapist_uid, env):
    with rag.connect(env) as conn:
        return conn.execute("SELECT EXISTS (SELECT 1 FROM document_chunks WHERE therapist_id = %s)",
                            (therapist_uid,)).fetchone()[0]


def _query(embedding, therapist_uid, env):
    with rag.connect(env) as conn:
        return conn.execute(_SEARCH, {"v": rag.vector_literal(embedding), "tid": therapist_uid,
                                      "min": MIN_SIMILARITY, "k": TOP_K}).fetchall()


async def search(therapist_uid, query_text, env=os.environ):
    """[{text, fileName, chunkIndex, similarity}], best match first."""
    if not (rag.is_configured(env) and rag.can_embed(env) and therapist_uid and query_text.strip()):
        return []
    try:
        # Most therapists have none: skip the embedding call then.
        if not await asyncio.to_thread(_has_material, therapist_uid, env):
            return []
        [embedding] = await asyncio.to_thread(rag.embed, [query_text], "query", env)
        rows = await asyncio.to_thread(_query, embedding, therapist_uid, env)
    except Exception as e:
        log.warning("[copilot] study material search failed: %s", type(e).__name__)
        return []
    return [{"text": text, "fileName": name, "chunkIndex": int(index), "similarity": float(similarity)}
            for text, name, index, similarity in rows]
