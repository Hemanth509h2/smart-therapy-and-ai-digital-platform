import OpenAI from 'openai'

// Free model by default; override with OPENROUTER_MODEL in .env to swap (e.g.
// to a stronger paid model or Claude) without touching code. The report runs
// once after the session — speed is irrelevant, so a larger free model is fine.
export const REPORT_MODEL =
  process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free'

// Lazily constructed so a missing key never breaks builds/imports — it only
// throws when a report is actually generated.
let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set in .env')
  }
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://staad.therapy',
        'X-Title': 'STAAD Therapy',
      },
    })
  }
  return client
}

export async function generateReportText(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: REPORT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 2000,
  })
  return res.choices[0]?.message?.content ?? ''
}

// Live copilot model — separate from the report so it can be swapped/tuned for
// latency without affecting the (latency-insensitive) end-of-session report.
// gpt-oss-120b was the only probed free model that reliably surfaced safety cues.
export const COPILOT_MODEL =
  process.env.OPENROUTER_COPILOT_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free'

// Low-temperature chat for the copilot's structured (JSON) passes. We deliberately
// do NOT set response_format: json_object — gpt-oss models mangle their output under
// forced JSON mode (escaped-quote corruption + leaked harmony control tokens, and
// ~3x slower). Instead the prompts instruct "JSON only" and callers parse tolerantly
// via extractJSON. Returns the raw model string.
export async function chatJSON(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1024
): Promise<string> {
  const res = await getClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
  })
  return res.choices[0]?.message?.content ?? '{}'
}

// Tolerant JSON extraction for LLM output: strips markdown code fences and any
// prose around the object, then parses the outermost { ... }. Returns null on
// failure so callers can apply their own fallback. Use this instead of raw
// JSON.parse on any model response.
export function extractJSON<T = Record<string, unknown>>(raw: string): T | null {
  if (!raw) return null
  let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  if (i >= 0 && j > i) t = t.slice(i, j + 1)
  try {
    return JSON.parse(t) as T
  } catch {
    return null
  }
}
