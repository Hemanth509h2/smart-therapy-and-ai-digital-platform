# STAAD ADHD + SLD — Final Testing Package

## What this ZIP contains
This package contains both datasets needed for STAAD testing:
1. **Knowledge Memory** — general ADHD, SLD, and overlap knowledge in JSONL/CSV.
2. **Graph / Client Memory** — ontology, synthetic example nodes/edges, session template, and illustrative schema.
3. **Testing** — retrieval test cases and an integrity report.
4. **Reports** — audit report and source register.

## Start here
- Ingest `knowledge_memory/adhd_sld_knowledge_base.jsonl` as the general knowledge dataset.
- Use `graph_client_memory/graph_ontology.json` for graph types/relationships.
- Do **not** load the graph demo as real client data: all nodes/edges are marked synthetic.
- Run the queries in `testing/retrieval_test_cases.jsonl` against your retrieval pipeline and record returned IDs, source anchors, relevance, and safety behavior.

## Memory boundary
Knowledge Memory stores general clinical/educational information. Current Session Memory stores authorized session transcripts/events/notes. Graph/Client Memory stores authorized client-specific facts with provenance. Never create client facts from the general Knowledge Memory and never infer a diagnosis from a symptom mention.

## What has been corrected in this build
- Rebuilt CSV from the same JSONL record objects to keep the two exports consistent.
- Added source paragraph anchors and the contextual text captured in the audit mapping to Knowledge Memory records.
- Added explicit validation status and review flags; flags are review tasks, not a claim that the record is wrong.
- Made the graph package unambiguous: every graph node and edge is explicitly marked synthetic example and not real client data.
- Added session provenance fields and a starter retrieval test set.

## Important status
**Ready for engineering/retrieval testing; not clinically approved for production.** The source anchors identify where the original record was mapped in the supplied documents; they do not prove that every statement in the record is supported by that passage. Quantitative claims, clinical recommendations, medication content, diagnostic wording, and safety rules require claim-by-claim review by the designated clinical/source owner. This package does not claim a measured RAG accuracy score.


## Original baseline preservation (v2)
- `knowledge_memory/adhd_sld_knowledge_base_original_baseline.jsonl` is an exact copy of the knowledge base JSONL that was in the original final testing ZIP.
- `knowledge_memory/adhd_sld_knowledge_base_original_baseline.csv` is an exact copy of the knowledge base CSV that was in the original final testing ZIP.
- The existing knowledge base files and original source documents are preserved. No clinical content was changed by this baseline-preservation update.
- This adds an explicit baseline copy for version comparison; it does not imply clinical validation.
