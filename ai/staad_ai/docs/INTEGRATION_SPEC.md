# Integration Technical Specification

This document provides the exact code-level specification of the integration between the legacy STAAD flow and the new Retrieval & Context Management AI pipeline.

---

## 1. Analysis Bridge Specification (`backend/src/lib/rag/analysis.ts`)

The primary integration touchpoint is [`analysis.ts`](../backend/src/lib/rag/analysis.ts). It bridges the Next.js API route to the new pipeline while preserving downstream parsing and safety gates.

### Full Modified `runAnalysis()` Implementation:

```ts
import { chatJSON, COPILOT_MODEL, extractJSON } from '@/lib/report/openrouter-client'
import { processAIPipelineWithDetails } from './pipeline'
import type { ClientProfile } from './retrieval'
import { runSafetyScan } from './safety'
import type { AIInsight } from './types'

export interface AnalysisOptions {
  sessionId: string
  therapistId: string
  clientProfile: ClientProfile
  transcriptWindowMinutes?: number
}

export async function runAnalysis(
  options: AnalysisOptions
): Promise<AIInsight> {
  const {
    sessionId,
    therapistId,
    clientProfile,
    transcriptWindowMinutes = 5,
  } = options

  console.log(`[Analysis] Starting for session ${sessionId}`)
  console.log(`[Analysis] Client: ${clientProfile.name}, Window: ${transcriptWindowMinutes}min`)

  // Execute unified Retrieval and 5-stage Context Management
  const { promptPayload, retrievedContext } = await processAIPipelineWithDetails({
    sessionId,
    therapistId,
    clientProfile,
    transcriptWindowMinutes,
  })

  console.log(`[Analysis] Context retrieved — transcript: ${retrievedContext.sessionContext.transcriptText.slice(0, 80)}...`)
  console.log(`[Analysis] Study material chunks: ${retrievedContext.semanticKnowledge.chunks.length}`)
  console.log(`[Analysis] Previous notes: ${retrievedContext.historicalContext.previousNotes.length}`)

  console.log(`[Analysis] Calling OpenRouter (${COPILOT_MODEL}) + parallel safety pass...`)
  const llmStart = Date.now()
  
  // Parallel execution: Main copilot JSON prompt + independent safeguarding scan
  const [raw, safety] = await Promise.all([
    chatJSON(COPILOT_MODEL, promptPayload.systemPrompt, promptPayload.userPrompt),
    runSafetyScan(retrievedContext.sessionContext.transcriptText),
  ])
  const llmDuration = Date.now() - llmStart
  console.log(`[Analysis] LLM + safety responded in ${llmDuration}ms (safety: ${safety.level})`)

  // Parse and normalize LLM JSON response
  const insight = parseInsight(raw, transcriptWindowMinutes)

  // Authoritative safety override: elevates riskFlag and records rationale
  insight.riskLevel = safety.level
  insight.riskDetail = safety.rationale || insight.riskDetail || ''
  if (safety.level !== 'none') insight.riskFlag = true

  console.log(`[Analysis] Parsed — emotions: [${insight.emotions.join(', ')}], risk: ${insight.riskFlag} (${insight.riskLevel})`)

  return insight
}
```

---

## 2. Core Interfaces and Data Contracts

### A. Pipeline Input (`AIPipelineInput` in `pipeline.ts`)
```ts
export interface AIPipelineInput {
  therapistId: string
  sessionId?: string
  clientId?: string
  clientProfile?: Partial<RetrievedClientContext>
  transcriptWindowMinutes?: number
  semanticQuery?: string
  module?: string
  eventType?: string
  riskLevel?: 'none' | 'watch' | 'urgent' | string
  dateRange?: { from?: Date; to?: Date }
  similarityThreshold?: number
  topK?: number
  notesLimit?: number
  reportsLimit?: number
  metricsLimit?: number
  intent?: 'live_insight' | 'session_report' | 'safeguard_scan' | 'general'
  safety?: SafetyCheckOptions
  filter?: RelevanceFilterOptions
  optimization?: OptimizationOptions
  prompt?: PromptBuilderOptions
  services?: RetrievalServices
}
```

### B. Generated Prompt Payload (`PromptPayload` in `context/types.ts`)
```ts
export interface PromptPayload {
  systemPrompt: string
  userPrompt: string
  structuredSections: {
    client: string
    session: string
    transcript: string
    activity: string
    historical: string
    knowledge: string
    safetyDirectives: string
    responseRequirements: string
  }
  tokenEstimate: number
  metadata: {
    sessionId: string
    clientId: string
    therapistId: string
    activeModuleId: string | null
    generatedAt: number
  }
}
```

### C. Output Insight (`AIInsight` in `types.ts`)
```ts
export interface AIInsight {
  emotions: string[]
  summary: string
  steps: string[]
  module: string
  riskFlag: boolean
  riskLevel?: 'none' | 'watch' | 'urgent'
  riskDetail?: string
  generatedAt: number
  transcriptWindowMinutes: number
}
```

---

## 3. Backward Compatibility & Clean Hand-off Guarantees

1. **Zero Route Drift**: The HTTP API route ([`backend/src/app/api/ai-insight/route.ts`](../backend/src/app/api/ai-insight/route.ts)) continues to invoke `runAnalysis(options)` and receives the exact same `AIInsight` contract. No frontend changes are required.
2. **Legacy Retrieval Functions**: [`toLegacyRAGContext()`](../backend/src/lib/rag/retrieval.ts) and [`retrieveRAGContext()`](../backend/src/lib/rag/retrieval.ts) remain available in `retrieval.ts` for backward compatibility with any other callers until post-production cleanup.
3. **Prompt Format Parity**: `DEFAULT_CLINICAL_SYSTEM_PROMPT` in `context-prompt-builder.ts` demands the exact same 6-key JSON schema as the legacy `SYSTEM_PROMPT`.
