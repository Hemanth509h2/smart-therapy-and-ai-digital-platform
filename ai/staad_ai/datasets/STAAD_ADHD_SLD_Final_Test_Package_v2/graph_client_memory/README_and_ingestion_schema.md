# STAAD ADHD + SLD Graph / Client Memory — Final Testing Build

## Purpose
This is the client-memory schema and synthetic graph example that complements the general ADHD + SLD Knowledge Memory dataset. It is not a real client dataset.

## Files
- `graph_ontology.json`: node/relationship types.
- `graph_nodes.jsonl` / `.csv`: nodes used in a synthetic demonstration.
- `graph_edges.jsonl` / `.csv`: synthetic relationships.
- `session_memory_template.jsonl`: template for authorized session-derived events.
- `data_dictionary.csv`: field guide.
- `illustrative_client_memory_schema.sql`: illustrative backing schema.

## Metadata correction
All graph node and edge rows now carry `synthetic_example=true` and `real_client_data=false`. This explicitly marks the entire example graph as demonstration-only, including generic concept nodes linked into the synthetic example. Do not load these examples as real client records.

## Keep the memory layers separate
- Knowledge Memory: general clinical/educational facts and guidelines; use the sibling `knowledge_memory` folder.
- Current Session Memory: authorized current-session transcript spans/events/notes with timestamps and provenance.
- Client/Graph Memory: client-specific information extracted only from authorized STAAD sources, with source references and review status.

## Required production provenance
Each actual event should retain pseudonymous `client_id`, `session_id`/`event_id`, source record/span ID, timestamp, source type, attribution, author/system, review status, and retention policy reference. Keep client-reported information distinct from clinician observations and AI-generated summaries.

## Safety and interpretation rules
- A symptom mention is not a diagnosis.
- A temporal relationship is not proof of causation.
- Longitudinal patterns must be tentative, source-linked, supported by repeated events, and reviewed under STAAD's approved workflow.
- Risk/safety data requires restricted access and STAAD's approved human escalation process; do not autonomously triage emergencies.
- Apply least-privilege access, encryption, audit logging, retention/deletion controls, and applicable privacy/legal review.

## Test status
The schema and references can be smoke-tested with the included test set. This package does not claim clinical approval or measured RAG accuracy.
