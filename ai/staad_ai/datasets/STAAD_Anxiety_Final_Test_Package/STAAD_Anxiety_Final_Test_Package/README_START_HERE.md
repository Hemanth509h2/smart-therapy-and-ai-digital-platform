# STAAD Anxiety Final Testing Package

**Status:** Engineering testing build; clinical validation pending.  
**Build date:** 2026-10-09  
**Knowledge records:** 60  
**Graph:** 20 nodes, 41 edges  
**Starter retrieval tests:** 18

## Start here
1. Load `knowledge_memory/anxiety_knowledge_base_testing_candidate.jsonl` into a test/staging retrieval index.
2. Use `knowledge_memory/anxiety_knowledge_base_testing_candidate.csv` for human review.
3. Use `graph_client_memory/anxiety_graph_ontology.json`, `anxiety_graph_nodes.jsonl`, and `anxiety_graph_edges.jsonl` to test graph integration. **All client/session example facts and edges are synthetic. Do not load them as real client data.**
4. Run `testing/retrieval_test_cases.jsonl` against the actual STAAD retrieval pipeline. The expected record IDs are targets for evaluation, not evidence that tests have passed.
5. Record retrieved IDs, ranking, source attribution, omissions, unsafe outputs, and reviewer notes.
6. Review `audit/record_level_audit.csv` and `audit/source_register_review.csv`.

## What was improved in this build
- Preserved the original 60 records in `knowledge_memory/anxiety_knowledge_base_original_baseline.jsonl`.
- Added retrieval keywords and at least one retrieval question to every candidate record. These fields were generated for engineering testability and still need human review.
- Added explicit source-validation, clinical-validation, and source-locator status fields to every candidate record.
- Added record-level quality notes and prioritized review flags.
- Added a distinct `STAAD-ARCH-DESIGN` source so STAAD-specific architecture recommendations are not misrepresented as clinical guideline findings.
- Added current source-check notes for selected WHO, NICE, and PubMed records.
- Clarified graph-node scope and marked all graph edges as synthetic examples and not production eligible.
- Changed the illustrative pattern label/status so it is not presented as an established longitudinal pattern from a single synthetic session.
- Added 18 starter retrieval/safety test cases.

## Important limitations
- No record has an exact source passage/page/section mapped in this build.
- No qualified clinician has approved these records as part of this automated audit.
- Keywords and retrieval questions are generated metadata, not clinical claims, but still require review.
- The test cases have not been run against STAAD's actual retrieval implementation; no precision/recall score is claimed.
- The package primarily covers anxiety foundations, GAD, social anxiety, and panic disorder. Decide whether additional presentations (e.g., separation anxiety, specific phobia, agoraphobia, selective mutism) are in scope before release.
- `quality_note` and status fields intentionally make pending work visible; they do not certify the content.

## Clinical and safety boundary
This is not a diagnostic system. The Copilot must not diagnose, prescribe or change medication, dismiss acute physical symptoms as anxiety, autonomously triage emergencies, or design high-risk exposure tasks. Risk indicators must follow STAAD's approved human escalation workflow. Clinical and privacy/security owners must approve production use.

## Directory map
- `knowledge_memory/`: candidate dataset, baseline dataset, source register
- `graph_client_memory/`: ontology, graph nodes/edges, session template, SQL illustration, data dictionary
- `testing/`: retrieval test cases and structural integrity report
- `audit/`: record-by-record review flags, source review and web source-check notes
- `source_documents/`: original anxiety package ZIPs
- `reports/`: human-readable audit report
