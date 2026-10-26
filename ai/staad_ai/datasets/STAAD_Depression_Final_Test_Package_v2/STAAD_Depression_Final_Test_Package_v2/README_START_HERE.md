# STAAD Depression Final Testing Package

**Status:** Initial engineering testing candidate only — not clinically validated and not production-ready.  
**Audit date:** 2026-10-09

## What's included
- `knowledge_memory/depression_knowledge_base_original_baseline.jsonl` and CSV: preserved baseline copies.
- `knowledge_memory/depression_knowledge_base_testing_candidate.jsonl` and CSV: candidate with explicit pending-validation metadata and structural review flags. Clinical content was not silently rewritten.
- `knowledge_memory/sources_and_references.json`: original source register.
- `graph_client_memory/`: ontology, synthetic graph examples, session template, data dictionary and illustrative SQL schema.
- `testing/retrieval_test_cases.jsonl` and CSV: 24 starter retrieval/safety tests; not executed against the STAAD application.
- `audit/record_level_audit.csv`: record-level structural and traceability checks.
- `audit/source_register_review.csv` and `web_source_checks.json`: source-register inventory and limited public-source spot-check notes.
- `reports/STAAD_Depression_Audit_and_Testing_Readiness_Report.docx`: human-readable report.
- `source_packages/`: original ZIPs for reproducibility.

## Important interpretation
This is a structural and engineering-readiness audit, not a clinical diagnosis or a clinical validation study. Presence of keywords, source IDs, schema-valid JSON, or a resolved URL does not prove that each clinical statement is accurate or supported by the cited source.

Every record is marked:
- `source_validation_status = pending_exact_passage_mapping`
- `clinical_validation_status = pending_qualified_clinical_review`

The candidate file adds metadata; it does not claim that a clinician has approved the content. Preserve the baseline and compare versions before ingestion.

## Initial audit snapshot
- Knowledge records: 64
- Duplicate record IDs: 0
- Records missing keywords: 0
- Records missing retrieval questions: 0
- Records with source IDs not found in the source register: 0
- Graph: 11 nodes, 8 edges
- Missing graph edge endpoint references: 0
- Synthetic graph nodes/edges: 11/8
- Starter tests: 24 (0 run against STAAD)

## Required before production
1. Map each record to exact source section/recommendation and passage; add source version/date and review date.
2. Have a qualified clinical reviewer validate every claim, population, strength label, exclusions, and safety boundary.
3. Resolve the source register's currency/jurisdiction and confirm current guideline status.
4. Execute the test suite against the actual retriever, Context Manager, Copilot and UI; record hit@k/recall, precision, unsupported-answer rate, latency and safety test results.
5. Verify client/session access control, tenant isolation, consent, data minimization, retention/deletion, audit logs and de-identification.
6. Require human approval for risk escalation pathways; do not use the model as a diagnostic, prescribing, medication-adjustment or autonomous triage system.
7. Validate synthetic-data isolation so demo nodes cannot be merged into real client memory.

## STAAD-specific safety boundaries
- Depression-related text is not a diagnosis.
- A screening instrument or score is not a standalone diagnosis.
- Do not generate medication starts, dose changes, tapering or stopping advice.
- Do not independently clear suicide/self-harm risk. Route concerning content through the organization's approved, human-supervised safety workflow.
- Do not infer causation from temporal co-occurrence or stable patterns from a single session.
- Do not retrieve another client's memory.
- Attribute observations and client-reported experiences, and keep source provenance.

## Limited web/source checks
This audit included limited checks that the WHO depression fact sheet and NICE NG222 and NG134 recommendation pages are publicly findable. It did **not** map each of the 64 records to exact passages, and did not comprehensively recheck NIMH or NICE CG192. See `audit/web_source_checks.json`.


## Source mapping update (v2)
- `audit/record_by_record_source_mapping.csv` and `.jsonl` map all 64 records to a primary source/section or explicitly label STAAD architecture claims as not supported by clinical sources.
- `reports/STAAD_Depression_Record_by_Record_Source_Mapping_Report.docx` explains the results and limitations.
- `audit/source_mapping_summary.json` provides counts.
- Candidate JSONL/CSV now include preliminary mapping fields. The original baseline is preserved separately.

**Do not interpret source mapping as clinical approval.** The mapping is preliminary. The NICE pages returned 403 on direct open, although recommendation text was available via indexed search excerpts. WHO page date metadata differed between search result and opened page. The actual STAAD repository/specification was not available for verifying architecture claims. All records still require qualified clinical review.
