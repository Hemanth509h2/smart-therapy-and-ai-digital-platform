# STAAD ADHD + SLD Knowledge Memory — Final Testing Build

## Purpose
Combined general clinical/educational Knowledge Memory dataset for STAAD, based on the two supplied ADHD/SLD research documents. This is separate from client-specific Graph/Client Memory.

## Files
- `adhd_sld_knowledge_base.jsonl`: primary ingestion format (155 records).
- `adhd_sld_knowledge_base.csv`: review/export format with matching records.
- `sources_and_references.json`: source register and validation boundaries.

## Added audit metadata
- `source_paragraph_index` and `source_context_at_index`: source-document anchor copied from the existing audit mapping. This is a locator, not proof that every claim in a record is supported by the passage.
- `source_mapping_status`: states the limitations of the source mapping.
- `validation_status`: marks this as a testing build, not clinical approval.
- `testing_review_flags`: record-level follow-up flags for quantitative claims, chunk size, markup, quality notes, and source-anchor checks.
- `claim_level_validation`: explicit warning that claim-by-claim verification is incomplete.

## Use in STAAD
Use this dataset for general questions about ADHD, SLD, their overlap, assessment considerations, support strategies, accommodations, and safety boundaries. Context Manager should retrieve only relevant records and pass source metadata with the content to the Copilot.

## Important limits
This build preserves the baseline clinical content rather than silently rewriting unverified claims. It adds traceability and review flags for testing. Quantitative claims, diagnostic wording, intervention recommendations, medication statements, and safety statements require clinician/source-owner review before production. Do not treat `evidence_strength` as independently verified by this build.

## Suggested ingestion
1. Load JSONL records and preserve `record_id` as the stable key.
2. Index `content` plus `topic`, `condition`, `keywords`, and `retrieval_questions`.
3. Keep source locator, safety level, and validation fields in metadata.
4. Filter by condition/topic and safety/access policy before context assembly.
5. Return record IDs/source anchors with retrieved content so test reviewers can trace answers.
