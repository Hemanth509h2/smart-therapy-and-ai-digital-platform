'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'

/* ── Art assets ───────────────────────────────────────────────────────────────
   The delivered folder name contains spaces, so every segment is encoded and the
   files are referenced with plain <img>/background-image rather than next/image
   (same pattern as SimonSays and GroundingGame). */
const A = (f: string) =>
  `/assets/modules/ADHD/${encodeURIComponent('N back challenge Assets')}/${encodeURIComponent(f)}`

const ART_HITS = A('hits-icon.svg')
const ART_MISSES = A('misses-icon.svg')
const ART_ACCURACY = A('accuracy-icon.svg')
const ART_PING = A('match-ping.wav')
const ART_MATCH_FX = A('match_feedback_flash.lottie.json')

/* ── Letter stimulus sheets ───────────────────────────────────────────────────
   The delivered letter art ships as three contact sheets of white cards. Each
   card is a fixed 180x180 box on a regular grid, so a single letter is lifted
   out with a percentage crop: the inner 150x150 of a card is pure white with the
   designer's coloured glyph on it, which drops seamlessly onto the white
   stimulus card below. Percentages keep the crop correct at any rendered size.

     background-size-x%     = sheetW / crop
     background-position-x% = cropX / (sheetW - crop)

   The delivered position-grid sheet is NOT used: its viewBox (1000x800) clips
   the bottom row of cards (y 610 + 220 = 830), so three of the nine positions
   are cut off. The 3x3 grid is drawn natively instead, in the same palette the
   sheet uses (#3d35ff active on #ebe9f7). */
interface Sheet { file: string; w: number; h: number }
const SHEET_AJ: Sheet = { file: 'N_Back_Letters_Stimulus_Set.svg', w: 1200, h: 800 }
const SHEET_KT: Sheet = { file: 'N_Back_Letters_K_to_T_Stimulus_Set.svg', w: 1200, h: 600 }
const SHEET_UZ: Sheet = { file: 'N_Back_Letters_U_to_Z_Stimulus_Set.svg', w: 1400, h: 350 }

const CROP = 150 // inner white square of a 180px card
const CROP_DX = 15
const CROP_DY = 10 // the glyph sits a touch high in its card

function letterCrop(letter: string): { sheet: Sheet; x: number; y: number } | null {
  if (!letter || letter.length !== 1) return null
  const code = letter.toUpperCase().charCodeAt(0) - 65
  if (code < 0 || code > 25) return null
  if (code < 10) return { sheet: SHEET_AJ, x: 80 + (code % 5) * 220, y: 80 + Math.floor(code / 5) * 240 }
  if (code < 20) {
    const i = code - 10
    return { sheet: SHEET_KT, x: 80 + (i % 5) * 220, y: 80 + Math.floor(i / 5) * 240 }
  }
  return { sheet: SHEET_UZ, x: [80, 290, 500, 710, 920, 1130][code - 20], y: 80 }
}

function letterArt(letter: string): React.CSSProperties | null {
  const c = letterCrop(letter)
  if (!c) return null
  const cx = c.x + CROP_DX
  const cy = c.y + CROP_DY
  return {
    backgroundImage: `url("${A(c.sheet.file)}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${(c.sheet.w / CROP) * 100}% ${(c.sheet.h / CROP) * 100}%`,
    backgroundPosition: `${(cx / (c.sheet.w - CROP)) * 100}% ${(cy / (c.sheet.h - CROP)) * 100}%`,
  }
}

/* ── Design tokens (white canvas — dark ink everywhere but solid fills) ─────── */
const INDIGO = '#3730D8'
const INDIGO_DEEP = '#2A23A6'
const VIOLET = '#4C3FBF'
const SURFACE = '#F5F3FF'
const BORDER = '#e7eaef'
const CARD_SHADOW = '0 6px 18px rgba(20,30,40,0.05)'
const INK = '#1d2430'
const INK_BODY = '#414b5c'
const INK_MUTED = '#7b8494'
const GREEN = '#15A34A'
const GREEN_SOFT = '#ECFDF3'
const RED = '#E11D48'
const RED_SOFT = '#FEF2F5'
const INDIGO_SOFT = '#EEF0FE'
const TRACK = '#F2F3F8'
const POS_ON = '#3d35ff'
const POS_OFF = '#ebe9f7'

const card: React.CSSProperties = {
  background: '#ffffff',
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  boxShadow: CARD_SHADOW,
}

const microLabel: React.CSSProperties = {
  fontSize: 13.5,
  fontWeight: 800,
  letterSpacing: 0.7,
  color: INDIGO,
  textTransform: 'uppercase',
}

interface NBackChallengeProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type StimulusType = 'colors' | 'shapes' | 'letters' | 'position'

const COLORS = ['🔴', '🔵', '🟡', '🟢', '🟣', '🟠']
const SHAPES = ['⬛', '⭕', '🔺', '⬟', '★', '♦']
const LETTERS = ['B', 'D', 'F', 'G', 'H', 'K']

function poolFor(stimulusType: StimulusType): string[] {
  if (stimulusType === 'colors') return COLORS
  if (stimulusType === 'shapes') return SHAPES
  if (stimulusType === 'letters') return LETTERS
  return Array.from({ length: 9 }, (_, i) => `pos-${i}`)
}

