// Client for the call-plan AI agent in the Python AI service (ai/call_plan).
//
// The therapist uploads (or pastes) a client's previous notes; the agent reads
// them, searches the STAAD module reports, and returns recommended modules and
// a task list for this call. Later it can mark tasks covered from the live
// transcript. Each request opens one WebSocket with a short-lived token from
// the backend's /api/call-plan-token (session owner + plan + AI consent).
//
// The plan is saved on the session doc as `callPlan`; the uploaded file is not
// stored anywhere.

import { apiFetch } from '@/lib/api'
import { ALL_MODULES, MODULE_CATEGORIES } from '@/lib/modules'

export interface CallPlanModule {
  id: string
  name: string
  reason: string
  /** Module-report sections the recommendation could draw on. */
  sources?: string[]
}

export interface CallPlanTask {
  id: string
  text: string
  moduleId: string | null
  done: boolean
  /** 'ai' when the agent marked it from the transcript, else the therapist. */
  doneBy?: 'ai' | 'therapist'
}

export interface CallPlan {
  summary: string
  focus: string
  risk: 'none' | 'watch' | 'urgent'
  riskDetail: string
  modules: CallPlanModule[]
  tasks: CallPlanTask[]
  usedModuleReports: boolean
  model: string
  generatedAt: number
  /** File name or "Pasted notes". */
  source: string
  /** The agent's latest "what next" from a progress check. */
  next?: string
  checkedAt?: number
}

export type AgentStep = 'reading' | 'searching' | 'planning' | 'revising'

export const AGENT_STEP_LABEL: Record<AgentStep, string> = {
  reading: 'Reading the notes…',
  searching: 'Searching the module reports…',
  planning: 'Planning the call…',
  revising: 'Checking the plan…',
}

export const MAX_NOTES_FILE_BYTES = 5 * 1024 * 1024
export const NOTES_FILE_ACCEPT = '.pdf,.docx,.txt,.md'

// The AI service is the same one that relays speech-to-text.
const AI_SERVICE_URL = process.env.NEXT_PUBLIC_STT_RELAY_URL || 'http://localhost:4100'

async function agentToken(sessionId: string): Promise<string> {
  const res = await apiFetch('/api/call-plan-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not start the AI agent.')
  return data.token
}

/** Sends `request` (and then `file`'s bytes, if given) and resolves with the agent's final reply. */
async function ask(
  sessionId: string,
  request: Record<string, unknown>,
  file: File | null,
  onStep?: (step: AgentStep) => void
): Promise<Record<string, any>> {
  const token = await agentToken(sessionId)
  const url = new URL('/call-plan', AI_SERVICE_URL)
  url.protocol = url.protocol.replace('http', 'ws')
  url.searchParams.set('sid', sessionId)
  url.searchParams.set('token', token)
  const bytes = file ? await file.arrayBuffer() : null

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url.toString())
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
      ws.close()
    }
    ws.onopen = () => {
      ws.send(JSON.stringify(request))
      if (bytes) ws.send(bytes)
    }
    ws.onmessage = (event) => {
      let msg: Record<string, any>
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (msg.type === 'status') onStep?.(msg.step as AgentStep)
      else if (msg.type === 'error') finish(() => reject(new Error(msg.error || 'The AI agent failed.')))
      else finish(() => resolve(msg))
    }
    ws.onerror = () => finish(() => reject(new Error('Could not reach the AI service.')))
    ws.onclose = (event) =>
      finish(() => reject(new Error(event.code === 1008 ? 'Not allowed to use the AI agent.' : 'The AI agent disconnected.')))
  })
}

/** The modules this therapist may launch, with their category, for the agent to choose from. */
export function agentModuleCatalogue(allowedIds: string[]) {
  const allowed = new Set(allowedIds)
  return MODULE_CATEGORIES.flatMap((c) =>
    c.modules
      .filter((m) => allowed.has(m.id))
      .map((m) => ({ id: m.id, name: m.name, category: `${c.name} (${c.desc})`, desc: m.desc }))
  )
}

export async function makeCallPlan(opts: {
  sessionId: string
  allowedModuleIds: string[]
  clientName?: string
  file?: File | null
  notesText?: string
  onStep?: (step: AgentStep) => void
}): Promise<CallPlan> {
  const { sessionId, allowedModuleIds, clientName, file = null, notesText, onStep } = opts
  if (file && file.size > MAX_NOTES_FILE_BYTES) throw new Error('The file is larger than 5 MB.')
  const reply = await ask(
    sessionId,
    {
      type: 'plan',
      modules: agentModuleCatalogue(allowedModuleIds),
      clientName,
      ...(file ? { file: { name: file.name } } : { notesText }),
    },
    file,
    onStep
  )
  return { ...(reply.plan as Omit<CallPlan, 'source'>), source: file ? file.name : 'Pasted notes' }
}

export async function checkCallPlanProgress(opts: {
  sessionId: string
  tasks: CallPlanTask[]
  transcript: { speaker: string; text: string }[]
}): Promise<{ covered: string[]; next: string }> {
  const reply = await ask(
    opts.sessionId,
    {
      type: 'progress',
      tasks: opts.tasks.map(({ id, text, done }) => ({ id, text, done })),
      transcript: opts.transcript.map(({ speaker, text }) => ({ speaker, text })),
    },
    null
  )
  return { covered: Array.isArray(reply.covered) ? reply.covered : [], next: String(reply.next ?? '') }
}

export const isKnownModule = (id: string | null | undefined): id is string =>
  !!id && ALL_MODULES.some((m) => m.id === id)
