import { chatJSON, COPILOT_MODEL, extractJSON } from '@/lib/report/openrouter-client'
import { SYSTEM_PROMPT, buildAnalysisPrompt } from './prompt'
import { retrieveRAGContext, type ClientProfile } from './retrieval'
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

  const context = await retrieveRAGContext(
    sessionId,
    therapistId,
    clientProfile,
    transcriptWindowMinutes
  )

  console.log(`[Analysis] Context retrieved — transcript: ${context.transcript.slice(0, 80)}...`)
  console.log(`[Analysis] Study material chunks: ${context.studyMaterial.length}`)
  console.log(`[Analysis] Previous notes: ${context.previousNotes.length}`)

  const userPrompt = buildAnalysisPrompt(context)

  console.log(`[Analysis] Calling OpenRouter (${COPILOT_MODEL}) + parallel safety pass...`)
  const llmStart = Date.now()
  // Two calls in parallel: the main suggestion AND a dedicated safety scan. The
  // safety verdict must not depend on whether the suggestion model noticed the
  // cue, so it runs independently and is merged in. Total latency ≈ the slower
  // of the two, not the sum.
  const [raw, safety] = await Promise.all([
    chatJSON(COPILOT_MODEL, SYSTEM_PROMPT, userPrompt),
    runSafetyScan(context.transcript),
  ])
  const llmDuration = Date.now() - llmStart
  console.log(`[Analysis] LLM + safety responded in ${llmDuration}ms (safety: ${safety.level})`)

  const insight = parseInsight(raw, transcriptWindowMinutes)

  // The dedicated safety pass is authoritative for risk: a 'watch' or 'urgent'
  // verdict raises the flag even if the suggestion model set riskFlag=false.
  insight.riskLevel = safety.level
  insight.riskDetail = safety.rationale || insight.riskDetail || ''
  if (safety.level !== 'none') insight.riskFlag = true

  console.log(`[Analysis] Parsed — emotions: [${insight.emotions.join(', ')}], risk: ${insight.riskFlag} (${insight.riskLevel})`)

  return insight
}

function parseInsight(
  raw: string,
  transcriptWindowMinutes: number
): AIInsight {
  const parsed = extractJSON(raw)

  if (!parsed) {
    console.warn('[Analysis] LLM returned invalid JSON, using fallback')
    return {
      emotions: [],
      summary: 'Analysis failed: could not parse LLM response',
      steps: ['Review the transcript manually'],
      module: '',
      riskFlag: false,
      generatedAt: Date.now(),
      transcriptWindowMinutes,
    }
  }

  const emotions = normalizeArray(parsed.emotions)
  const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
  const steps = normalizeArray(parsed.steps)
  const module = typeof parsed.module === 'string' ? parsed.module : ''
  const riskFlag = typeof parsed.riskFlag === 'boolean' ? parsed.riskFlag : false
  const riskDetail = typeof parsed.riskDetail === 'string' ? parsed.riskDetail : ''

  return {
    emotions,
    summary,
    steps,
    module,
    riskFlag,
    riskDetail,
    generatedAt: Date.now(),
    transcriptWindowMinutes,
  }
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .slice(0, 10)
}
