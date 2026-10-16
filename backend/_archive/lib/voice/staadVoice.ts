// The single entry point for every spoken line in Staad's therapy modules.
//
// WHY THIS EXISTS
// Before this utility, eight modules each called speechSynthesis directly and
// NONE of them set `lang` or `voice` on the utterance. Every module therefore
// inherited whatever voice the browser happened to default to, which is why the
// accent sounded arbitrary and inconsistent between modules. (The audible
// difference between modules came from their differing rate/pitch values —
// 0.85 to 1.1 — not from any accent choice, because no accent was ever chosen.)
//
// IMPORTANT LIMITATION, READ BEFORE TRUSTING THIS
// The Web Speech API can only use voices already installed on the user's
// OS/browser. Staad cannot install an Indian English voice on someone's device.
// This utility asks for the best available match and warns loudly when it has to
// settle for something else, so a wrong accent is visible rather than silent. It
// cannot guarantee an Indian accent everywhere. Delivering that reliably needs a
// cloud TTS provider that returns audio we control.

export type VoiceLanguage = 'en-IN' | 'hi-IN' | 'te-IN'
export type SpeechType = 'instruction' | 'praise' | 'feedback'

export interface SpeakOptions {
  text: string
  language: VoiceLanguage
  type: SpeechType
  /**
   * Fired once when this line stops being spoken — whether it finished, errored
   * or was cut short by staadCancel(). Lets a module chain utterances to the
   * real speech duration instead of guessing with a timer. Never fires if the
   * browser has no speech support, so callers still need their own fallback.
   */
  onEnd?: () => void
}

/** Shared praise bank so every module uses the same encouraging language. */
export const PRAISE_PHRASES: Record<VoiceLanguage, string[]> = {
  'en-IN': ['Very good!', 'Amazing job!', 'Well done!', 'Excellent!', 'You got it!'],
  'hi-IN': ['बहुत अच्छे!', 'शाबाश!', 'बहुत बढ़िया!'],
  'te-IN': ['చాలా బాగుంది!', 'అద్భుతం!', 'బాగా చేసావు!'],
}

/** Pick a random praise line so repeated correct answers do not sound canned. */
export function randomPraise(language: VoiceLanguage): string {
  const bank = PRAISE_PHRASES[language] ?? PRAISE_PHRASES['en-IN']
  return bank[Math.floor(Math.random() * bank.length)]
}

/**
 * Speak a celebration line.
 *
 * `englishLine` is an optional module-specific sentence ("You found the way
 * out!"). It is used only for en-IN, because those lines have no Hindi/Telugu
 * translations — for other languages we fall back to the shared praise bank
 * rather than have a Hindi voice read an English sentence.
 */
export function staadPraise(language: VoiceLanguage, englishLine?: string): void {
  const text = language === 'en-IN' && englishLine ? englishLine : randomPraise(language)
  staadSpeak({ text, language, type: 'praise' })
}

/* Prosody per utterance type. Values stay in the range the modules already used
   so migrating does not change how familiar prompts sound. */
const PROSODY: Record<SpeechType, { rate: number; pitch: number }> = {
  instruction: { rate: 0.9, pitch: 1.0 },
  praise: { rate: 0.95, pitch: 1.15 },
  feedback: { rate: 0.9, pitch: 1.05 },
}

/* Ordered match strategies per language. Each entry is tried in turn against the
   installed voice list; the first hit wins. `nameHints` catch voices that expose
   a generic lang tag but are regional by name (e.g. Microsoft's "Heera - English
   (India)", Google's "Google हिन्दी"). */
