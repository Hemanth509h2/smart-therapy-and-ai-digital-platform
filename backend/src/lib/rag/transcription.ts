import {
  createClient,
  LiveTranscriptionEvents,
  type LiveClient,
} from '@deepgram/sdk'
import type { TranscriptChunk } from './types'

if (!process.env.DEEPGRAM_API_KEY) {
  throw new Error('DEEPGRAM_API_KEY is not set in .env')
}

const deepgram = createClient(process.env.DEEPGRAM_API_KEY)

export interface TranscriptionOptions {
  sessionId: string
  onChunk: (chunk: TranscriptChunk) => void
  onError: (error: Error) => void
}

export class SessionTranscriber {
  private connection: LiveClient | null = null
  private sessionId: string
  private onChunk: (chunk: TranscriptChunk) => void
  private onError: (error: Error) => void
  private startTime: number = 0
  private isConnected: boolean = false

  constructor(options: TranscriptionOptions) {
    this.sessionId = options.sessionId
    this.onChunk = options.onChunk
    this.onError = options.onError
  }

  async connect(): Promise<void> {
    this.startTime = Date.now()

    this.connection = deepgram.listen.live({
      model: 'nova-3',
      language: 'en-IN',
      smart_format: true,
      diarize: true,
      diarize_version: 'latest',
      interim_results: false,
      utterance_end_ms: 1500,
      vad_events: true,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
    })

    this.connection.on(LiveTranscriptionEvents.Open, () => {
      this.isConnected = true
      console.log(`[Transcriber] Connected — session: ${this.sessionId}`)
    })

    this.connection.on(
      LiveTranscriptionEvents.Transcript,
      (data) => {
        const result = data.channel?.alternatives?.[0]
        if (!result || !result.transcript || result.transcript.trim() === '') {
          return
        }

        if (!data.is_final) return

        const words = result.words ?? []
        const speakerNum = words[0]?.speaker ?? null
        const speaker: TranscriptChunk['speaker'] =
          speakerNum === 0 ? 'therapist' :
          speakerNum === 1 ? 'client' : 'unknown'

        const chunk: TranscriptChunk = {
          text: result.transcript.trim(),
          speaker,
          timestamp: Date.now(),
          sessionMinute: Math.floor((Date.now() - this.startTime) / 60000),
          isFinal: data.is_final,
        }

        this.onChunk(chunk)
      }
    )

    this.connection.on(LiveTranscriptionEvents.Error, (error) => {
      console.error('[Transcriber] Error:', error)
      this.onError(new Error(String(error)))
    })

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      this.isConnected = false
      console.log(`[Transcriber] Connection closed — session: ${this.sessionId}`)
    })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Deepgram connection timeout after 10s'))
      }, 10000)

      this.connection!.on(LiveTranscriptionEvents.Open, () => {
        clearTimeout(timeout)
        resolve()
      })

      this.connection!.on(LiveTranscriptionEvents.Error, (e) => {
        clearTimeout(timeout)
        reject(new Error(String(e)))
      })
    })
  }

  sendAudio(audioBuffer: any): void {
    if (!this.connection || !this.isConnected) {
      console.warn('[Transcriber] Cannot send audio — not connected')
      return
    }
    this.connection.send(audioBuffer)
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      ;(this.connection as any).requestClose()
      this.connection = null
      this.isConnected = false
    }
  }

  get connected(): boolean {
    return this.isConnected
  }
}

export function getRecentTranscript(
  chunks: TranscriptChunk[],
  minutes: number = 5
): string {
  const cutoff = Date.now() - minutes * 60 * 1000
  return chunks
    .filter(c => c.timestamp >= cutoff && c.isFinal)
    .map(c => `[${c.speaker}]: ${c.text}`)
    .join('\n')
}

export function formatTranscriptForLLM(
  chunks: TranscriptChunk[],
  minutes: number = 5
): string {
  const recent = chunks.filter(
    c => c.timestamp >= Date.now() - minutes * 60 * 1000
  )

  if (recent.length === 0) {
    return 'No transcript available for this time window.'
  }

  return recent
    .map(c => `[${c.speaker.toUpperCase()}]: ${c.text}`)
    .join('\n')
}
