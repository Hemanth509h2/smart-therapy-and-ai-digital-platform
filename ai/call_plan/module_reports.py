"""Search the STAAD module reports (module_report_chunks) for the call-plan agent.

The reports were chunked and embedded by scripts/ingest_module_reports.py: one
row per report section (1. Module overview ... 13. Advantages), embedded with
rag.EMBEDDING_MODEL. Queries use the same model, with input_type "query".

Needs DATABASE_URL (the backend's app database). With NVIDIA_API_KEY it searches by
meaning (embeddings); without it, or when NVIDIA doesn't answer, it falls back to
Postgres keyword search over the same chunks. If the database can't be reached,
the agent plans from the module catalogue alone.
"""

import asyncio
import logging
import os
import re

import rag
from rag import libpq_url  # noqa: F401  (re-exported)

log = logging.getLogger("call-plan")

TOP_K = 8                  # best-matching sections across all modules
PER_MODULE = 2             # ... from at most this many sections per module
DETAIL_MODULES = 4         # modules whose selection + safety sections are added
DETAIL_SECTIONS = (8, 11)  # "Module selection criteria", "Safety considerations and limitations"
SKIP_SECTIONS = (12, 13)   # references and advantages don't help choose
MAX_EXCERPT_CHARS = 900


def name_key(name):
    """'5-4-3-2-1 Grounding' and '5 4 3 2 1 grounding' match; reports use catalogue names."""
    return re.sub(r"[^a-z0-9]+", "", str(name).lower())


def keyword_query(text):
    """'exam anxiety, racing thoughts' -> 'exam | anxiety | racing | thoughts' for to_tsquery.
    Only plain letters reach it, so the query can't be malformed."""
    words = dict.fromkeys(re.findall(r"[a-z]{3,}", text.lower()))
    return " | ".join(list(words)[:40])


_FILTER = """lower(regexp_replace(module_name, '[^a-zA-Z0-9]+', '', 'g')) = ANY(%(keys)s)
              AND NOT (section_number = ANY(%(skip)s))"""

# At most PER_MODULE sections from any one module, so several modules get compared.
# The table is a few hundred rows, so scoring every row is cheap.
def _best(score, condition=""):
    return f"""
            SELECT module_name, section_number, section_title, chunk_text, score FROM (
              SELECT module_name, section_number, section_title, chunk_text, {score} AS score,
                     row_number() OVER (PARTITION BY module_name ORDER BY {score} DESC) AS rank
              FROM module_report_chunks
              WHERE {_FILTER} {condition}
            ) ranked
            WHERE rank <= %(per_module)s
            ORDER BY score DESC
            LIMIT %(k)s"""


_BY_MEANING = _best("1 - (embedding <=> %(v)s::vector)")
_BY_KEYWORDS = _best("ts_rank(to_tsvector('english', chunk_text), to_tsquery('english', %(q)s))",
                     "AND to_tsvector('english', chunk_text) @@ to_tsquery('english', %(q)s)")


def _query(embedding, query_text, name_keys, env):
    """Best sections by meaning when `embedding` is given, else by keywords."""
    params = {"keys": name_keys, "skip": list(SKIP_SECTIONS), "k": TOP_K, "per_module": PER_MODULE}
    if embedding is not None:
        sql, params["v"] = _BY_MEANING, rag.vector_literal(embedding)
    else:
        sql, params["q"] = _BY_KEYWORDS, keyword_query(query_text)
        if not params["q"]:
            return [], []
    with rag.connect(rag.APP_DB, env) as conn:
        top = conn.execute(sql, params).fetchall()

        # The modules that matched best: add how to choose them and when not to.
        best = list(dict.fromkeys(row[0] for row in top))[:DETAIL_MODULES]
        detail = conn.execute(
            """
            SELECT module_name, section_number, section_title, chunk_text, NULL AS score
            FROM module_report_chunks
            WHERE module_name = ANY(%(names)s) AND section_number = ANY(%(sections)s)
            ORDER BY module_name, section_number
            """,
            {"names": best, "sections": list(DETAIL_SECTIONS)},
        ).fetchall() if best else []
    return top, detail


def _strip_header(chunk_text):
    """Chunks start with 'Module: / Category: / Section:' lines; the excerpt
    header repeats those, so keep only the body."""
    lines = chunk_text.split("\n")
    while lines and re.match(r"^(Module|Category|Section):", lines[0]):
        lines.pop(0)
    return " ".join(" ".join(lines).split())[:MAX_EXCERPT_CHARS]


async def search(query_text, catalogue, env=os.environ):
    """Returns excerpts [{moduleId, moduleName, section, text, score}] from the
    reports of modules in `catalogue` ({id: {name, ...}}), best match first, then
    the selection and safety sections of the top modules. Returns [] when search
    is off or fails; it never raises."""
    if not rag.is_configured(rag.APP_DB, env) or not query_text.strip():
        return []
    ids_by_name = {name_key(m["name"]): mid for mid, m in catalogue.items()}
    embedding = None
    if rag.can_embed(env):
        try:
            [embedding] = await asyncio.to_thread(rag.embed, [query_text], "query", env)
        except Exception as e:
            log.warning("[call-plan] embedding failed (%s), using keyword search", type(e).__name__)
    try:
        # Only the reports of modules this therapist may launch.
        top, detail = await asyncio.to_thread(_query, embedding, query_text, list(ids_by_name), env)
    except Exception as e:  # database unreachable: plan without the reports rather than fail
        log.warning("[call-plan] module report search failed: %s", type(e).__name__)
        return []

    seen, out = set(), []
    for name, number, title, text, score in [*top, *detail]:
        if (name, number) in seen:
            continue
        seen.add((name, number))
        if name_key(name) not in ids_by_name:
            continue
        out.append({
            "moduleId": ids_by_name[name_key(name)],
            "moduleName": name,
            "section": title,
            "text": _strip_header(text),
            "score": round(float(score), 3) if score is not None else None,
        })
    return out

