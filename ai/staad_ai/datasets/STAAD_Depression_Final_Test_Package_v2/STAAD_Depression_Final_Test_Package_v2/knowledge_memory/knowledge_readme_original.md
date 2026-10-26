# STAAD Depression Knowledge Memory — starter dataset

## Purpose
This package is the **general clinical Knowledge Memory** component of STAAD's Hybrid Memory Layer. It is intended to complement (not replace) Current Session Memory and client-specific Graph Memory.

## Files
- `depression_knowledge_base.jsonl`: one structured knowledge record per line; suitable for backend ingestion and downstream retrieval preparation.
- `depression_knowledge_base.csv`: review-friendly version of the same records.
- `sources_and_references.json`: source register with URLs and intended coverage.
- `STAAD_Depression_Knowledge_Memory_Report.docx`: human-readable overview and implementation notes.

## Dataset fields
`record_id`, `condition`, `topic`, `subtopic_path`, `content_type`, `age_group`, `evidence_type`, `evidence_strength`, `safety_level`, `content`, `keywords`, `retrieval_questions`, `source_id`, `source_document`, `source_priority`, `intended_use`, `quality_note`.

## Intended architecture
Three primary Context Manager sources:
1. **Knowledge Memory** — this dataset; general clinical information.
2. **Current Session Memory** — current transcript, recent turns, activity/module and session events.
3. **Client/Graph Memory** — authorized client-specific records, history, goals, observations, reported experiences, intervention responses and supported longitudinal patterns.

Retrievers and structured filters are mechanisms used to retrieve relevant material from those sources; they are not additional independent memory datasets.

## Evidence and validation status
This is an **initial source-grounded structured dataset**, not a clinically approved production knowledge base. The records were drafted against the listed authoritative sources, but this package does not claim a measured >90% validation score. Before production, each claim must be mapped to an exact source passage/section, reviewed by a qualified clinical owner, versioned, and tested for retrieval quality and safety.

## Critical safety rules
- This is educational/clinical-support content, not a diagnostic engine.
- Screening scores do not independently establish a diagnosis.
- Do not diagnose, prescribe, recommend medication changes, or independently assign suicide-risk levels.
- Mentions of self-harm, suicidal ideation/intent/plan, attempts, immediate danger, psychosis, abuse, or danger to a child must follow the approved STAAD human-led safety/safeguarding workflow.
- Silence or absence of mention is not evidence that risk is absent.
- Preserve provenance: observed, reported, inferred, or summarized.
- Never turn general knowledge into a client-specific fact without independent client/session evidence.
- Synthetic examples, if later added for testing, must be labelled synthetic and must never be mistaken for real client records.

## Important limitation
The dataset is not a substitute for current local clinical guidelines, clinician judgment, legal/privacy review, or crisis protocols. Guideline recommendations may differ by jurisdiction, age, pregnancy/postpartum context, severity, and service setting.
