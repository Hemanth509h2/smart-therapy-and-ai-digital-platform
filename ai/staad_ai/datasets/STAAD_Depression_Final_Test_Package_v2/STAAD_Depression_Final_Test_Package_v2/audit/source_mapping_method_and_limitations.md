# Depression record-by-record source mapping: method and limits

## What was done
- Reviewed all 64 record IDs and their claim text.
- Assigned a primary source and precise page section/recommendation locator where the registered source supports the main clinical claim.
- Wrote a short paraphrase of the supporting material, not copied long source passages.
- Classified each record as `direct_support`, `partial_support`, or `not_supported_by_clinical_sources`.
- Separated STAAD architecture, privacy, graph-memory, provenance and crisis-workflow design assertions from clinical claims.
- Updated the testing-candidate records with the primary mapping, locator, preliminary mapping status and a clear pending clinical-review status.

## Important boundaries
- `direct_support` means a plausible source section/recommendation was located for the main claim. It does **not** mean every clause in that record has been verified or clinically approved.
- `partial_support` means the source supports the general topic but one or more details, populations, or implementation claims need further mapping.
- `not_supported_by_clinical_sources` means the claim is an architecture/product-policy statement and should be sourced to an approved STAAD design document/code review, not a clinical guideline.
- The NICE pages returned 403 on direct open in this pass. Recommendation text was available through indexed search results, so locators are included, but the current page should be checked directly by a reviewer before clinical release.
- WHO page metadata differed between the search index and the opened page. Do not rely on prevalence figures or page date until checked against the live source.
- The mapping contains concise evidence paraphrases, not full quotations. It is not a substitute for a clinician's claim-by-claim review.
- No STAAD source repository or approved architecture specification was available in this turn. Therefore, no claim that a particular feature is implemented in STAAD has been verified.

## Status definitions
- `direct_support`: main clinical proposition has a specific source section or recommendation that appears to support it.
- `partial_support`: broad proposition is supported but scope, wording, detail, or one or more subclaims require review.
- `not_supported_by_clinical_sources`: source type mismatch; needs STAAD design/source evidence or must be labelled a proposal.
