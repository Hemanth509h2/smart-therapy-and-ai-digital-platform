# Next Steps & Deployment Guide

This document outlines the actionable next steps required to perform live end-to-end testing, local server execution, and post-deployment cleanup.

---

## 1. Configure Local Environment (`backend/.env`)

Before running live tests or booting the backend server, copy `backend/.env.example` to `backend/.env` and supply the required service keys:

```powershell
# From the backend directory:
cp .env.example .env
```

### Essential Variables for AI Pipeline Live Execution:
* **Firebase Admin**:
  * `FIREBASE_PROJECT_ID`: Target Firebase project ID.
  * `FIREBASE_CLIENT_EMAIL`: Service account client email.
  * `FIREBASE_PRIVATE_KEY`: Service account private key (`"-----BEGIN PRIVATE KEY-----\n..."`).
* **PostgreSQL (Neon / Supabase with pgvector)**:
  * `DATABASE_URL`: Connection string to the Postgres database for Prisma and vector chunk embeddings.
* **LLM & Embeddings**:
  * `OPENROUTER_API_KEY`: API key for OpenRouter inference (`chatJSON` + `runSafetyScan`).
  * `NVIDIA_API_KEY`: API key for NVIDIA embedding client (`generateEmbedding`).
* **Dev Mode Flag (Optional for quick solo testing)**:
  * `NEXT_PUBLIC_STT_TEST_MODE=true`: Bypasses client+therapist dual-consent checks during development.

---

## 2. Execute Live Integration Tests

Once `.env` is populated:

### A. Run Analysis Pipeline Test
```powershell
npm run test:analysis
```
* **Script**: [`backend/scripts/test-analysis.ts`](../backend/scripts/test-analysis.ts)
* **What it tests**: Seeds transcript turns, embeds test study material into `document_chunks`, runs `runAnalysis()`, verifies LLM completion + safety scan, checks output validation assertions, and automatically cleans up all seeded rows.

### B. Run End-to-End RAG Test
```powershell
npm run test:e2e
```
* **Script**: [`backend/scripts/test-e2e-rag.ts`](../backend/scripts/test-e2e-rag.ts)
* **What it tests**: Tests consent gating, full multi-source retrieval, latency thresholds (< 15s), Firestore write & readback, self-harm risk flag detection, and clean database purge.

---

## 3. Run Backend Locally

To test the live HTTP API endpoint:
```powershell
npm run dev
```
* Starts the Next.js backend on `http://localhost:4000`.
* Test the live endpoint via HTTP POST:
  ```bash
  POST http://localhost:4000/api/ai-insight
  Content-Type: application/json

  {
    "sessionId": "valid-session-id",
    "therapistId": "valid-therapist-id",
    "transcriptWindowMinutes": 5
  }
  ```

---

## 4. Post-Rollout Legacy Cleanup (Optional)

After live verification in staging/production, the following legacy artifacts can be safely deprecated or removed:
1. **[`backend/src/lib/rag/prompt.ts`](../backend/src/lib/rag/prompt.ts)**:
   * `buildAnalysisPrompt()` and `SYSTEM_PROMPT` are fully superseded by `backend/src/lib/rag/context/context-prompt-builder.ts`.
2. **[`backend/src/lib/rag/retrieval.ts`](../backend/src/lib/rag/retrieval.ts)**:
   * `toLegacyRAGContext()` and `retrieveRAGContext()` can be phased out once all callers have migrated to `processAIPipelineWithDetails()`.
