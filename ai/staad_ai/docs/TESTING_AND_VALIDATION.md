# Testing and Validation — STAAD AI Pipeline

This document details the test suites, runner mechanics, coverage breakdown, and validation procedures for the STAAD AI Pipeline.

---

## 1. Test Suite Summary

The automated unit and integration test suite covers 100% of the newly integrated Retrieval, Context Management, and Pipeline components:

| Suite | File Location | Tests | Status |
| :--- | :--- | :---: | :---: |
| **Retrieval Layer** | [`backend/src/lib/rag/__tests__/retrieval-layer.test.ts`](../backend/src/lib/rag/__tests__/retrieval-layer.test.ts) | 14 | **PASSED (14/14)** |
| **Context Management** | [`backend/src/lib/rag/context/__tests__/context-management.test.ts`](../backend/src/lib/rag/context/__tests__/context-management.test.ts) | 12 | **PASSED (12/12)** |
| **Pipeline Orchestrator** | [`backend/src/lib/rag/__tests__/pipeline.test.ts`](../backend/src/lib/rag/__tests__/pipeline.test.ts) | 5 | **PASSED (5/5)** |
| **Total** | | **31** | **PASSED (31/31)** |

---

## 2. Test Execution Commands

### Official Fast Test Command (Recommended)
Run the 3 focused suites using `tsx` (handles extensionless ESM module resolution and TypeScript types natively):
```powershell
npx tsx --test src/lib/rag/context/__tests__/context-management.test.ts src/lib/rag/__tests__/retrieval-layer.test.ts src/lib/rag/__tests__/pipeline.test.ts
```

### TypeScript Static Typecheck
Verify full type safety across the backend:
```powershell
npx tsc --noEmit
```
*(Currently completes with 0 errors).*

---

## 3. Test Coverage Breakdown

### A. Retrieval Layer Tests (14 Tests)
Located in [`src/lib/rag/__tests__/retrieval-layer.test.ts`](../backend/src/lib/rag/__tests__/retrieval-layer.test.ts):
1. **Client Retrieval**:
   * Age calculation from `dateOfBirth` using calendar arithmetic.
   * Server-side database lookup with derived session count and goals.
   * Resolving client context from `sessionId` when `clientId` is not passed upfront.
2. **Session Retrieval**:
   * Live session status, interactive module state, and therapist lock flag.
   * Time-windowed recent transcript turns formatted with uppercase speaker tags.
   * Module event aggregation and in-call therapist notes.
3. **Historical Retrieval**:
   * Client-scoped prior session notes, clinical reports, and progress metrics.
4. **Structured Filtering**:
   * Filtering module events by `module` and `eventType`.
   * Date range filtering on historical reports and notes.
5. **Semantic / RAG Retrieval**:
   * Fast-path exit on empty queries without unnecessary embedding generation.
   * Cosine similarity threshold filtering on pgvector chunks.
6. **Unified Context Structure**:
   * Production of complete strongly typed `RetrievedContext`.
   * Conversion to legacy `RAGContext` for zero breaking changes.
7. **Scoping & Security**:
   * Blocking cross-therapist unauthorized data retrieval.
   * Graceful fallback when `therapistId` or `clientId` is omitted.
8. **Resilience & Missing Data**:
   * Fallback notices on empty transcript histories.
   * Non-crashing graceful fallback on database timeout/error.

### B. Context Management Tests (12 Tests)
Located in [`src/lib/rag/context/__tests__/context-management.test.ts`](../backend/src/lib/rag/context/__tests__/context-management.test.ts):
1. **Context Builder**: Normalizes raw `RetrievedContext` without triggering any secondary queries.
2. **Relevance Filtering**: Prunes empty sections and noisy single-character filler utterances.
3. **Semantic Pruning**: Drops vector chunks with similarity score below threshold (< 0.25).
4. **Deduplication**: Eliminates duplicate consecutive turns and repeated in-call notes.
5. **Active Module Prioritization**: Boosts module events matching the active session module.
6. **Historical Retention**: Preserves prior session notes and reports in chronological sequence.
7. **Identity Scoping**: Throws `ContextSecurityError` on client ID or session ID mismatch.
8. **Therapist Ownership Scoping**: Rejects cross-therapist boundary access attempts.
9. **Private Notes Policy**: Strips private observations when `allowPrivateNotes = false`.
10. **Token Optimization**: Deterministically compresses historical notes and truncates earlier transcript turns to respect configured budget (e.g. 1500 tokens).
11. **Prompt Builder**: Assembles strongly typed `PromptPayload` without invoking an LLM.
12. **Resilience**: Safely handles empty input context and missing fields.

### C. Pipeline Orchestration Tests (5 Tests)
Located in [`src/lib/rag/__tests__/pipeline.test.ts`](../backend/src/lib/rag/__tests__/pipeline.test.ts):
1. **End-to-End Orchestration**: Ingests `AIPipelineInput`, runs retrieval, processes context, and returns valid `PromptPayload`.
2. **Isolation Guarantee**: Verifies `processAIPipeline()` produces LLM-ready prompts without calling any external LLM endpoint.
3. **Therapist Boundary Enforcement**: Rejects cross-therapist access with `ContextSecurityError`.
4. **Client Mismatch Enforcement**: Rejects mismatched client credentials with `ContextSecurityError`.
5. **Extended Details Handoff**: Verifies `processAIPipelineWithDetails()` returns both `PromptPayload` and `RetrievedContext` with audit metadata.

---

## 4. Test Runner Mechanics Note

* The test files use Node's native test assertion library (`import { describe, it } from 'node:test'`).
* Running them directly via `npx vitest run ...` causes Vitest to report `No test suite found in file` because Vitest looks for tests registered on the Vitest API, even though Node's assertions execute and pass.
* Running with `npx tsx --test ...` executes the native `node:test` runner with fast TypeScript transpilation and proper extensionless ESM module resolution.
