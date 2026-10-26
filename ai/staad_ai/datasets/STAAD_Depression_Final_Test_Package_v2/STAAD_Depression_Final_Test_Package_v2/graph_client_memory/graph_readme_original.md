# STAAD Depression Graph + Client Memory

## What this package is
A STAAD-oriented **schema and synthetic demonstration dataset** for the client-specific memory layer. It is designed to sit beside the separate Depression Knowledge Memory package.

## What it is not
- It is **not** a real client dataset.
- It does not contain real observations, transcripts, or clinical histories.
- It is not a diagnostic model, treatment plan, or clinical approval.
- The synthetic examples are only there to demonstrate how events, provenance, and relationships can be represented.

## The three STAAD memory sources
1. **Knowledge Memory:** general clinical information and evidence-based guidance, kept in the Depression Knowledge Memory.
2. **Current Session Memory:** the authorized current session transcript/events/notes with source and timestamps.
3. **Client/Graph Memory:** client-specific, provenance-linked events and reviewed longitudinal context from authorized sessions.

The Context Manager should retrieve only relevant information from each source, respect client/session/time filters and access controls, preserve source attribution, and pass a concise evidence-linked context to the Copilot.

## Suggested flow
Authorized transcript / structured session events -> source-linked event extraction -> review/quality checks -> session memory -> approved graph edges/pattern hypotheses -> Context Manager retrieval -> professional-facing Copilot.

## Required production safeguards
- Pseudonymous client IDs; minimize direct identifiers.
- Store source record IDs, timestamps, source type, author/system, and review status.
- Keep client-reported information separate from clinician-observed information and model summaries.
- Never mix general clinical knowledge with client-specific facts.
- Pattern hypotheses must be tentative, explainable, source-linked, and reviewable; do not label them diagnoses.
- A temporal association is not causation.
- Risk/safety content must use STAAD's approved human escalation workflow and restricted access. Do not autonomously triage emergencies.
- Apply least-privilege access, encryption, audit logs, retention/deletion rules, and applicable privacy/legal review.

## Files
- `depression_graph_ontology.json`: node and relationship types plus design rules.
- `depression_graph_nodes.jsonl` / `.csv`: synthetic demo nodes.
- `depression_graph_edges.jsonl` / `.csv`: synthetic demo edges.
- `depression_session_memory_template.jsonl`: one blank event template.
- `data_dictionary.csv`: field definitions.
- `illustrative_depression_client_memory_schema.sql`: illustrative relational backing schema.
- `STAAD_Depression_Graph_Client_Memory_Report.docx`: human-readable architecture report.

## Important implementation note
This is a design starter, not a production-ready clinical system. Before deployment, STAAD's clinical owner, privacy/security owner, and engineering team should approve the ontology, risk workflow, retention, permissions, and review process.
