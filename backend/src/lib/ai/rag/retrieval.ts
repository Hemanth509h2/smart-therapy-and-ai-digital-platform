import { neon } from '@neondatabase/serverless'
import { generateEmbedding } from './nvidia-client'
import { getSessionTranscript, getSessionActivity } from './transcript-store'
import { formatTranscriptForLLM } from './transcription'

const sql = neon(process.env.DATABASE_URL!)

export interface ClientProfile {
  clientId: string
  name: string
  age: number
  conditions: string[]
  sessionNumber: number
  therapistId: string
}

export interface RetrievedChunk {
  text: string
  fileName: string
  chunkIndex: number
  similarity: number
}

export interface PreviousNote {
  sessionId: string
  content: string
  createdAt: Date
  sessionNumber: number
}

export interface RAGContext {
  transcript: string
  transcriptMinutes: number
  // What actually happened inside therapy modules this session (human-readable).
  moduleEvents: string[]
  // The therapist's in-call typed notes this session (optional).
  inCallNotes: string[]
  studyMaterial: RetrievedChunk[]
  hasStudyMaterial: boolean
  previousNotes: PreviousNote[]
  hasPreviousNotes: boolean
  client: ClientProfile
  availableModules: string[]
  retrievedAt: number
}

export const AVAILABLE_MODULES = [
  'word-building',
  'whack-a-mole-math',
  'pixel-art-coding',
  'bubble-splash',
  'n-back-challenge',
  'virtual-maze',
  'simon-says',
  'grounding-game',
  'emotional-charades',
  'box-popping',
  'worry-box',
  'drag-drop-sorting',
  'social-story',
  'virtual-shop',
  'emotion-wheel',
  'defusion-river',
  'thought-challenger',
  'micro-quest-board',
  'values-card-sort',
  'worry-vault',
  'facts-vs-feelings',
]

export async function retrieveRAGContext(
  sessionId: string,
  therapistId: string,
  clientProfile: ClientProfile,
  transcriptWindowMinutes: number = 5
): Promise<RAGContext> {
  const [transcript, previousNotes, activity] = await Promise.all([
    retrieveTranscript(sessionId, transcriptWindowMinutes),
    retrievePreviousNotes(therapistId, clientProfile.clientId, 3),
    getSessionActivity(sessionId),
  ])

  const materialChunks = await retrieveStudyMaterial(
    therapistId,
    transcript,
    3
  )

  return {
    transcript,
    transcriptMinutes: transcriptWindowMinutes,
    moduleEvents: activity.moduleEvents,
    inCallNotes: activity.inCallNotes,
    studyMaterial: materialChunks,
    hasStudyMaterial: materialChunks.length > 0,
    previousNotes,
    hasPreviousNotes: previousNotes.length > 0,
    client: clientProfile,
    availableModules: AVAILABLE_MODULES,
    retrievedAt: Date.now(),
  }
}

async function retrieveTranscript(
  sessionId: string,
  minutes: number
): Promise<string> {
  try {
    const chunks = await getSessionTranscript(sessionId)
    if (chunks.length === 0) {
      return 'No transcript available for this session yet.'
    }
    return formatTranscriptForLLM(chunks, minutes)
  } catch (e) {
    console.warn('[Retrieval] Transcript fetch failed:', e)
    return 'Transcript unavailable.'
  }
}

export async function retrieveStudyMaterial(
  therapistId: string,
  queryText: string,
  topK: number = 3
): Promise<RetrievedChunk[]> {
  try {
    const count = await sql`
      SELECT COUNT(*) as count
      FROM document_chunks
      WHERE therapist_id = ${therapistId}
    `
    if (Number(count[0].count) === 0) {
      return []
    }

    const queryEmbedding = await generateEmbedding(queryText, 'query')

    const results = await sql`
      SELECT
        chunk_text,
        file_name,
        chunk_index,
        1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector)
          AS similarity
      FROM document_chunks
      WHERE therapist_id = ${therapistId}
        AND 1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) > 0.25
      ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
      LIMIT ${topK}
    `

    return results.map(r => ({
      text: r.chunk_text as string,
      fileName: r.file_name as string,
      chunkIndex: Number(r.chunk_index),
      similarity: Number(r.similarity),
    }))
  } catch (e) {
    console.warn('[Retrieval] Study material search failed:', e)
    return []
  }
}

export async function retrievePreviousNotes(
  therapistId: string,
  clientId: string,
  limit: number = 3
): Promise<PreviousNote[]> {
  try {
    const rows = await sql`
      SELECT
        n."sessionId" as session_id,
        n."content" as content,
        n."createdAt" as created_at,
        ROW_NUMBER() OVER (
          ORDER BY n."createdAt" DESC
        ) AS session_number
      FROM "TherapistNote" n
      INNER JOIN "Session" s ON s."id" = n."sessionId"
      WHERE s."therapistId" = ${therapistId}
        AND s."clientId" = ${clientId}
      ORDER BY n."createdAt" DESC
      LIMIT ${limit}
    `

    return rows.map(r => ({
      sessionId: r.session_id as string,
      content: r.content as string,
      createdAt: new Date(r.created_at as string),
      sessionNumber: Number(r.session_number),
    }))
  } catch (e) {
    console.warn('[Retrieval] Previous notes fetch failed:', e)
    return []
  }
}

export function formatContextForLLM(context: RAGContext): string {
  const sections: string[] = []

  sections.push(`CLIENT PROFILE:
Name: ${context.client.name}
Age: ${context.client.age}
Conditions: ${context.client.conditions.join(', ')}
Session number: ${context.client.sessionNumber}`)

  sections.push(`LIVE SESSION TRANSCRIPT (last ${context.transcriptMinutes} min):
${context.transcript}`)

  if (context.hasStudyMaterial) {
    const materialText = context.studyMaterial
      .map((c, i) =>
        `[${i + 1}] From "${c.fileName}" (relevance: ${c.similarity.toFixed(2)}):
${c.text}`
      )
      .join('\n\n')
    sections.push(`THERAPIST'S CLINICAL MATERIAL:
${materialText}`)
  } else {
    sections.push('THERAPIST\'S CLINICAL MATERIAL:\nNo study material uploaded.')
  }

  if (context.hasPreviousNotes) {
    const notesText = context.previousNotes
      .map((n, i) =>
        `[Session ${i + 1} — ${n.createdAt.toLocaleDateString()}]:
${n.content.slice(0, 300)}${n.content.length > 300 ? '...' : ''}`
      )
      .join('\n\n')
    sections.push(`PREVIOUS SESSION NOTES:
${notesText}`)
  } else {
    sections.push('PREVIOUS SESSION NOTES:\nNo previous notes available.')
  }

  sections.push(`AVAILABLE THERAPY MODULES:
${context.availableModules.join(', ')}`)

  return sections.join('\n\n' + '\u2500'.repeat(40) + '\n\n')
}
