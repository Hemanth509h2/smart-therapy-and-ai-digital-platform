import { generateReportText, REPORT_MODEL } from './openrouter-client'
import { getReportInputs, saveReportStats, type ReportInputs } from './session-data'
import { computeReportStats, type ReportStats } from './stats'

export interface ReportClient {
  name: string
  age?: number
  conditions?: string[]
  sessionNumber?: number
}

export const REPORT_SYSTEM_PROMPT = `You are a clinical psychologist writing a post-session therapy report for a child/adolescent tele-therapy session on the STAAD platform.

Write the ENTIRE report in clear, professional ENGLISH, regardless of the language spoken in the session (the transcript is already translated to English).

Use this exact structure with Markdown headings:

## Session Summary
2-4 sentences on what the session covered overall.

## Presentation & Emotional State
The client's mood, affect and emotional themes evident in the conversation.

## Activities & Engagement
What therapy modules/activities were used and how the client engaged with them, based on the activity log. If no activities were logged, say "No interactive activities were recorded this session."

## Therapist Observations
Incorporate the therapist's in-call notes if any were provided. If none, write "No in-call notes were recorded."

## Risk & Safeguarding
State clearly if any self-harm, suicide, abuse, violence or safeguarding concern appeared (even indirect). If none, write "No risk indicators were identified in this session."

## Recommendations & Next Steps
2-5 concrete, actionable suggestions for the next session.

Rules:
- Base the report ONLY on the provided transcript, activity log and notes. Do NOT invent facts, quotes, diagnoses or events.
- If a section has insufficient information, say so plainly rather than speculating.
- Be concise, clinical and non-judgmental. No markdown code fences around the whole report.`

function formatInputs(inputs: ReportInputs, client: ReportClient): string {
  const lines: string[] = []

  lines.push('CLIENT PROFILE:')
  lines.push(`Name: ${client.name}`)
  if (client.age != null) lines.push(`Age: ${client.age}`)
  if (client.conditions?.length) lines.push(`Conditions: ${client.conditions.join(', ')}`)
  if (client.sessionNumber != null) lines.push(`Session number: ${client.sessionNumber}`)

  lines.push('\nFULL SESSION TRANSCRIPT (English, speaker-labelled):')
  if (inputs.transcript.length === 0) {
    lines.push('(No transcript was captured for this session.)')
  } else {
    for (const t of inputs.transcript) {
      lines.push(`[${t.speaker}] ${t.text}`)
    }
  }

  lines.push('\nIN-SESSION ACTIVITY LOG:')
  if (inputs.moduleEvents.length === 0) {
    lines.push('(No module activity was recorded.)')
  } else {
    for (const e of inputs.moduleEvents) {
      lines.push(`- ${e.detail}`)
    }
  }

  lines.push("\nTHERAPIST'S IN-CALL NOTES:")
  if (inputs.therapistNotes.length === 0) {
    lines.push('(No in-call notes were recorded.)')
  } else {
    for (const n of inputs.therapistNotes) {
      lines.push(`- ${n.content}`)
    }
  }

  lines.push('\nWrite the full session report now, following the required structure.')
  return lines.join('\n')
}

export interface GeneratedReport {
  content: string
  model: string
  stats: ReportStats
}

export async function generateSessionReport(
  sessionId: string,
  client: ReportClient
): Promise<GeneratedReport> {
  const inputs = await getReportInputs(sessionId)

  // Computed from the same inputs the narrative uses, and saved now because the
  // transcript behind them is purged 24h after the session.
  const stats = computeReportStats(inputs)
  await saveReportStats(sessionId, stats)

  const userPrompt = formatInputs(inputs, client)
  const content = await generateReportText(REPORT_SYSTEM_PROMPT, userPrompt)
  return { content: content.trim(), model: REPORT_MODEL, stats }
}
