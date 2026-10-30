import type { Request } from 'express'
import { timingSafeEqual } from 'crypto'
import { reply, type Reply } from '@/lib/http/reply'

/** Constant-time string compare that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function hasValidKey(request: Request): boolean {
  const key = process.env.AUTOMATION_API_KEY
  const provided = request.get('x-api-key')
  return Boolean(key && provided && safeEqual(provided, key))
}

/**
 * Guard for every /api/automation/* endpoint. n8n sends the shared secret in
 * `x-api-key` (AUTOMATION_API_KEY). Returns a 401 response, or null when allowed.
 * If the env var is not set the endpoints stay closed.
 */
export function rejectUnlessAutomation(request: Request): Reply | null {
  if (hasValidKey(request)) return null
  return reply({ error: 'This endpoint needs a valid automation API key in the x-api-key header.' }, 401)
}
