import { mintSttToken } from '@/lib/sessions/stt-token'
import { PublicError } from '@/lib/http/apiError'

// All AI work (prompts, model calls, study-material search) runs in the Python
// AI service (ai/). Routes here keep auth, plan and consent checks and every
// read and write of app data: they gather what the AI needs, send it with
// callAIService, and save what comes back.
//
// Transport: one WebSocket per request to the AI service's /internal endpoint
// (ai/internal.py), with a short-lived token of scope 'internal' signed with
// STT_TOKEN_SECRET, the same scheme as the STT and call-plan tokens.

// What the copilot returns (ai/copilot/analysis.py).
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

interface Replies {
  insight: { type: 'insight'; insight: AIInsight }
  report: { type: 'report'; content: string; model: string }
}

const TOKEN_TTL_MS = 5 * 60_000
// The default free model takes ~30s a call, and a full report several of those.
const TIMEOUT_MS = 200_000

function serviceUrl(sessionId: string): string {
  const base = process.env.STT_RELAY_URL || process.env.NEXT_PUBLIC_STT_RELAY_URL || 'http://localhost:4100'
  const url = new URL('/internal', base.replace(/^http/, 'ws'))
  url.searchParams.set('sid', sessionId)
  const secret = process.env.STT_TOKEN_SECRET
  // Without a secret the AI service only accepts this outside production.
  if (secret) url.searchParams.set('token', mintSttToken(sessionId, secret, TOKEN_TTL_MS, 'internal'))
  return url.toString()
}

const unavailable = () => new PublicError("The AI service can't be reached right now. Please try again in a minute.", 503)

export function callAIService<K extends keyof Replies>(
  type: K,
  sessionId: string,
  payload: Record<string, unknown>
): Promise<Replies[K]> {
  return new Promise((resolve, reject) => {
    let settled = false
    const ws = new WebSocket(serviceUrl(sessionId))
    const finish = (result: Replies[K] | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ws.close()
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const timer = setTimeout(() => finish(new PublicError('The AI took too long to answer. Please try again.', 504)), TIMEOUT_MS)

    ws.onopen = () => ws.send(JSON.stringify({ ...payload, type }))
    ws.onmessage = (event) => {
      let reply: any
      try {
        reply = JSON.parse(String(event.data))
      } catch {
        return finish(unavailable())
      }
      if (reply?.type === type) return finish(reply)
      // Only status and the service's own fixed messages, never request content.
      console.error(`[ai-service] ${type} failed: ${reply?.code ?? 'unknown'}`)
      finish(
        reply?.code === 'model'
          ? new PublicError(String(reply.error), 502)
          : reply?.code === 'not_configured'
            ? new PublicError("AI isn't set up on the server yet. Ask an admin to finish the AI setup.", 503)
            : unavailable()
      )
    }
    ws.onerror = () => finish(unavailable())
    ws.onclose = (event) => {
      if (!settled) console.error(`[ai-service] ${type}: connection closed ${event.code} ${event.reason}`)
      finish(unavailable())
    }
  })
}
