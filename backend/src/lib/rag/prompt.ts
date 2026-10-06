import type { RAGContext } from './retrieval'

export const SYSTEM_PROMPT = `You are a clinical therapy session analyst. Your role is to analyze live therapy session transcripts alongside therapist-provided clinical material and previous session notes to generate structured clinical insights.

You MUST respond with valid JSON only — no markdown, no code fences, no explanation outside JSON.

The JSON must have these exact fields:
{
  "emotions": ["string"],           // 2-4 key emotions the client exhibited
  "summary": "string",              // 2-3 sentence clinical summary of this window
  "steps": ["string"],              // 2-4 concrete next steps for the therapist
  "module": "string",               // one of the available therapy module names
  "riskFlag": false,                // true if client expresses self-harm, suicide, or danger
  "riskDetail": ""                  // if riskFlag is true, explain the concern (max 1 sentence)
}

Guidelines:
- Base your analysis ONLY on the provided transcript, study material, and previous notes
- If the transcript is empty or unavailable, set summary to "No transcript available for analysis"
- Choose the most appropriate therapy module from the available list given the client's needs
- The riskFlag MUST be true if the client mentions self-harm, suicide, violence, or danger — even indirectly
- Be conservative with riskFlag: false unless there is genuine clinical concern
- Keep all string values concise and actionable`

export function buildAnalysisPrompt(context: RAGContext): string {
  const sections: string[] = []

  sections.push(`You are analyzing session number ${context.client.sessionNumber} for ${context.client.name}, age ${context.client.age}, who has these conditions: ${context.client.conditions.join(', ')}.`)

  sections.push('LIVE SESSION TRANSCRIPT:')
  sections.push(context.transcript)
  sections.push('END TRANSCRIPT')

  sections.push('\nIN-SESSION ACTIVITY (what the client actually did in modules):')
  if (context.moduleEvents.length > 0) {
    for (const e of context.moduleEvents) sections.push(`- ${e}`)
  } else {
    sections.push('No module activity recorded yet this session.')
  }

  if (context.inCallNotes.length > 0) {
    sections.push("\nTHERAPIST'S IN-CALL NOTES:")
    for (const n of context.inCallNotes) sections.push(`- ${n}`)
  }

  if (context.hasStudyMaterial) {
    sections.push('\nRELEVANT STUDY MATERIAL:')
    for (const chunk of context.studyMaterial) {
      sections.push(`From "${chunk.fileName}" (relevance: ${chunk.similarity.toFixed(2)}):`)
      sections.push(chunk.text)
    }
  }

  if (context.hasPreviousNotes) {
    sections.push('\nPREVIOUS SESSION NOTES:')
    for (const note of context.previousNotes) {
      sections.push(`Session ${note.sessionNumber} (${note.createdAt.toISOString().split('T')[0]}):`)
      sections.push(note.content.slice(0, 500))
    }
  }

  sections.push(`\nAVAILABLE THERAPY MODULES: ${context.availableModules.join(', ')}`)

  sections.push('\nAnalyze this therapy session and return your clinical insights as JSON.')

  return sections.join('\n')
}
