# STAAD AI Pipeline Architecture

This document specifies the complete runtime architecture of the modernized STAAD AI pipeline, from incoming HTTP request through multi-source retrieval, context management, dual-pass LLM execution, and downstream persistence.

---

## 1. End-to-End Runtime Flow Diagram

```
[Client / Frontend Application]
          │
          ▼  HTTP POST /api/ai-insight
┌────────────────────────────────────────────────────────────────────────┐
│  API Route: backend/src/app/api/ai-insight/route.ts                    │
│  1. Request body parsing & ID validation                               │
│  2. Server-side client validation via retrieveClientContext()          │
│  3. AI consent verification (checkAIConsent / test mode bypass)        │
│  4. Session transcript presence check (getSessionTranscript)           │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Analysis Bridge: backend/src/lib/rag/analysis.ts                      │
│  Calls processAIPipelineWithDetails({ sessionId, therapistId, ... })   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  AI Pipeline Orchestrator: backend/src/lib/rag/pipeline.ts             │
│  Builds StructuredFilters from inputs and coordinates stages           │
└──────────────────┬──────────────────────────────────┬──────────────────┘
                   │                                  │
                   ▼ (Stage 1: Retrieval)             │
┌──────────────────────────────────────────────────┐  │
│  Unified Retrieval Layer                         │  │
│  backend/src/lib/rag/retrieval.ts                │  │
│                                                  │  │
│  ├─ ClientRetriever (demographics, goals)        │  │
│  ├─ SessionRetriever (state, turns, events)      │  │
│  ├─ HistoricalRetriever (notes, reports, metrics)│  │
│  └─ SemanticRetriever (pgvector cosine chunks)   │  │
│                                                  │  │
│  ──> Produces: RetrievedContext                  │  │
└──────────────────┬───────────────────────────────┘  │
                   │                                  │
                   ▼ (Stage 2: Context Management)    │
┌──────────────────────────────────────────────────┐  │
│  Context Management Engine                       │  │
│  backend/src/lib/rag/context/index.ts            │  │
│                                                  │  │
│  1. Context Builder (normalize & structure)      │  │
│  2. Relevance Filter (dedup, active-mod boost)   │  │
│  3. Safety & Scoping (PII redaction, auth gate)  │  │
│  4. Context Optimizer (priority token budget)    │  │
│  5. Prompt Builder (construct PromptPayload)     │  │
│                                                  │  │
│  ──> Produces: PromptPayload                     │  │
└──────────────────┬───────────────────────────────┘  │
                   │                                  │
                   └──────────────────┬───────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Dual-Path Model Execution (Promise.all in analysis.ts)                │
│                                                                        │
│  Path A: Copilot Generation              Path B: Dedicated Safety Pass │
│  chatJSON(COPILOT_MODEL,                 runSafetyScan(transcript)     │
│    promptPayload.systemPrompt,             │                           │
│    promptPayload.userPrompt)               │                           │
│    │                                       │                           │
│    ▼                                       ▼                           │
│  Raw Clinical JSON response              SafetyVerdict (level, cue)    │
└──────────────────┬─────────────────────────┬───────────────────────────┘
                   │                         │
                   └────────────┬────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Parser & Safety Merging (analysis.ts)                                 │
│  1. extractJSON() & parseInsight() parse and normalize output fields   │
│  2. SafetyVerdict authoritatively overrides riskLevel, riskDetail,     │
│     and elevates riskFlag = true if level !== 'none'                   │
│  ──> Returns: AIInsight                                                │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Persistence & Audit Flow (route.ts)                                   │
│  1. Firestore write: sessions/{sessionId}.aiInsight (merge: true)      │
│  2. Audit event: appendCopilotEvent() appends to session transcript     │
│  3. Billing/Usage event: prisma.usageEvent.create('AI_ANALYSIS')        │
│  4. Response: NextResponse.json({ insight })                           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Layers

### Layer 1: Unified Retrieval Layer (`src/lib/rag/retrieval.ts`)
The Retrieval Layer fetches multi-dimensional session context deterministically:
* **ClientRetriever (`client-retriever.ts`)**: Resolves client demographics (name, age from DOB, clinical conditions, session numbers, goals) from Prisma Postgres with graceful fallback support.
* **SessionRetriever (`session-retriever.ts`)**: Retrieves the live session state, recent transcript turns within the specified time window, interactive module activity logs, and in-call therapist notes.
* **HistoricalRetriever (`historical-retriever.ts`)**: Scopes prior session notes, historical clinical reports, and longitudinal progress metrics strictly to the authenticated client and therapist.
* **SemanticRetriever (`semantic-retriever.ts`)**: Converts dynamic queries into vector embeddings (via NVIDIA API) and performs cosine-similarity retrieval against therapist-uploaded clinical study material stored in Postgres (`document_chunks` with pgvector).

### Layer 2: Context Management Engine (`src/lib/rag/context/`)
The Context Management Layer transforms raw multi-source retrieval data into an optimized, secure LLM prompt via five sequential pipeline stages:
1. **Context Builder (`context-builder.ts`)**: Ingests `RetrievedContext` and normalizes all fields into a consistent `StructuredContext` hierarchy without re-fetching data.
2. **Relevance Filter (`relevance-filter.ts`)**: Deterministically prunes empty sections, filters out noisy or duplicate utterances, prioritizes active module activity and recent dialogue, and filters out semantic chunks below the relevance threshold (0.25).
3. **Safety & Access Control (`context-safety.ts`)**: Verifies client ID, session ID, and therapist ownership scoping. Enforces private notes filtering policies, redacts client PII (phone number, parent email, surname abbreviation), and injects safeguarding directives.
4. **Context Optimizer (`context-optimizer.ts`)**: Calculates character-based token estimates and compresses/prunes sections according to clinical priority when context exceeds the token budget (default 1500 tokens).
5. **Prompt Builder (`context-prompt-builder.ts`)**: Formats clean, delimited user prompt sections and attaches the standardized `DEFAULT_CLINICAL_SYSTEM_PROMPT`.

### Layer 3: LLM Interface & Dual-Pass Execution (`src/lib/report/openrouter-client.ts`, `src/lib/rag/safety.ts`)
* **PromptPayload Consumption**: `promptPayload.systemPrompt` and `promptPayload.userPrompt` are passed directly into `chatJSON()`.
* **Model Configuration**: Default model is `COPILOT_MODEL` (`nvidia/nemotron-3-super-120b-a12b:free` via OpenRouter OpenAI client) at `temperature: 0.2`, `max_tokens: 1024`.
* **Parallel Safety Scan**: A dedicated safety check (`runSafetyScan`) runs in parallel with the main analysis call. Because general chat models may inconsistently detect subtle crisis cues, the parallel safety pass runs an isolated classification scan over client utterances and authoritatively overrides `riskFlag`, `riskLevel`, and `riskDetail`.

### Layer 4: Parsing & Persistence Layer (`src/lib/rag/analysis.ts`, `route.ts`)
* **`parseInsight()`**: Extracts outer JSON via `extractJSON()`, validates array types (`emotions`, `steps`), strings (`summary`, `module`), and booleans (`riskFlag`), and provides a deterministic fallback in case of LLM parse failure.
* **Firestore Persistence**: Updates document `sessions/{sessionId}` with `aiInsight` and timestamp.
* **Audit Trail**: Appends the copilot event to `appendCopilotEvent()` for longitudinal session report inclusion.
* **Usage Event**: Records `AI_ANALYSIS` in Prisma Postgres for administrative usage analytics.
