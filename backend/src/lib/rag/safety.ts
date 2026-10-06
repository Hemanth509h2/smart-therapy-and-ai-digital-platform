import { chatJSON, COPILOT_MODEL, extractJSON } from '@/lib/report/openrouter-client'

// A dedicated safety pass, run in PARALLEL with the main analysis. The probe
// showed general chat models are inconsistent at catching safety cues (one named
// suicidal ideation, another said "none") — so the risk verdict must NOT depend
// on whether the suggestion model happened to notice. This call does ONE job:
// scan the recent client utterances for risk. Same model, tight prompt.

export type RiskLevel = 'none' | 'watch' | 'urgent'

export interface SafetyVerdict {
  level: RiskLevel
  cue: string // the exact phrase/behaviour that triggered concern ('' if none)
  rationale: string // one short clinical sentence ('' if none)
}

const SAFETY_SYSTEM_PROMPT = `You are a clinical safeguarding monitor for a live child/adolescent tele-therapy session. You do ONE job: scan the transcript for risk and report it. You do not give therapy advice.

Respond with valid JSON only — no markdown, no code fences:
{
  "level": "none" | "watch" | "urgent",
  "cue": "string",        // the exact client phrase or behaviour that concerned you; "" if none
  "rationale": "string"   // one short clinical sentence explaining the concern; "" if none
}

Risk levels:
- "urgent": explicit or strongly implied self-harm, suicide, intent to harm others, abuse disclosure, or immediate danger. Crisis protocol may be warranted.
- "watch": indirect or emerging concern — hopelessness, worthlessness ("what's the point"), passive ideation, escalating distress, hints of harm. Worth the therapist's attention, not yet a crisis.
- "none": no safeguarding concern detected.

Rules:
- Judge ONLY the client's words/behaviour in the transcript. Do not infer beyond what is said.
- Err toward "watch" over "none" when language is ambiguous but concerning (e.g. hopelessness). Reserve "urgent" for genuine, clear danger.
- Keep cue and rationale to a single short line each.`

function parseVerdict(raw: string): SafetyVerdict {
  const p = extractJSON(raw)
  if (!p) {
    // A safety parse failure must never silently read as "safe". Surface it as a
    // soft flag so the therapist still looks, without crying wolf.
    return {
      level: 'watch',
      cue: '',
      rationale: 'Safety check could not be parsed — review the transcript manually.',
    }
  }
  const level: RiskLevel =
    p.level === 'urgent' || p.level === 'watch' ? p.level : 'none'
  return {
    level,
    cue: typeof p.cue === 'string' ? p.cue : '',
    rationale: typeof p.rationale === 'string' ? p.rationale : '',
  }
}

export async function runSafetyScan(transcript: string): Promise<SafetyVerdict> {
  if (!transcript || transcript.trim().length === 0) {
    return { level: 'none', cue: '', rationale: '' }
  }
  const user = `RECENT SESSION TRANSCRIPT:\n${transcript}\n\nScan the client's utterances for safeguarding risk and return your verdict as JSON.`
  const raw = await chatJSON(COPILOT_MODEL, SAFETY_SYSTEM_PROMPT, user, 256)
  return parseVerdict(raw)
}
