# STAAD Intellectual Disability Final Testing Package

## Start here
1. Read `reports/STAAD_Intellectual_Disability_Audit_and_Testing_Readiness_Report.docx`.
2. Use `knowledge_memory/intellectual_disability_knowledge_base_original_baseline.jsonl` as the preserved baseline.
3. Use `knowledge_memory/intellectual_disability_knowledge_base_testing_candidate.jsonl` as the candidate for retrieval testing.
4. Run `testing/retrieval_test_cases.jsonl` against the actual STAAD retrieval/generation pipeline and record results.
5. Review `audit/record_by_record_source_mapping.csv` and `audit/source_register_review.csv`.

## Contents
- 45 baseline knowledge records and matching candidate records.
- 20 starter retrieval tests.
- Source register with seven professional/public-health sources.
- Record-level source mapping and structural audit.
- Graph/client-memory ontology, synthetic node/edge examples, session template, data dictionary, and illustrative SQL.
- Audit/readiness report.

## Baseline policy
The baseline is an explicit, separate copy of the initial 45-record dataset. Do not overwrite it when editing the candidate. Candidate metadata does not mean the clinical text has been validated.

## Current readiness
PRELIMINARY TECHNICAL TESTING ONLY. Starter tests have not been run against STAAD. Source mapping is provisional, exact-passage review is pending, and qualified clinical review has not been completed.

## Scope and safety
This package supports evidence retrieval and organization; it is not a diagnostic system. Do not use it to diagnose, determine severity or legal capacity, recommend medication changes, or autonomously triage risk. Human clinical governance and local jurisdiction review are required before real-client use. Synthetic graph examples are not real client data.
