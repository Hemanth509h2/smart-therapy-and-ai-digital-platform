export interface TranscriptChunk {
  text: string
  speaker: 'therapist' | 'client' | 'unknown'
  timestamp: number
  sessionMinute: number
  isFinal: boolean
}

export interface SessionTranscript {
  sessionId: string
  therapistId: string
  clientId: string
  chunks: TranscriptChunk[]
  startedAt: number
  lastUpdatedAt: number
  consentGiven: boolean
}

export interface AIInsight {
  emotions: string[]
  summary: string
  steps: string[]
  module: string
  riskFlag: boolean
  // Populated by the dedicated safety pass (src/lib/rag/safety.ts).
  riskLevel?: 'none' | 'watch' | 'urgent'
  riskDetail?: string
  generatedAt: number
  transcriptWindowMinutes: number
}
