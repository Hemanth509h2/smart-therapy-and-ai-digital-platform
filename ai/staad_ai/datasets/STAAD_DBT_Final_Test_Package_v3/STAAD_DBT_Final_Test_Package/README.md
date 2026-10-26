# STAAD DBT Therapy Knowledge Package

## Versioning
- **DBT Initial Baseline v1 — AI-generated, unvalidated**: first assistant-generated snapshot; not supplied by the user and not a pre-existing clinical dataset. Do not edit.
- **DBT Candidate v2 — source-mapped, review pending**: separate candidate with source IDs/locators, caveats, retrieval metadata and record actions.

## Key files
- `knowledge_memory/DBT_Initial_Baseline_v1_AI_generated_unvalidated.jsonl` and `.csv`
- `knowledge_memory/DBT_Initial_Baseline_v1_metadata.json`
- `knowledge_memory/DBT_Candidate_v2.jsonl` and `.csv`
- `knowledge_memory/data_dictionary.csv`
- `source_mapping/source_register.jsonl` and `.csv`
- `source_mapping/DBT_Candidate_v2_Source_Mapping.jsonl` and `.csv`
- `audit/DBT_Change_Log_v1_to_v2.jsonl` and `.csv`
- `test_cases/dbt_retrieval_test_cases.jsonl` and `.csv`
- `graph_client_memory/dbt_graph_ontology.json`
- `graph_client_memory/synthetic_graph_nodes.jsonl` and `synthetic_graph_edges.jsonl`
- `graph_client_memory/dbt_session_memory_template.json`
- `reports/STAAD_DBT_Audit_and_Testing_Readiness_Report.docx`

## Baseline policy
Do not edit v1. Put all improvements in a new candidate version and document each change.

## Review status
AI-generated, unvalidated. ABCT source passages were directly inspected; NICE recommendation locators rely on indexed text because direct page access returned 403. Detailed skill protocols need an authoritative DBT skills source and qualified clinician review. Starter tests have not been run against the live STAAD retrieval pipeline.

## Safety
For professional decision support only. Do not autonomously diagnose, prescribe, change medication, or triage emergencies. Use STAAD-approved local crisis/safeguarding protocols. All graph fixtures are synthetic.


## Candidate v3 — source review update (2026-10-09)

- Candidate v3 and record-by-record source mapping are added alongside v2; the initial AI-generated baseline v1 remains unchanged.
- NICE recommendation text was retrieved for recommendations 1.3.4.1, 1.3.4.3 and 1.3.4.5. Additional NICE recommendation text was inspected for the cited care-plan, risk-management, crisis-management, supervision and preferred-language locators.
- The Linehan Institute publisher descriptions were reviewed to identify the authoritative detailed DBT skills manual and companion worksheets. They do **not** expose enough detail to verify the six specific skill/worksheet protocols. Those six records remain restricted and are not validated clinical instructions.
- Qualified DBT clinician review is pending for all candidate records. This package has not been tested against the live STAAD RAG pipeline.
- Product guardrails (medication boundary, AI human-review boundary) are separated from DBT clinical evidence claims.