function generateSequence(n: number, stimulusType: StimulusType, length: number): string[] {
  let pool: string[]
  if (stimulusType === 'colors') pool = COLORS
  else if (stimulusType === 'shapes') pool = SHAPES
  else if (stimulusType === 'letters') pool = LETTERS
  else pool = Array.from({ length: 9 }, (_, i) => `pos-${i}`)

  const seq: string[] = []
  const totalMatches = Math.round(length * 0.35)
  const matchIndices = new Set<number>()
  while (matchIndices.size < totalMatches) {
    const idx = n + Math.floor(Math.random() * (length - n))
    if (idx >= n) matchIndices.add(idx)
  }

  for (let i = 0; i < length; i++) {
    if (matchIndices.has(i) && i >= n) {
      seq.push(seq[i - n])
    } else {
      let item: string
      let attempts = 0
      do {
        item = pool[Math.floor(Math.random() * pool.length)]
        attempts++
      } while (
        attempts < 50 &&
        (item === seq[i - 1] || (i >= n && item === seq[i - n]))
      )
      seq.push(item)
    }
  }

  /* Cap consecutive matches at two.

     A run of matches is the same stimulus repeating — literally so at n=1 —
     which reads as "the item I just answered is still on screen". Long runs
     blur into one another, so the next genuine target gets missed.

     The previous version stepped its look-back by 1 rather than n, so it only
     measured a run correctly at n=1, and it broke a run with an unconstrained
     random pick that could re-create the very match it was removing. */
  let run = 0
  for (let i = n; i < length; i++) {
    if (seq[i] !== seq[i - n]) { run = 0; continue }
    run++
    if (run <= 2) continue
    const banned = new Set([seq[i - n], seq[i - 1]])
    const safe = pool.filter((p) => !banned.has(p))
    if (safe.length > 0) {
      seq[i] = safe[Math.floor(Math.random() * safe.length)]
      run = 0
    }
  }

  return seq
}

/* ===================== PRACTICE ROUND =====================
 * A short, always-1-back warm-up that is deliberately kept OUTSIDE the clinical
 * exercise. It has its own fixed sequence, its own local counters, and it never
 * writes nbHits / nbMisses / nbSequence / nbCurrentIndex — so nothing here can
 * reach the session's N-Back results. The only synced values are
 * nbPracticeActive / nbPracticeIndex, which exist purely so the therapist and
 * child are looking at the same warm-up item at the same time.
 *
 * The sequence is a FIXED pattern of pool indices rather than random, so both
 * browsers derive an identical practice sequence without syncing the items.
 * Matches (1-back) land at positions 2 and 5.
 */
const PRACTICE_POOL_INDICES = [0, 1, 1, 2, 0, 0]
const PRACTICE_N = 1
const PRACTICE_STEP_MS = 2600

function buildPracticeSequence(stimulusType: StimulusType): string[] {
  let pool: string[]
  if (stimulusType === 'colors') pool = COLORS
  else if (stimulusType === 'shapes') pool = SHAPES
  else if (stimulusType === 'letters') pool = LETTERS
  else pool = Array.from({ length: 9 }, (_, i) => `pos-${i}`)
  return PRACTICE_POOL_INDICES.map((i) => pool[i % pool.length])
}

function formatPosition(pos: string): { row: number; col: number } {
  const idx = parseInt(pos.replace('pos-', ''), 10)
  return { row: Math.floor(idx / 3), col: idx % 3 }
}

/* ── Presentation-only building blocks ─────────────────────────────────────── */

/** Renders one stimulus item, whatever the category, at a caller-given size. */
function Stimulus({ item, type, size }: { item: string; type: StimulusType; size: number | string }) {
  if (type === 'position') {
    const { row, col } = formatPosition(item)
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, 1fr)',
          gap: '9%',
          width: size,
          height: size,
        }}
      >
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            style={{
              borderRadius: '18%',
              background: row * 3 + col === i ? POS_ON : POS_OFF,
              transition: 'background 0.15s',
            }}
          />
        ))}
      </div>
    )
  }
  const art = type === 'letters' ? letterArt(item) : null
  if (art) {
    return <div role="img" aria-label={item} style={{ width: size, height: size, ...art }} />
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `calc(${typeof size === 'number' ? `${size}px` : size} * 0.72)`,
        lineHeight: 1,
      }}
    >
      {item}
    </div>
  )
}

