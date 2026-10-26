# STAAD Python AI pipeline

`staad_ai` is a dependency-free Python implementation of the retrieval and
context architecture in the repository's `context/` documentation. It provides
typed data contracts, a unified multi-source retrieval coordinator, context
normalization and filtering, identity/ownership checks, PII redaction, token
budgeting, prompt construction, parallel model and safeguarding calls, insight
normalization, and optional persistence/audit hooks.

The Python package is currently standalone. It does not change the existing
Next.js API route. Database, embedding, model, and persistence integrations are
injected through the protocols in `staad_ai.retrieval` and `staad_ai.pipeline`;
production adapters must scope every database query to the authenticated
therapist and client.

```python
from staad_ai import PipelineInput, UnifiedRetriever
from staad_ai.pipeline import analyze

request = PipelineInput(
    therapist_id="authenticated-therapist-id",
    session_id="session-id",
    client_id="client-id",
    semantic_query="coping strategies for worry",
)

# Supply implementations of ClientRetriever, SessionRetriever,
# HistoricalRetriever, SemanticRetriever, and ModelService from your app.
# insight = await analyze(request, retrieval=UnifiedRetriever(...), model=model)
```

The pipeline functions `process_pipeline` and `process_pipeline_with_details`
stop before any model call and can be used independently for prompt inspection.