const MATCH_CHAIN: Record<VoiceLanguage, { langPrefixes: string[]; nameHints: string[] }[]> = {
  'en-IN': [
    { langPrefixes: ['en-in'], nameHints: [] },
    { langPrefixes: [], nameHints: ['india', 'indian', 'heera', 'ravi', 'neerja', 'prabhat'] },
    // Hindi voices read English text with an Indian accent — a better proxy than
    // en-US/en-GB, per the fallback chain we want.
    { langPrefixes: ['hi-in', 'hi'], nameHints: ['हिन्दी', 'hindi'] },
    { langPrefixes: ['en'], nameHints: [] },
  ],
  'hi-IN': [
    { langPrefixes: ['hi-in', 'hi'], nameHints: ['हिन्दी', 'hindi'] },
    { langPrefixes: ['en-in'], nameHints: ['india', 'indian'] },
    { langPrefixes: ['en'], nameHints: [] },
  ],
  'te-IN': [
    { langPrefixes: ['te-in', 'te'], nameHints: ['telugu', 'తెలుగు'] },
    { langPrefixes: ['hi-in', 'hi'], nameHints: ['हिन्दी', 'hindi'] },
    { langPrefixes: ['en-in'], nameHints: ['india', 'indian'] },
    { langPrefixes: ['en'], nameHints: [] },
  ],
}

/** Resolution outcome, cached per language for the rest of the session. */
export interface ResolvedVoice {
  voice: SpeechSynthesisVoice | null
  /** true when we got a genuinely region-appropriate voice. */
  exact: boolean
  /** Which strategy matched, for diagnostics. */
  via: string
}

const resolvedCache = new Map<VoiceLanguage, ResolvedVoice>()
const warnedFor = new Set<string>()

function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function matches(voice: SpeechSynthesisVoice, langPrefixes: string[], nameHints: string[]): boolean {
  const lang = (voice.lang || '').toLowerCase().replace('_', '-')
  const name = (voice.name || '').toLowerCase()
  if (langPrefixes.some((p) => lang === p || lang.startsWith(`${p}-`))) return true
  if (nameHints.some((h) => name.includes(h))) return true
  return false
}

function resolveVoice(language: VoiceLanguage): ResolvedVoice {
  const cached = resolvedCache.get(language)
  if (cached) return cached

  const voices = supported() ? window.speechSynthesis.getVoices() : []
  // Voice list not populated yet — do NOT cache, so a later call can retry once
  // the browser has loaded them.
  if (!voices.length) return { voice: null, exact: false, via: 'voices-not-loaded' }

  const chain = MATCH_CHAIN[language]
  for (let i = 0; i < chain.length; i++) {
    const { langPrefixes, nameHints } = chain[i]
    const hit = voices.find((v) => matches(v, langPrefixes, nameHints))
    if (hit) {
      // Only the first strategy is a true regional match; the rest are proxies.
      const result: ResolvedVoice = {
        voice: hit,
        exact: i === 0,
        via: i === 0 ? 'exact' : `fallback:${langPrefixes.join('/') || nameHints.join('/')}`,
      }
      resolvedCache.set(language, result)
      warnIfDegraded(language, result, voices)
      return result
    }
  }

  const result: ResolvedVoice = { voice: null, exact: false, via: 'none' }
  resolvedCache.set(language, result)
  warnIfDegraded(language, result, voices)
  return result
}

function warnIfDegraded(language: VoiceLanguage, r: ResolvedVoice, voices: SpeechSynthesisVoice[]) {
  if (r.exact) return
  if (warnedFor.has(language)) return
  warnedFor.add(language)

  if (!r.voice) {
    console.warn(
      `[staadVoice] No voice at all matched "${language}" on this browser. Speech will use ` +
        `the browser default voice, whose accent is unknown and likely not Indian. ` +
        `Installed voices: ${voices.length}.`
    )
    return
  }
  console.warn(
    `[staadVoice] No "${language}" voice is installed on this browser. Falling back to ` +
      `"${r.voice.name}" (${r.voice.lang}) via ${r.via}. The accent will NOT be a genuine ` +
      `${language} accent. Reliable Indian/Hindi/Telugu voices require a cloud TTS service. ` +
      `Installed voices: ${voices.map((v) => `${v.name} [${v.lang}]`).join(', ')}`
  )
}