/** Segmented pill group — white text only ever lands on the solid indigo fill. */
function PillGroup({
  options,
  value,
  onSelect,
  disabled,
}: {
  options: { key: string; label: string }[]
  value: string
  onSelect: (key: string) => void
  disabled: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 2, background: TRACK, borderRadius: 999, padding: 3 }}>
      {options.map((o) => {
        const on = value === o.key
        return (
          <button
            key={o.key}
            type="button"
            disabled={disabled}
            onClick={() => { if (!disabled) onSelect(o.key) }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '6px 7px',
              borderRadius: 999,
              border: 'none',
              cursor: disabled ? 'default' : 'pointer',
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              background: on ? INDIGO : 'transparent',
              color: on ? '#ffffff' : INK_MUTED,
              boxShadow: on ? '0 2px 6px rgba(40,32,150,0.24)' : 'none',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Plays the delivered match Lottie once over the stimulus card. */
function MatchFlash() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let anim: { destroy: () => void } | null = null
    let cancelled = false
    import('lottie-web')
      .then(({ default: lottie }) => {
        if (cancelled || !host.current) return
        anim = lottie.loadAnimation({
          container: host.current,
          renderer: 'svg',
          loop: false,
          autoplay: true,
          path: ART_MATCH_FX,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      anim?.destroy()
    }
  }, [])
  return <div ref={host} aria-hidden style={{ position: 'absolute', inset: '-18%', pointerEvents: 'none', zIndex: 6 }} />
}

export default function NBackChallenge({ sessionId, role, isLocked }: NBackChallengeProps) {
  const isTherapist = role === 'therapist'
  const canInteract = isTherapist || !isLocked

  const [n, setN] = useState(1)
  const [stimulusType, setStimulusType] = useState<StimulusType>('colors')
  const [speed, setSpeed] = useState(2000)
  const [seqLength, setSeqLength] = useState(15)
  const [isPlaying, setIsPlaying] = useState(false)
  const [sequence, setSequence] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [hits, setHits] = useState(0)
  const [misses, setMisses] = useState(0)
  const [feedback, setFeedback] = useState<{ type: 'correct' | 'wrong' | 'missed'; text: string } | null>(null)
  const [complete, setComplete] = useState(false)
  const [animKey, setAnimKey] = useState(0)
  // Local-only flash counter so the Lottie remounts on every caught match.
  const [flashKey, setFlashKey] = useState(0)
  /* Indices the responder has already answered, shared through Firestore.
     Without it the therapist's timer counted a miss for EVERY match as it
     scrolled past — including ones the client had just caught — so a correct
     answer scored a hit and a miss at once and a perfect round read as 50%
     accuracy. It also drives the "Missed!" flash, which used to fire on top of
     "Correct!" for the same stimulus. */
  const [responded, setResponded] = useState<number[]>([])

  /* Practice-round state. practiceActive/practiceIdx mirror the two non-clinical
     Firestore fields; the score and feedback stay local and are never persisted. */
  const [practiceActive, setPracticeActive] = useState(false)
  const [practiceIdx, setPracticeIdx] = useState(-1)
  const [practiceHits, setPracticeHits] = useState(0)
  const [practiceTapped, setPracticeTapped] = useState<number[]>([])
  const [practiceFeedback, setPracticeFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const practiceTimer = useRef<ReturnType<typeof setInterval>>()
  const practiceFbTimer = useRef<ReturnType<typeof setTimeout>>()

  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const gameRef = useRef({ isPlaying, sequence, currentIndex, n, hits, misses, responded })
  gameRef.current = { isPlaying, sequence, currentIndex, n, hits, misses, responded }

  /* Match chime — a side effect of the existing hit path only. */
  const pingRef = useRef<HTMLAudioElement | null>(null)
  const playPing = useCallback(() => {
    try {
      if (typeof window === 'undefined') return
      if (!pingRef.current) {
        const a = new Audio(ART_PING)
        a.volume = 0.5
        pingRef.current = a
      }
      pingRef.current.currentTime = 0
      pingRef.current.play()?.catch(() => {})
    } catch { /* audio is decorative */ }
  }, [])
  useEffect(() => () => { try { pingRef.current?.pause() } catch { /* noop */ } }, [])

  /* Miss cue. The delivered asset folder has match-ping.wav but no miss sound,
     so this is synthesised rather than shipped: a short low tone falling from
     approximately 320Hz to 160Hz. Deliberately quieter and softer-edged than
     the hit ping — the child is meant to notice a miss, not be startled by it. */
  const missCtxRef = useRef<AudioContext | null>(null)
  const playMiss = useCallback(() => {
    try {
      if (typeof window === 'undefined') return
      const Ctor = window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      if (!missCtxRef.current) missCtxRef.current = new Ctor()
      const ctx = missCtxRef.current
      // Browsers start the context suspended until a gesture; a miss can land
      // without one, so resume defensively and give up quietly if refused.
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      const t = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(320, t)
      osc.frequency.exponentialRampToValueAtTime(160, t + 0.28)
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.32)
    } catch { /* audio is decorative */ }
  }, [])
  useEffect(() => () => { try { missCtxRef.current?.close() } catch { /* noop */ } }, [])

  const writeToFirestore = useCallback(async (data: Record<string, unknown>) => {
    try {
      await updateDoc(doc(db, 'liveSessions', sessionId), {
        ...data,
        'timestamps.updatedAt': new Date().toISOString(),
      })
    } catch (err) {
      console.warn('[NBackChallenge] Firestore write failed', err)
    }
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      const s = data.moduleState || {}
      if (typeof s.nbN === 'number') setN(s.nbN)
      if (typeof s.nbStimulusType === 'string') setStimulusType(s.nbStimulusType as StimulusType)
      if (typeof s.nbSpeed === 'number') setSpeed(s.nbSpeed)
      if (typeof s.nbLength === 'number') setSeqLength(s.nbLength)
      if (typeof s.nbIsPlaying === 'boolean') setIsPlaying(s.nbIsPlaying)
      if (Array.isArray(s.nbSequence)) setSequence(s.nbSequence)
      if (typeof s.nbCurrentIndex === 'number') {
        setCurrentIndex(s.nbCurrentIndex)
        setAnimKey((k) => k + 1)
      }
      if (typeof s.nbHits === 'number') setHits(s.nbHits)
      if (typeof s.nbMisses === 'number') setMisses(s.nbMisses)
      if (Array.isArray(s.nbResponded)) setResponded(s.nbResponded as number[])
      // Non-clinical warm-up coordination only.
      if (typeof s.nbPracticeActive === 'boolean') setPracticeActive(s.nbPracticeActive)
      if (typeof s.nbPracticeIndex === 'number') setPracticeIdx(s.nbPracticeIndex)
    })
    return () => unsub()
  }, [sessionId])

  // Therapist drives the timer
  useEffect(() => {
    if (!isTherapist || !isPlaying || sequence.length === 0 || currentIndex >= sequence.length) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
      }
      return
    }

    timerRef.current = setInterval(() => {
      const { sequence, currentIndex, n } = gameRef.current
      const nextIdx = currentIndex + 1

      if (nextIdx >= sequence.length) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
        writeToFirestore({
          'moduleState.nbIsPlaying': false,
          'moduleState.nbCurrentIndex': sequence.length,
        })
        return
      }

      // Charge a miss only for a match that scrolled past UNANSWERED. Answered
      // indices were already scored by handleMatchPress, so counting them here
      // too is what made every correct answer also a miss.
      const { misses: m, responded } = gameRef.current
      const wasMatch = currentIndex >= n && sequence[currentIndex] === sequence[currentIndex - n]
      if (wasMatch && !responded.includes(currentIndex)) {
        writeToFirestore({
          'moduleState.nbCurrentIndex': nextIdx,
          'moduleState.nbMisses': m + 1,
        })
      } else {
        writeToFirestore({ 'moduleState.nbCurrentIndex': nextIdx })
      }
    }, speed)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isTherapist, isPlaying, sequence, currentIndex, speed, writeToFirestore])

  // Detect completion
  useEffect(() => {
    if (currentIndex >= sequence.length && sequence.length > 0) {
      setComplete(true)
    } else {
      setComplete(false)
    }
  }, [currentIndex, sequence.length])

  // Client missed-match detection. Skips indices the client answered — this
  // used to flash "Missed!" over the top of "✓ Correct!" for the same
  // stimulus, which is what made a caught match look like a failed one.
  useEffect(() => {
    if (isTherapist || currentIndex < n || currentIndex > sequence.length) return
    const prevIdx = currentIndex - 1
    if (prevIdx < n || responded.includes(prevIdx)) return
    if (sequence[prevIdx] === sequence[prevIdx - n]) {
      setFeedback({ type: 'missed', text: 'Missed!' })
      playMiss()
      setTimeout(() => setFeedback(null), 800)
    }
  }, [currentIndex, n, sequence, isTherapist, responded, playMiss])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const practiceSequence = buildPracticeSequence(stimulusType)
  const practiceItem = practiceIdx >= 0 && practiceIdx < practiceSequence.length ? practiceSequence[practiceIdx] : null
  const practiceRefItem = practiceIdx - PRACTICE_N >= 0 ? practiceSequence[practiceIdx - PRACTICE_N] : null
  const practiceFinished = practiceActive && practiceIdx >= practiceSequence.length
  const practiceIsMatch = !!practiceItem && practiceRefItem === practiceItem

  const startPractice = () => {
    if (!canInteract || isPlaying) return
    setPracticeHits(0)
    setPracticeTapped([])
    setPracticeFeedback(null)
    // Only the two warm-up fields are touched — no clinical state is written.
    writeToFirestore({ 'moduleState.nbPracticeActive': true, 'moduleState.nbPracticeIndex': 0 })
  }

  const endPractice = () => {
    if (practiceTimer.current) clearInterval(practiceTimer.current)
    writeToFirestore({ 'moduleState.nbPracticeActive': false, 'moduleState.nbPracticeIndex': -1 })
    setPracticeFeedback(null)
  }

  // Therapist advances the warm-up, mirroring how the real exercise is driven.
  useEffect(() => {
    if (!isTherapist || !practiceActive || practiceIdx < 0 || practiceIdx >= practiceSequence.length) {
      if (practiceTimer.current) {
        clearInterval(practiceTimer.current)
        practiceTimer.current = undefined
      }
      return
    }
    practiceTimer.current = setInterval(() => {
      setPracticeIdx((prev) => {
        const next = prev + 1
        writeToFirestore({ 'moduleState.nbPracticeIndex': next })
        return next
      })
    }, PRACTICE_STEP_MS)
    return () => {
      if (practiceTimer.current) {
        clearInterval(practiceTimer.current)
        practiceTimer.current = undefined
      }
    }
  }, [isTherapist, practiceActive, practiceIdx, practiceSequence.length, writeToFirestore])

  useEffect(() => () => {
    if (practiceTimer.current) clearInterval(practiceTimer.current)
    if (practiceFbTimer.current) clearTimeout(practiceFbTimer.current)
  }, [])

  const handlePracticePress = () => {
    if (!canInteract || !practiceItem || practiceTapped.includes(practiceIdx)) return
    setPracticeTapped((prev) => [...prev, practiceIdx])
    if (practiceIsMatch) {
      setPracticeHits((h) => h + 1)
      setPracticeFeedback({ ok: true, text: "Yes! That one came back — nice spotting." })
      playPing()
      setFlashKey((k) => k + 1)
    } else {
      setPracticeFeedback({ ok: false, text: "Not this one — keep watching, you'll see a repeat soon." })
    }
    if (practiceFbTimer.current) clearTimeout(practiceFbTimer.current)
    practiceFbTimer.current = setTimeout(() => setPracticeFeedback(null), 1600)
  }

  const handleMatchPress = () => {
    if (!canInteract || !isPlaying || currentIndex < n || complete) return

    const { sequence, currentIndex: ci, hits, misses, responded } = gameRef.current
    // One response per stimulus. Without this a second tap on the same item
    // scored twice, and the optimistic local update below would drift.
    if (responded.includes(ci)) return
    const isMatch = sequence[ci] === sequence[ci - n]
    const nextResponded = [...responded, ci]
    // Applied locally as well as written, so the timer's miss check sees the
    // response even if it ticks before the Firestore round trip lands.
    setResponded(nextResponded)

    if (isMatch) {
      setFeedback({ type: 'correct', text: '✓ Correct!' })
      setTimeout(() => setFeedback(null), 800)
      playPing()
      setFlashKey((k) => k + 1)
      writeToFirestore({
        'moduleState.nbHits': hits + 1,
        'moduleState.nbResponded': nextResponded,
      })
    } else {
      // A false alarm still costs a miss, so it gets the miss cue too.
      setFeedback({ type: 'wrong', text: '✗ Not a match' })
      playMiss()
      setTimeout(() => setFeedback(null), 800)
      writeToFirestore({
        'moduleState.nbMisses': misses + 1,
        'moduleState.nbResponded': nextResponded,
      })
    }
  }

  // Spacebar handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isPlaying && currentIndex >= n && !complete) {
        e.preventDefault()
        handleMatchPress()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTherapist, isPlaying, complete])

  const handleStart = () => {
    if (!isTherapist) return
    const seq = generateSequence(n, stimulusType, seqLength)
    setSequence(seq)
    setCurrentIndex(0)
    setHits(0)
    setMisses(0)
    setResponded([])
    setComplete(false)
    setFeedback(null)
    setAnimKey((k) => k + 1)

    writeToFirestore({
      'moduleState.nbIsPlaying': true,
      'moduleState.nbSequence': seq,
      'moduleState.nbCurrentIndex': 0,
      'moduleState.nbHits': 0,
      'moduleState.nbMisses': 0,
      'moduleState.nbResponded': [],
      // The warm-up never overlaps the real exercise.
      'moduleState.nbPracticeActive': false,
      'moduleState.nbPracticeIndex': -1,
    })
  }

  const handlePause = () => {
    if (!isTherapist) return
    if (timerRef.current) clearInterval(timerRef.current)
    writeToFirestore({ 'moduleState.nbIsPlaying': false })
  }

  const handleReset = () => {
    if (!isTherapist) return
    if (timerRef.current) clearInterval(timerRef.current)
    setSequence([])
    setCurrentIndex(-1)
    setHits(0)
    setMisses(0)
    setResponded([])
    setComplete(false)
    setFeedback(null)
    writeToFirestore({
      'moduleState.nbIsPlaying': false,
      'moduleState.nbSequence': [],
      'moduleState.nbCurrentIndex': -1,
      'moduleState.nbHits': 0,
      'moduleState.nbMisses': 0,
      'moduleState.nbResponded': [],
    })
  }

  const handleNChange = (val: number) => {
    setN(val)
    writeToFirestore({ 'moduleState.nbN': val })
  }

  const handleStimulusTypeChange = (val: StimulusType) => {
    setStimulusType(val)
    writeToFirestore({ 'moduleState.nbStimulusType': val })
  }

  const handleSpeedChange = (ms: number) => {
    setSpeed(ms)
    writeToFirestore({ 'moduleState.nbSpeed': ms })
  }

  const handleLengthChange = (len: number) => {
    setSeqLength(len)
    writeToFirestore({ 'moduleState.nbLength': len })
  }

  const currentStimulus = currentIndex >= 0 && currentIndex < sequence.length ? sequence[currentIndex] : null
  const isMatchable = currentIndex >= n && isPlaying

  const stimTypeLabel = { colors: 'Colors', shapes: 'Shapes', letters: 'Letters', position: 'Position' }[stimulusType]
  const accuracy = hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0

  // Log the working-memory result once per completed run (therapist browser only).
  const loggedDoneRef = useRef(false)
  useEffect(() => {
    if (complete && isTherapist && !loggedDoneRef.current) {
      loggedDoneRef.current = true
      logModuleEvent(sessionId, {
        module: 'n-back-challenge',
        type: 'completed',
        detail: `Completed a ${n}-back working-memory round (${stimTypeLabel}) with ${accuracy}% accuracy (${hits} hits, ${misses} misses)`,
      })
    }
    if (!complete) loggedDoneRef.current = false
  }, [complete, isTherapist, sessionId, n, stimTypeLabel, accuracy, hits, misses])

  const handleTryAgain = () => {
    handleStart()
  }

  const handleIncreaseN = () => {
    if (n < 3) {
      handleNChange(n + 1)
    }
    handleStart()
  }

  /* ── Derived presentation values (no new state, no new Firestore fields) ─── */
  const settingsDisabled = !isTherapist
  const progressPct = sequence.length > 0
    ? Math.max(0, Math.min(100, Math.round((Math.min(currentIndex, sequence.length) / sequence.length) * 100)))
    : 0
  const secondsLabel = speed % 1000 === 0 ? `${speed / 1000} sec` : `${(speed / 1000).toFixed(1)} sec`

  // Worked example for the HOW TO PLAY card: n + 2 tiles drawn from the live
  // pool, where the last one repeats the tile n places earlier.
  const examplePool = poolFor(stimulusType)
  const exampleTiles: string[] = []
  for (let i = 0; i < n + 2; i++) {
    exampleTiles.push(i === n + 1 ? exampleTiles[i - n] : examplePool[i % examplePool.length])
  }
  const exampleTileSize = n >= 3 ? 36 : n === 2 ? 44 : 52

  const tapEnabled = canInteract && isMatchable && isPlaying && !complete

  const HOW_TO_STEPS = [
    { icon: '👀', tint: '#EEF0FE', title: 'Watch', body: 'A symbol appears one at a time.' },
    { icon: '🧠', tint: '#FDECF3', title: 'Remember', body: `Compare the current symbol with the one shown ${n === 1 ? 'just before it' : `${n} turns earlier`}.` },
    { icon: '👆', tint: '#FFF4E5', title: 'Tap', body: `Tap when the current symbol is the same as ${n === 1 ? 'the previous one (nothing in between)' : `${n} turns ago`}.` },
  ]

  return (
    <>
      <style>{`
        @keyframes nbStimulusIn {
          0%   { transform: scale(0.7); opacity: 0 }
          70%  { transform: scale(1.06); opacity: 1 }
          100% { transform: scale(1);   opacity: 1 }
        }
        @keyframes nbPop {
          0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0 }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1 }
        }
      `}</style>

      {/* Root fills the stage and never scrolls itself — ModuleStage's body is
          overflow:hidden and expects `height:100%` with internal flex:1 regions.
          Every glyph sits as dark ink on white or pale violet; white text only
          appears on the solid indigo fills. */}
      <div
        style={{
          height: '100%',
          minHeight: 0,
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column',
          color: INK,
          userSelect: 'none',
        }}
      >
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', gap: 12 }}>

          {/* ── LEFT: How to play ─────────────────────────────────────────── */}
          <div
            style={{
              ...card,
              flexShrink: 0,
              width: 262,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
              padding: '12px 13px 13px',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  background: INDIGO,
                  color: '#ffffff',
                  borderRadius: 999,
                  padding: '6px 18px',
                  fontSize: 15.5,
                  fontWeight: 800,
                  letterSpacing: 0.9,
                  boxShadow: '0 4px 12px rgba(40,32,150,0.28)',
                  whiteSpace: 'nowrap',
                }}
              >
                ✦ HOW TO PLAY ✦
              </div>
            </div>

            {HOW_TO_STEPS.map((s, i) => (
              <div
                key={s.title}
                style={{
                  display: 'flex',
                  gap: 9,
                  alignItems: 'flex-start',
                  paddingBottom: i < 2 ? 9 : 0,
                  borderBottom: i < 2 ? `1px solid ${BORDER}` : 'none',
                }}
              >
                <div
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 34,
                    height: 34,
                    borderRadius: 11,
                    background: s.tint,
                    border: `1px solid ${BORDER}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20.5,
                  }}
                >
                  {s.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 19,
                        height: 19,
                        borderRadius: '50%',
                        background: INDIGO,
                        color: '#ffffff',
                        fontSize: 13,
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 16.5, fontWeight: 800, color: INDIGO }}>{s.title}</span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.45, color: INK_BODY }}>{s.body}</div>
                </div>
              </div>
            ))}

            <div style={{ ...microLabel, marginTop: 1 }}>Example ({n}-Back)</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
              {exampleTiles.map((t, i) => {
                const isMatchTile = i === exampleTiles.length - 1
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <span aria-hidden style={{ fontSize: 14, color: INK_MUTED }}>→</span>}
                    <div
                      style={{
                        width: exampleTileSize,
                        height: exampleTileSize,
                        borderRadius: 11,
                        background: isMatchTile ? GREEN_SOFT : '#ffffff',
                        border: isMatchTile ? `2px solid ${GREEN}` : `1px solid ${BORDER}`,
                        boxShadow: '0 2px 6px rgba(20,30,40,0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Stimulus item={t} type={stimulusType} size={exampleTileSize - 14} />
                    </div>
                  </div>
                )
              })}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 10px',
                borderRadius: 12,
                background: GREEN_SOFT,
                border: `1px solid #BBF0CD`,
                fontSize: 16.5,
                fontWeight: 800,
                color: '#0F7A38',
              }}
            >
              <span aria-hidden>✨</span> MATCH! <span aria-hidden style={{ color: INK_MUTED }}>→</span> Tap
            </div>

            {!practiceActive && !isPlaying && !complete && (
              <button
                type="button"
                onClick={startPractice}
                disabled={!canInteract}
                style={{
                  marginTop: 'auto',
                  width: '100%',
                  padding: '8px 0',
                  borderRadius: 11,
                  border: `1px solid ${BORDER}`,
                  background: SURFACE,
                  color: VIOLET,
                  fontSize: 15.5,
                  fontWeight: 700,
                  cursor: canInteract ? 'pointer' : 'default',
                  opacity: canInteract ? 1 : 0.5,
                }}
              >
                Practice first — doesn&apos;t count
              </button>
            )}
          </div>

          {/* ── CENTRE: settings row + stimulus stage ─────────────────────── */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Settings row */}
            <div style={{ flexShrink: 0, display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
              {/* Cards keep a content-sized floor so a narrow stage wraps the row
                  instead of clipping the pill labels. */}
              <div style={{ ...card, flex: '1 1 250px', minWidth: 250, padding: '7px 10px 9px' }}>
                <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 800, color: INDIGO, marginBottom: 5 }}>Category</div>
                <PillGroup
                  value={stimulusType}
                  disabled={settingsDisabled}
                  options={[
                    { key: 'colors', label: 'Colors' },
                    { key: 'shapes', label: 'Shapes' },
                    { key: 'letters', label: 'Letters' },
                    { key: 'position', label: 'Position' },
                  ]}
                  onSelect={(v) => handleStimulusTypeChange(v as StimulusType)}
                />
              </div>

              <div style={{ ...card, flex: '1 1 165px', minWidth: 165, padding: '7px 10px 9px' }}>
                <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 800, color: INDIGO, marginBottom: 5 }}>Speed</div>
                <PillGroup
                  value={String(speed)}
                  disabled={settingsDisabled}
                  options={[
                    { key: '3000', label: 'Slow' },
                    { key: '2000', label: 'Normal' },
                    { key: '1200', label: 'Fast' },
                  ]}
                  onSelect={(v) => handleSpeedChange(Number(v))}
                />
              </div>

              <div style={{ ...card, flex: '1 1 235px', minWidth: 235, padding: '7px 10px 9px' }}>
                <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 800, color: INDIGO, marginBottom: 5 }}>Sequence Length</div>
                <PillGroup
                  value={String(seqLength)}
                  disabled={settingsDisabled}
                  options={[
                    { key: '10', label: 'Short (10)' },
                    { key: '15', label: 'Medium (15)' },
                    { key: '20', label: 'Long (20)' },
                  ]}
                  onSelect={(v) => handleLengthChange(Number(v))}
                />
              </div>
            </div>

            {/* Stimulus stage */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                position: 'relative',
                borderRadius: 20,
                background: SURFACE,
                border: '1px solid #E6E1FA',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                padding: '14px 16px',
                overflow: 'hidden',
              }}
            >
              {/* n-Back badge */}
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 12,
                  padding: '3px 11px',
                  borderRadius: 999,
                  background: '#ffffff',
                  border: `1px solid ${BORDER}`,
                  fontSize: 13.5,
                  fontWeight: 800,
                  color: VIOLET,
                  letterSpacing: 0.3,
                }}
              >
                {n}-Back · {stimTypeLabel}
              </div>

              {!canInteract && (
                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 12,
                    fontSize: 13,
                    fontWeight: 700,
                    color: INK_MUTED,
                  }}
                >
                  Therapist is controlling
                </div>
              )}

              {/* ---- Session complete ---- */}
              {complete ? (
                <div
                  style={{
                    ...card,
                    borderRadius: 20,
                    padding: '20px 26px',
                    textAlign: 'center',
                    maxWidth: 340,
                  }}
                >
                  <div style={{ fontSize: 21, fontWeight: 800, color: INDIGO, marginBottom: 4 }}>Session Complete!</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: INK_MUTED, marginBottom: 14 }}>
                    {n}-Back · {stimTypeLabel} · {seqLength} items
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 25.5, fontWeight: 800, color: GREEN }}>{hits}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: INK_MUTED }}>Hits</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 25.5, fontWeight: 800, color: RED }}>{misses}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: INK_MUTED }}>Misses</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 25.5, fontWeight: 800, color: INDIGO }}>{accuracy}%</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: INK_MUTED }}>Accuracy</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 16.5, fontWeight: 700, color: INK_BODY, marginBottom: isTherapist ? 14 : 0 }}>
                    {accuracy >= 70 ? 'Well done! 🎉' : 'Keep practising 💪'}
                  </div>
                  {isTherapist && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                      <button
                        type="button"
                        onClick={handleTryAgain}
                        style={{
                          padding: '8px 18px',
                          borderRadius: 999,
                          border: 'none',
                          cursor: 'pointer',
                          background: INDIGO,
                          color: '#ffffff',
                          fontSize: 16,
                          fontWeight: 800,
                          boxShadow: '0 4px 12px rgba(40,32,150,0.26)',
                        }}
                      >
                        Try Again
                      </button>
                      {n < 3 && (
                        <button
                          type="button"
                          onClick={handleIncreaseN}
                          style={{
                            padding: '8px 18px',
                            borderRadius: 999,
                            border: `1px solid ${BORDER}`,
                            cursor: 'pointer',
                            background: '#ffffff',
                            color: VIOLET,
                            fontSize: 16,
                            fontWeight: 800,
                          }}
                        >
                          Increase N ({n + 1}-Back)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Practice ribbon */}
                  {practiceActive && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        padding: '4px 13px',
                        borderRadius: 999,
                        background: '#FFF6E3',
                        border: '1px solid #F3D79A',
                        color: '#8A5A06',
                        fontSize: 13.5,
                        fontWeight: 800,
                        letterSpacing: 0.3,
                        whiteSpace: 'nowrap',
                        zIndex: 8,
                      }}
                    >
                      Practice round · 1-Back · does not count
                    </div>
                  )}

                  {/* ---- Card stack ---- */}
                  <div
                    style={{
                      position: 'relative',
                      height: 'clamp(132px, 23vh, 216px)',
                      aspectRatio: '1',
                      maxWidth: '100%',
                      flexShrink: 0,
                    }}
                  >
                    {[3, 2, 1].map((i) => (
                      <div
                        key={i}
                        aria-hidden
                        style={{
                          position: 'absolute',
                          inset: 0,
                          borderRadius: 22,
                          background: '#ffffff',
                          border: `1px solid ${BORDER}`,
                          boxShadow: '0 5px 14px rgba(35,25,90,0.06)',
                          transform: `translate(${i * 7}px, ${i * 5}px)`,
                          zIndex: 1,
                        }}
                      />
                    ))}
                    <div
                      style={{
                        position: 'relative',
                        zIndex: 4,
                        width: '100%',
                        height: '100%',
                        borderRadius: 22,
                        background: '#ffffff',
                        border: practiceActive ? '2px solid #F3D79A' : `1px solid ${BORDER}`,
                        boxShadow: '0 10px 26px rgba(35,25,90,0.10)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      {practiceActive ? (
                        practiceFinished ? (
                          <div style={{ textAlign: 'center', padding: 12 }}>
                            <div style={{ fontSize: 17.5, fontWeight: 800, color: '#8A5A06', marginBottom: 4 }}>
                              Practice done
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: INK_BODY }}>
                              You spotted {practiceHits} of 2
                            </div>
                          </div>
                        ) : practiceItem ? (
                          <div key={practiceIdx} style={{ animation: 'nbStimulusIn 0.3s ease' }}>
                            <Stimulus item={practiceItem} type={stimulusType} size="clamp(78px, 14vh, 130px)" />
                          </div>
                        ) : (
                          <span style={{ fontSize: 16, fontWeight: 700, color: INK_MUTED }}>Get ready…</span>
                        )
                      ) : currentStimulus ? (
                        <div key={animKey} style={{ animation: 'nbStimulusIn 0.3s ease' }}>
                          <Stimulus item={currentStimulus} type={stimulusType} size="clamp(78px, 14vh, 130px)" />
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: 14 }}>
                          <div style={{ fontSize: 16.5, fontWeight: 800, color: VIOLET, marginBottom: 3 }}>
                            {isPlaying ? 'Get ready…' : `${n}-Back`}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: INK_MUTED, lineHeight: 1.4 }}>
                            {isTherapist ? 'Configure and press Start' : 'Waiting for your therapist…'}
                          </div>
                        </div>
                      )}

                      {(feedback?.type === 'correct' || (practiceActive && practiceFeedback?.ok)) && (
                        <MatchFlash key={flashKey} />
                      )}
                    </div>
                  </div>

                  {/* ---- Tap bar ---- */}
                  <div style={{ width: '100%', maxWidth: 430, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={practiceActive ? handlePracticePress : handleMatchPress}
                      disabled={
                        practiceActive
                          ? !canInteract || !practiceItem || practiceTapped.includes(practiceIdx)
                          : !tapEnabled
                      }
                      style={{
                        width: '100%',
                        height: 58,
                        borderRadius: 16,
                        background: '#ffffff',
                        border:
                          feedback?.type === 'correct'
                            ? `2px solid ${GREEN}`
                            : feedback?.type === 'wrong'
                              ? `2px solid ${RED}`
                              : `1px solid ${BORDER}`,
                        boxShadow: CARD_SHADOW,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        padding: '0 16px',
                        cursor:
                          (practiceActive ? canInteract && !!practiceItem : tapEnabled) ? 'pointer' : 'default',
                        opacity: (practiceActive ? canInteract && !!practiceItem : tapEnabled) ? 1 : 0.62,
                        transition: 'border-color 0.15s, opacity 0.15s',
                      }}
                    >
                      <span aria-hidden style={{ fontSize: 25.5, lineHeight: 1 }}>✋</span>
                      <span
                        style={{
                          fontSize: 23.5,
                          fontWeight: 800,
                          color:
                            feedback?.type === 'correct'
                              ? '#0F7A38'
                              : feedback?.type === 'wrong'
                                ? '#A8123A'
                                : INK,
                        }}
                      >
                        {feedback ? feedback.text : practiceActive || isMatchable ? 'Tap' : 'Watch and wait…'}
                      </span>
                      <span
                        style={{
                          marginLeft: 'auto',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '6px 12px',
                          borderRadius: 999,
                          background: INDIGO_SOFT,
                          color: VIOLET,
                          fontSize: 16,
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span aria-hidden>⏱</span>
                        {practiceActive ? '2.6 sec' : secondsLabel}
                      </span>
                    </button>

                    {practiceActive && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 14,
                            fontWeight: 600,
                            lineHeight: 1.4,
                            color: practiceFeedback ? (practiceFeedback.ok ? '#0F7A38' : '#A8123A') : INK_MUTED,
                          }}
                        >
                          {practiceFinished
                            ? practiceHits >= 2
                              ? 'You have got it — the real round works exactly the same way.'
                              : 'That is fine — the real round works the same way, and there is no rush.'
                            : practiceFeedback
                              ? practiceFeedback.text
                              : practiceRefItem
                                ? 'Tap if this is the same as the one right before it.'
                                : 'First one — nothing to compare with yet.'}
                        </div>
                        {practiceFinished ? (
                          <>
                            <button
                              type="button"
                              onClick={startPractice}
                              style={{
                                flexShrink: 0, padding: '6px 13px', borderRadius: 999,
                                border: `1px solid ${BORDER}`, background: '#ffffff',
                                color: INK_BODY, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                              }}
                            >
                              Practice again
                            </button>
                            <button
                              type="button"
                              onClick={endPractice}
                              style={{
                                flexShrink: 0, padding: '6px 13px', borderRadius: 999, border: 'none',
                                background: INDIGO, color: '#ffffff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                              }}
                            >
                              I&apos;m ready
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={endPractice}
                            style={{
                              flexShrink: 0, padding: '6px 13px', borderRadius: 999,
                              border: `1px solid ${BORDER}`, background: '#ffffff',
                              color: INK_MUTED, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                            }}
                          >
                            Skip practice
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── RIGHT: transport + performance ────────────────────────────── */}
          <div style={{ flexShrink: 0, width: 246, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>

            {isTherapist && (
              <>
                <div style={{ ...card, flexShrink: 0, padding: '7px 10px 9px' }}>
                  <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 800, color: INDIGO, marginBottom: 5 }}>N-Level</div>
                  <PillGroup
                    value={String(n)}
                    disabled={false}
                    options={[
                      { key: '1', label: '1-Back' },
                      { key: '2', label: '2-Back' },
                      { key: '3', label: '3-Back' },
                    ]}
                    onSelect={(v) => handleNChange(Number(v))}
                  />
                </div>

                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {isPlaying ? (
                    <button
                      type="button"
                      onClick={handlePause}
                      style={{
                        width: '100%',
                        padding: '12px 0',
                        borderRadius: 14,
                        border: `1px solid ${BORDER}`,
                        background: '#ffffff',
                        color: '#8A5A06',
                        fontSize: 17.5,
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: CARD_SHADOW,
                      }}
                    >
                      ⏸ Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStart}
                      disabled={complete}
                      style={{
                        width: '100%',
                        padding: '12px 0',
                        borderRadius: 14,
                        border: 'none',
                        background: `linear-gradient(180deg, ${INDIGO}, ${INDIGO_DEEP})`,
                        color: '#ffffff',
                        fontSize: 18.5,
                        fontWeight: 800,
                        cursor: complete ? 'default' : 'pointer',
                        opacity: complete ? 0.45 : 1,
                        boxShadow: '0 6px 16px rgba(40,32,150,0.30)',
                      }}
                    >
                      ▶ Start
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleReset}
                    style={{
                      width: '100%',
                      padding: '11px 0',
                      borderRadius: 14,
                      border: `1px solid ${BORDER}`,
                      background: '#ffffff',
                      color: INK_BODY,
                      fontSize: 17,
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: CARD_SHADOW,
                    }}
                  >
                    ↻ Reset
                  </button>
                </div>
              </>
            )}

            {/* Performance */}
            <div
              style={{
                ...card,
                flex: 1,
                minHeight: 0,
                borderRadius: 18,
                padding: '11px 12px 13px',
                display: 'flex',
                flexDirection: 'column',
                gap: 11,
              }}
            >
              <div style={{ textAlign: 'center', fontSize: 15.5, fontWeight: 800, letterSpacing: 0.8, color: INDIGO, textTransform: 'uppercase' }}>
                Your Performance
              </div>

              <div style={{ display: 'flex', gap: 7 }}>
                {[
                  { icon: ART_HITS, alt: 'Hits', value: String(hits), label: 'Hits', bg: GREEN_SOFT, ink: GREEN, border: '#CDEFDB' },
                  { icon: ART_MISSES, alt: 'Misses', value: String(misses), label: 'Misses', bg: RED_SOFT, ink: RED, border: '#F7D3DC' },
                  { icon: ART_ACCURACY, alt: 'Accuracy', value: `${accuracy}%`, label: 'Accuracy', bg: INDIGO_SOFT, ink: INDIGO, border: '#D8DBFB' },
                ].map((t) => (
                  <div
                    key={t.label}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: t.bg,
                      border: `1px solid ${t.border}`,
                      borderRadius: 14,
                      padding: '10px 4px 9px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <img src={t.icon} alt="" aria-hidden width={26} height={26} style={{ display: 'block' }} />
                    <div style={{ fontSize: 23.5, fontWeight: 800, color: t.ink, lineHeight: 1.1 }}>{t.value}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: t.ink }}>{t.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 'auto' }}>
                <div style={{ ...microLabel, marginBottom: 7 }}>Session Progress</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 9,
                      borderRadius: 999,
                      background: '#EBE7FB',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${progressPct}%`,
                        height: '100%',
                        borderRadius: 999,
                        background: 'linear-gradient(90deg, #7C5CF0, #5B34E8)',
                        transition: 'width 0.35s cubic-bezier(.4,0,.2,1)',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 17.5, fontWeight: 800, color: INDIGO, flexShrink: 0 }}>{progressPct}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
