# staad_ai: retrieval and context pipeline

Ported from the `STAAD` working copy (`context/staad_ai`, `context/tests`). It's
a library for the AI features (the call plan / AI Notes and the AI assistant)
and has no endpoint of its own. It's copied into the Docker image.

- `service.py`: the entry point, `run(request, session_id)`. Request fields are listed at the top of the file.
- `models.py`: typed contracts (`PipelineInput`, `RetrievedContext`, `AIInsight`, ...)
- `retrieval.py`: `UnifiedRetriever`, which gathers client, session, historical and semantic sources
- `pipeline.py`: scope checks, PII redaction, token budget, prompt build, `analyze()`
- `postgres_adapters.py`: read-only adapters for the HIPAA database (`DATABASE_URL_2`). Study
  material is searched with `rag.EMBEDDING_MODEL`, the model it's stored with.
- `dataset_benchmark.py`, `diagnose_retrieval.py`: offline lexical benchmark over `datasets/`,
  which writes to `benchmark_results/`
- `docs/`: design notes carried over from STAAD (paths in them refer to the old layout)

## How a request is scoped

The caller passes the session its token was verified for, and the pipeline
ignores any `sessionId` in the request. Every SQL query filters on
`therapistUid` and on the client and session. `UnifiedRetriever` and the
pipeline then check ownership again before building the prompt. Private notes
are never included. Emails and phone numbers are redacted, and only the
client's first name reaches the prompt. The database has no transcript or
module events, so those come with the request.

## Run from ai/

```bash
python -m pytest tests/test_staad_ai_*.py
python -m staad_ai.dataset_benchmark
python -m staad_ai.diagnose_retrieval
```