/* Speak calls that arrive before the browser has populated getVoices() are held
   here briefly rather than played with the wrong voice. */
let pending: SpeakOptions[] = []
let listening = false

function flushPending() {
  const queued = pending
  pending = []
  for (const opts of queued) enqueue(opts)
}

function watchForVoices() {
  if (listening || !supported()) return
  listening = true
  const onChange = () => {
    resolvedCache.clear()
    flushPending()
  }
  window.speechSynthesis.addEventListener?.('voiceschanged', onChange, { once: true })
  // Safety net: some browsers never fire voiceschanged. Speak anyway rather than
  // stay silent.
  setTimeout(() => {
    if (pending.length) flushPending()
  }, 1200)
}

/* Chrome and Safari can garbage-collect an utterance that is still being spoken,
   which truncates the line mid-word. Holding a reference until it reports back is
   the standard workaround. */
const inFlight = new Set<SpeechSynthesisUtterance>()

/* Chrome also silently pauses synthesis after roughly 15 seconds of speaking.
   resume() is a no-op when nothing is paused, so poking it on a timer while
   speech is in progress costs nothing and keeps long read-backs going. */
let keepAlive: ReturnType<typeof setInterval> | null = null

function startKeepAlive() {
  if (keepAlive || !supported()) return
  keepAlive = setInterval(() => {
    const synth = window.speechSynthesis
    if (!synth.speaking && !synth.pending) { stopKeepAlive(); return }
    synth.resume()
  }, 5000)
}

function stopKeepAlive() {
  if (!keepAlive) return
  clearInterval(keepAlive)
  keepAlive = null
}

function enqueue({ text, language, type, onEnd }: SpeakOptions) {
  if (!supported() || !text) return
  const utterance = new SpeechSynthesisUtterance(text)
  let fired = false
  const done = () => {
    if (fired) return
    fired = true
    inFlight.delete(utterance)
    if (!inFlight.size) stopKeepAlive()
    onEnd?.()
  }
  // `error` covers the cancel path: browsers differ on whether an interrupted
  // utterance ends or errors, so listen for both and de-duplicate.
  utterance.onend = done
  utterance.onerror = done
  const { rate, pitch } = PROSODY[type] ?? PROSODY.instruction
  utterance.rate = rate
  utterance.pitch = pitch
  // Always set lang, even when no matching voice object exists — some engines
  // honour the tag on their own.
  utterance.lang = language

  const resolved = resolveVoice(language)
  if (resolved.voice) utterance.voice = resolved.voice
  inFlight.add(utterance)
  window.speechSynthesis.speak(utterance)
  startKeepAlive()
}

/**
 * Speak a line. The only speech entry point modules should use.
 * Does not cancel what is already playing — call staadCancel() first when a
 * module needs to interrupt itself.
 */
export function staadSpeak(options: SpeakOptions): void {
  if (!supported() || !options.text) return
  // Voices unavailable so far: hold the line and retry once they load, so the
  // first utterance of a session is not the one with the wrong accent.
  if (!window.speechSynthesis.getVoices().length) {
    pending.push(options)
    watchForVoices()
    return
  }
  enqueue(options)
}

/** Stop anything currently being spoken (and drop anything queued here). */
export function staadCancel(): void {
  pending = []
  if (!supported()) return
  // cancel() fires end/error on the live utterances, which clears inFlight and
  // stops the keep-alive through the normal path.
  window.speechSynthesis.cancel()
  stopKeepAlive()
}

/**
 * Diagnostics for the language toggle / dev verification: what did we actually
 * resolve for this language on this browser?
 */
export function getVoiceDiagnostics(language: VoiceLanguage): ResolvedVoice & { installed: number } {
  const r = resolveVoice(language)
  const installed = supported() ? window.speechSynthesis.getVoices().length : 0
  return { ...r, installed }
}
