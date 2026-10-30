import { callAIService } from '@/lib/ai-service'
import { getReportInputs, saveReportStats } from './session-data'
import { computeReportStats, type ReportStats } from './stats'

// The end-of-session report. The session data and the statistics stay here; the
// AI service (ai/report) writes the narrative from that data.

export interface ReportClient {
  name: string
  age?: number
  conditions?: string[]
  sessionNumber?: number
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

  // Only the fields the report prompt reads.
  const { content, model } = await callAIService('report', sessionId, {
    client,
    inputs: {
      transcript: inputs.transcript.map(({ speaker, text }) => ({ speaker, text })),
      moduleEvents: inputs.moduleEvents.map(({ detail }) => ({ detail })),
      therapistNotes: inputs.therapistNotes.map(({ content }) => ({ content })),
      callPlan: inputs.callPlan ?? null,
    },
  })
  return { content, model, stats }
}
