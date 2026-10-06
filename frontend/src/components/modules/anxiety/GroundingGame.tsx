'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { Check, Clock, Sparkles } from 'lucide-react'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'

interface GroundingGameProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

const STEPS = [
  { sense: 'SEE', emoji: '👁️', count: 5, prompt: 'Name 5 things you can see right now', placeholder: 'I can see...' },
  { sense: 'TOUCH', emoji: '🤚', count: 4, prompt: 'Name 4 things you can touch or feel', placeholder: 'I can touch...' },
  { sense: 'HEAR', emoji: '👂', count: 3, prompt: 'Name 3 things you can hear', placeholder: 'I can hear...' },
  { sense: 'SMELL', emoji: '👃', count: 2, prompt: 'Name 2 things you can smell', placeholder: 'I can smell...' },
  { sense: 'TASTE', emoji: '👅', count: 1, prompt: 'Name 1 thing you can taste', placeholder: 'I can taste...' },
] as const

const MOODS = [
  { emoji: '😌', label: 'Calm' },
  { emoji: '😊', label: 'Good' },
  { emoji: '😐', label: 'Okay' },
  { emoji: '😟', label: 'Worried' },
  { emoji: '😰', label: 'Anxious' },
]

const BREATH_OPTIONS = [
  { label: 'Slow', value: 6000 },
  { label: 'Normal', value: 4000 },
  { label: 'Fast', value: 2500 },
]

/* ---------------------------------------------------------------------------
   Art assets. The delivered folder names contain spaces, so each path segment
   is encoded and the files are referenced with a plain <img> (next/image can't
   take these paths) — the same approach WorryVault uses.
--------------------------------------------------------------------------- */
const A = (f: string) =>
  `/assets/modules/${encodeURIComponent('Anxiety and depression')}/${encodeURIComponent('Asset Grounding')}/${encodeURIComponent(f)}`

const ART_RING = A('progress_ring.svg')
const ART_BADGE = A('focus_explorer_badge.svg')
const ART_STEP_FX = A('STAAD_Grounding_Step_Complete_FX.json')

/* No "touch" icon shipped in the delivered set — this flat orange hand stands
   in for it so the sense row reads consistently. Swap the data URI for the real
   asset the moment design supplies one.

   Redrawn: the previous version sat in a 160x200 box while the art only used
   x 17-128 / y 22-176, so at the 27px it actually renders the hand came out
   small and off-centre, and its thumb was rotated INTO the palm — it read as a
   detached fifth finger. This one fills a square viewBox and the thumb angles
   out of the palm, so it stays legible down to the 15px used in the recap row. */
const TOUCH_HAND_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
  `<g fill="#F2762A">` +
  `<rect x="20" y="46" width="60" height="44" rx="20"/>` +
  `<rect x="24" y="20" width="13" height="44" rx="6.5"/>` +
  `<rect x="39" y="12" width="13" height="52" rx="6.5"/>` +
  `<rect x="54" y="15" width="13" height="49" rx="6.5"/>` +
  `<rect x="69" y="24" width="13" height="40" rx="6.5"/>` +
  `<rect x="8" y="44" width="13" height="40" rx="6.5" transform="rotate(-32 14.5 64)"/>` +
  `</g>` +
  `<g fill="none" stroke="#D95F16" stroke-width="4" stroke-linecap="round" opacity="0.32">` +
  `<path d="M38 68 h26"/><path d="M42 79 h18"/>` +
  `</g></svg>`
const ART_TOUCH = `data:image/svg+xml,${encodeURIComponent(TOUCH_HAND_SVG)}`

/* Confetti strip for the celebration banner — pure decoration. */
const CONFETTI_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80">` +
  [
    [12, 18, 8, '#F6B93B', 22], [34, 52, 7, '#7C4DE0', -18], [58, 12, 6, '#3FAE6A', 40],
    [74, 44, 8, '#EF6E7B', 12], [96, 24, 6, '#4F86EA', -34], [112, 62, 7, '#F6B93B', 28],
    [132, 16, 8, '#3FAE6A', -12], [150, 48, 6, '#7C4DE0', 44], [168, 26, 7, '#EF6E7B', -26],
    [188, 58, 6, '#4F86EA', 18], [204, 14, 8, '#F6B93B', -40], [222, 40, 6, '#3FAE6A', 30],
    [46, 30, 5, '#4F86EA', 8], [86, 66, 5, '#F6B93B', -22], [180, 8, 5, '#7C4DE0', 36],
  ]
    .map(([x, y, s, c, r]) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="1.5" fill="${c}" transform="rotate(${r} ${x} ${y})" opacity="0.85"/>`)
    .join('') +
  `</svg>`
const ART_CONFETTI = `data:image/svg+xml,${encodeURIComponent(CONFETTI_SVG)}`

/* Per-sense presentation. Index-aligned with STEPS — presentation only, the
   exercise data model above is untouched. */
const SENSE_UI = [
  { label: 'See',   icon: A('grounding_sense_eye.svg'),            tint: '#E8F7F0', ring: '#BFE9D8', ink: '#0E9F7B' },
  { label: 'Touch', icon: ART_TOUCH,                                tint: '#FFF1E5', ring: '#FBD3B0', ink: '#DD6A1E' },
  { label: 'Hear',  icon: A('hear_ear_icon.svg'),                   tint: '#F2ECFE', ring: '#DCCCFA', ink: '#7040D8' },
  { label: 'Smell', icon: A('smell_nose_icon.svg'),                 tint: '#FFECEC', ring: '#FBCFCF', ink: '#DC4E55' },
  { label: 'Taste', icon: A('taste_tongue_icon_reference.svg'),     tint: '#E8F0FE', ring: '#C6D9FB', ink: '#1257E8' },
] as const

/* Palette — dark ink on the white ModuleStage canvas. */
const GREEN = '#3fae6a'
const GREEN_DEEP = '#2F7D5F'
const INK = '#1b2a24'
const INK_BODY = '#34423b'
const BORDER = '#e7eaef'
const CARD_SHADOW = '0 1px 2px rgba(20,40,30,0.04), 0 6px 18px rgba(20,40,30,0.05)'

const RING_R = 112
const RING_C = 2 * Math.PI * RING_R

function initializeItems(existing?: string[][]): string[][] {
  const result: string[][] = []
  for (let i = 0; i < 5; i++) {
    const count = STEPS[i].count
    const prev = existing?.[i] || []
    result.push(Array.from({ length: count }, (_, j) => prev[j] || ''))
  }
  return result
}

/** Plays the delivered step-complete Lottie once, while mounted. */
function StepCompleteFx() {
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
          path: ART_STEP_FX,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      anim?.destroy()
    }
  }, [])
  return <div ref={host} aria-hidden style={{ position: 'absolute', inset: '-8%', pointerEvents: 'none', zIndex: 4 }} />
}

/** Gold star medallion for the celebration banner. */
function StarBadge({ size = 46 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="32" cy="32" r="30" fill="#FFF7E2" stroke="#F4C33D" strokeWidth="2" />
      <circle cx="32" cy="32" r="23" fill="#F9C council" />
      <circle cx="32" cy="32" r="23" fill="#F8C63C" />
      <path
        d="M32 15 l5.2 10.9 12 1.6 -8.8 8.3 2.2 11.9 -10.6 -5.8 -10.6 5.8 2.2 -11.9 -8.8 -8.3 12 -1.6 Z"
        fill="#FFF8D2"
        stroke="#D98C00"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function GroundingGame({ sessionId, role, isLocked }: GroundingGameProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [currentStep, setCurrentStep] = useState(0)
  const [items, setItems] = useState<string[][]>(() => initializeItems())
  const [breathPace, setBreathPace] = useState(4000)
  const [startMood, setStartMood] = useState('')
  const [endMood, setEndMood] = useState('')
  const [completed, setCompleted] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [captureStartMood, setCaptureStartMood] = useState(false)
  const [canAdvance, setCanAdvance] = useState(false)
  const [expandedStep, setExpandedStep] = useState<number | null>(null)
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const [skipMode, setSkipMode] = useState(false)

  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const writeToFirestore = useCallback(async (data: Record<string, unknown>) => {
    try {
      await updateDoc(doc(db, 'liveSessions', sessionId), {
        ...data,
        'timestamps.updatedAt': new Date().toISOString(),
      })
    } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (typeof s.ggCurrentStep === 'number') setCurrentStep(s.ggCurrentStep)
      if (Array.isArray(s.ggItems)) setItems(initializeItems(s.ggItems as string[][]))
      if (typeof s.ggBreathPace === 'number') setBreathPace(s.ggBreathPace)
      if (typeof s.ggStartMood === 'string') setStartMood(s.ggStartMood)
      if (typeof s.ggEndMood === 'string') setEndMood(s.ggEndMood)
      if (typeof s.ggCompleted === 'boolean') {
        setCompleted(s.ggCompleted)
        if (s.ggCompleted) setCaptureStartMood(false)
      }
      if (typeof s.ggCaptureStartMood === 'boolean') setCaptureStartMood(s.ggCaptureStartMood)
    })
    return () => unsub()
  }, [sessionId])

  const stepItems = items[currentStep] || []
  const filledCount = stepItems.filter(s => s.trim()).length
  const step = STEPS[currentStep]
  const allFilled = stepItems.length === step.count && stepItems.every(s => s.trim())

  useEffect(() => {
    setCanAdvance(allFilled && !transitioning)
  }, [allFilled, transitioning])

  useEffect(() => {
    if (!transitioning && !skipMode) {
      const t = setTimeout(() => inputRefs.current[0]?.focus(), 80)
      return () => clearTimeout(t)
    }
    setSkipMode(false)
  }, [currentStep, transitioning])

  useEffect(() => {
    return () => {}
  }, [])

  const handleItemChange = (slotIdx: number, value: string) => {
    if (!canInteract || completed || transitioning || captureStartMood) return
    const newItems = items.map(arr => [...arr])
    newItems[currentStep][slotIdx] = value
    setItems(newItems)
    writeToFirestore({ 'moduleState.ggItems': newItems })
  }

  const handleItemKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, slotIdx: number) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const cur = items[currentStep]
      for (let i = slotIdx + 1; i < cur.length; i++) {
        if (!cur[i].trim()) {
          inputRefs.current[i]?.focus()
          return
        }
      }
    }
  }

  const advanceStep = () => {
    if (!canAdvance && !skipMode) return
    if (transitioning) return

    setTransitioning(true)
    setTimeout(() => {
      if (currentStep < 4) {
        const next = currentStep + 1
        setCurrentStep(next)
        writeToFirestore({ 'moduleState.ggCurrentStep': next })
        setTimeout(() => setTransitioning(false), 100)
      } else {
        setCompleted(true)
        writeToFirestore({ 'moduleState.ggCompleted': true })
        logModuleEvent(sessionId, {
          module: 'grounding-game',
          type: 'completed',
          detail: `Completed the 5-4-3-2-1 grounding exercise (named 15 things across the senses)${startMood ? `, having started feeling "${startMood}"` : ''}`,
        })
        setTimeout(() => setTransitioning(false), 100)
      }
    }, 800)
  }

  const handleSkip = () => {
    setSkipMode(true)
    advanceStep()
  }

  const handleStartMoodCapture = () => {
    writeToFirestore({ 'moduleState.ggCaptureStartMood': true })
  }

  const handleMoodSelect = (mood: string) => {
    if (captureStartMood) {
      setStartMood(mood)
      writeToFirestore({
        'moduleState.ggStartMood': mood,
        'moduleState.ggCaptureStartMood': false,
      })
    } else if (completed) {
      setEndMood(mood)
      writeToFirestore({ 'moduleState.ggEndMood': mood })
      logModuleEvent(sessionId, {
        module: 'grounding-game',
        type: 'mood_check',
        detail: `After grounding, reported feeling "${mood}"`,
      })
    }
  }

  const handleReset = () => {
    const fresh = initializeItems()
    setItems(fresh)
    setCurrentStep(0)
    setCompleted(false)
    setEndMood('')
    setExpandedStep(null)
    setCaptureStartMood(false)
    setTransitioning(false)
    writeToFirestore({
      'moduleState.ggCurrentStep': 0,
      'moduleState.ggItems': fresh,
      'moduleState.ggCompleted': false,
      'moduleState.ggEndMood': '',
      'moduleState.ggCaptureStartMood': false,
    })
  }

  const pillStyle = (active: boolean) => ({
    padding: '4px 11px',
    borderRadius: 20,
    border: `1px solid ${active ? GREEN : BORDER}`,
    background: active ? 'rgba(63,174,106,0.12)' : '#fff',
    color: active ? GREEN_DEEP : 'var(--ink-muted)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s',
  } as React.CSSProperties)

  const ghostBtn: React.CSSProperties = {
    padding: '5px 11px',
    borderRadius: 8,
    border: `1px solid ${BORDER}`,
    background: '#fff',
    color: 'var(--ink-muted)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  }

  const sense = SENSE_UI[currentStep]
  const pct = completed ? 100 : Math.round(((currentStep + 1) / 5) * 100)
  const minutesLeft = Math.max(1, (4 - currentStep) * 3)
  const arcFrac = step.count > 0 ? filledCount / step.count : 0

  /* ---- shared fragments -------------------------------------------------- */

  const progressRow = (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: INK_BODY, whiteSpace: 'nowrap' }}>
        {completed ? 'All 5 steps' : `Step ${currentStep + 1} of 5`}
      </span>
      <div style={{ flex: 1, minWidth: 40, height: 8, borderRadius: 999, background: '#eef1f4', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 999,
            background: `linear-gradient(90deg, #2FBF9A 0%, ${GREEN} 100%)`,
            transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      </div>
      <span style={{ fontSize: 16, fontWeight: 700, color: GREEN_DEEP, whiteSpace: 'nowrap' }}>{pct}% Complete</span>
      <span
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 11px', borderRadius: 999,
          border: `1px solid ${BORDER}`, background: '#f7f9fb',
          fontSize: 14, fontWeight: 600, color: 'var(--ink-muted)', whiteSpace: 'nowrap',
        }}
      >
        <Clock size={12} strokeWidth={2.4} />
        {completed ? 'Complete' : `${minutesLeft} min left`}
      </span>
    </div>
  )

  const senseRow = (
    <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', gap: 'clamp(10px, 2.4vw, 26px)' }}>
      {SENSE_UI.map((s, i) => {
        const active = i === currentStep && !completed
        const done = completed || i < currentStep
        return (
          <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div
              style={{
                position: 'relative',
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: s.tint,
                border: `1.5px solid ${active ? GREEN : s.ring}`,
                boxShadow: active
                  ? `0 0 0 3.5px rgba(63,174,106,0.22), 0 5px 14px rgba(20,40,30,0.10)`
                  : '0 1px 3px rgba(20,40,30,0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: active || done ? 1 : 0.62,
                transition: 'all 0.25s ease',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.icon} alt="" aria-hidden style={{ width: 27, height: 27, objectFit: 'contain', display: 'block' }} />
              {done && !active && (
                <span
                  style={{
                    position: 'absolute', right: -1, bottom: -1,
                    width: 18, height: 18, borderRadius: '50%',
                    background: GREEN, border: '2px solid #fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Check size={9} strokeWidth={4} color="#fff" />
                </span>
              )}
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: s.ink, opacity: active || done ? 1 : 0.7 }}>
              {s.label}
            </span>
            <span
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: active ? GREEN : 'transparent',
                transition: 'background 0.25s ease',
              }}
            />
          </div>
        )
      })}
    </div>
  )

  const senseRing = (dimmed: boolean) => (
    <div
      style={{
        position: 'relative',
        height: '100%',
        maxHeight: 200,
        maxWidth: '100%',
        aspectRatio: '1 / 1',
        flexShrink: 1,
        minHeight: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={ART_RING}
        alt=""
        aria-hidden
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      {/* Live arc, drawn over the artwork's baked-in track at identical geometry. */}
      <svg viewBox="0 0 320 320" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
        <defs>
          <linearGradient id="ggArcGrad" x1="76" y1="72" x2="250" y2="258" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2FBF9A" />
            <stop offset="1" stopColor={GREEN} />
          </linearGradient>
        </defs>
        <circle cx="160" cy="160" r={RING_R} stroke="#EEF5F4" strokeWidth="17" fill="none" />
        <circle
          cx="160"
          cy="160"
          r={RING_R}
          stroke="url(#ggArcGrad)"
          strokeWidth="14"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C - RING_C * arcFrac}
          transform="rotate(-90 160 160)"
          style={{ transition: 'stroke-dashoffset 0.55s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      {/* Active sense artwork, breathing at the therapist's chosen pace. */}
      <div
        style={{
          position: 'absolute',
          inset: '22%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: `ggBreathe ${breathPace}ms ease-in-out infinite`,
          opacity: dimmed ? 0.45 : 1,
          transition: 'opacity 0.3s ease',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sense.icon}
          alt=""
          aria-hidden
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>
      {transitioning && <StepCompleteFx />}
    </div>
  )

  const completedPill = (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 16px',
        borderRadius: 999,
        border: `1px solid #DCEFE6`,
        background: '#fff',
        boxShadow: CARD_SHADOW,
        whiteSpace: 'nowrap',
      }}
    >
      <Check size={15} strokeWidth={3.2} color={GREEN} />
      <span style={{ fontSize: 18.5, fontWeight: 800, color: INK }}>{filledCount}</span>
      <span style={{ fontSize: 17.5, fontWeight: 600, color: 'var(--ink-faint)' }}>/</span>
      <span style={{ fontSize: 18.5, fontWeight: 800, color: INK }}>{step.count}</span>
      <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-muted)' }}>completed</span>
    </div>
  )

  const achievementBanner = (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 16px',
        borderRadius: 16,
        border: '1px solid #E4EFE4',
        background: 'linear-gradient(100deg, #EEF9F1 0%, #F6FBF2 45%, #FEF7E8 100%)',
        boxShadow: CARD_SHADOW,
        overflow: 'hidden',
      }}
    >
      <StarBadge />
      <span style={{ fontSize: 16.5, fontWeight: 700, color: '#2b3b33', lineHeight: 1.4, maxWidth: 240 }}>
        Great job! You&apos;re becoming more aware of your surroundings.
      </span>
      <div
        aria-hidden
        style={{
          flex: 1,
          minWidth: 0,
          height: 46,
          backgroundImage: `url("${ART_CONFETTI}")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          backgroundSize: 'contain',
        }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={ART_BADGE}
        alt="Achievement unlocked: Focus Explorer"
        style={{ height: 62, width: 'auto', display: 'block', flexShrink: 0 }}
      />
    </div>
  )

  /* ---- render ------------------------------------------------------------ */

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: 12,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes ggBreathe {
          0%,100% { transform: scale(1); }
          50% { transform: scale(1.07); }
        }
        @keyframes ggPromptIn {
          0% { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .gg-input::placeholder { color: #a7b0b8; font-weight: 500; }
        .gg-scroll { scrollbar-width: thin; scrollbar-color: #d7dde3 transparent; }
        .gg-scroll::-webkit-scrollbar { width: 6px; }
        .gg-scroll::-webkit-scrollbar-thumb { background: #d7dde3; border-radius: 999px; }
      `}</style>

      {/* ---- Start-mood capture takes over the body ---- */}
      {captureStartMood && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <div style={{ fontSize: 23.5, fontWeight: 800, color: INK, letterSpacing: -0.3 }}>
            How are you feeling right now?
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {MOODS.map(m => {
              const on = startMood === m.label
              return (
                <button
                  key={m.label}
                  onClick={() => handleMoodSelect(m.label)}
                  disabled={!canInteract}
                  style={{
                    width: 74, height: 78, borderRadius: 16,
                    border: `1.5px solid ${on ? GREEN : BORDER}`,
                    background: on ? 'rgba(63,174,106,0.10)' : '#fff',
                    boxShadow: CARD_SHADOW,
                    cursor: canInteract ? 'pointer' : 'not-allowed',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
                    fontSize: 31.5, transition: 'all 0.15s',
                  }}
                >
                  <span>{m.emoji}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: on ? GREEN_DEEP : INK_BODY }}>{m.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ---- Active exercise ---- */}
      {!completed && !captureStartMood && (
        <>
          {progressRow}
          {senseRow}

          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 20, alignItems: 'stretch' }}>
            {/* LEFT — progress ring + tally */}
            <div
              style={{
                width: 'clamp(150px, 24%, 220px)',
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                minHeight: 0,
              }}
            >
              {senseRing(transitioning)}
              {completedPill}
            </div>

            {/* RIGHT — prompt, encouragement, numbered slots */}
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div
                key={currentStep}
                style={{
                  flexShrink: 0,
                  fontSize: 'clamp(17px, 2.1vw, 24px)',
                  fontWeight: 800,
                  letterSpacing: -0.4,
                  lineHeight: 1.22,
                  color: INK,
                  animation: transitioning ? 'none' : 'ggPromptIn 0.4s ease',
                }}
              >
                {step.prompt}
              </div>

              <div
                style={{
                  flexShrink: 0,
                  alignSelf: 'flex-start',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  borderRadius: 999,
                  border: '1px solid #CFEBDB',
                  background: 'rgba(63,174,106,0.10)',
                  fontSize: 16,
                  fontWeight: 700,
                  color: GREEN_DEEP,
                }}
              >
                <Sparkles size={13} strokeWidth={2.4} />
                You&apos;re doing great!
              </div>

              <div
                className="gg-scroll"
                style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7, paddingRight: 3 }}
              >
                {stepItems.map((item, idx) => {
                  const focused = focusedIdx === idx
                  const filled = !!item.trim()
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          height: 38,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 9,
                          padding: '0 12px 0 6px',
                          borderRadius: 11,
                          border: `1px solid ${focused ? GREEN : filled ? '#CFEBDB' : BORDER}`,
                          background: '#fff',
                          boxShadow: focused ? `0 0 0 3px rgba(63,174,106,0.14)` : CARD_SHADOW,
                          transition: 'all 0.18s ease',
                        }}
                      >
                        <span
                          style={{
                            width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                            background: sense.tint,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={sense.icon} alt="" aria-hidden style={{ width: 16, height: 16, objectFit: 'contain', display: 'block' }} />
                        </span>
                        <input
                          className="gg-input"
                          ref={el => { inputRefs.current[idx] = el }}
                          type="text"
                          value={item}
                          onChange={e => handleItemChange(idx, e.target.value)}
                          onKeyDown={e => handleItemKeyDown(e, idx)}
                          onFocus={() => setFocusedIdx(idx)}
                          onBlur={() => setFocusedIdx(null)}
                          placeholder={step.placeholder}
                          readOnly={!canInteract || transitioning}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            height: '100%',
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            color: INK,
                            fontSize: 16.5,
                            fontWeight: 600,
                            padding: 0,
                          }}
                        />
                      </div>
                      <span
                        style={{
                          width: 40, height: 38, flexShrink: 0,
                          borderRadius: 11,
                          border: `1px solid ${filled ? '#CFEBDB' : BORDER}`,
                          background: filled ? 'rgba(63,174,106,0.10)' : '#f7f9fb',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 16.5, fontWeight: 700,
                          color: filled ? GREEN_DEEP : 'var(--ink-muted)',
                          transition: 'all 0.18s ease',
                        }}
                      >
                        {idx + 1}
                      </span>
                    </div>
                  )
                })}
              </div>

              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, minHeight: 30 }}>
                {!canInteract && (
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-muted)' }}>
                    Therapist is guiding
                  </span>
                )}
                <div style={{ flex: 1 }} />
                {canAdvance && (
                  <button
                    onClick={advanceStep}
                    style={{
                      padding: '9px 20px',
                      borderRadius: 11,
                      border: 'none',
                      background: `linear-gradient(180deg, #47bd74 0%, ${GREEN} 100%)`,
                      color: '#fff',
                      fontSize: 16.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(63,174,106,0.30)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {currentStep < 4 ? 'Next sense →' : 'Finish ✨'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {achievementBanner}
        </>
      )}

      {/* ---- Completion ---- */}
      {completed && (
        <div className="gg-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingRight: 3 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ART_BADGE}
            alt="Achievement unlocked: Focus Explorer"
            style={{ height: 128, width: 'auto', display: 'block', flexShrink: 0 }}
          />
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 24.5, fontWeight: 800, color: INK, letterSpacing: -0.4 }}>You did it 🌱</div>
            <div style={{ fontSize: 16.5, fontWeight: 600, color: 'var(--ink-muted)', marginTop: 3 }}>
              You named 15 things around you
            </div>
          </div>

          {/* Summary accordion */}
          <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
            {STEPS.map((s, i) => {
              const list = items[i].filter(x => x.trim())
              const isExpanded = expandedStep === i
              const ui = SENSE_UI[i]
              return (
                <div
                  key={i}
                  style={{
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    background: '#fff',
                    boxShadow: CARD_SHADOW,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => setExpandedStep(isExpanded ? null : i)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      background: 'transparent',
                      border: 'none',
                      color: INK_BODY,
                      fontSize: 16,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                    }}
                  >
                    <span
                      style={{
                        width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                        background: ui.tint,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ui.icon} alt="" aria-hidden style={{ width: 15, height: 15, objectFit: 'contain', display: 'block' }} />
                    </span>
                    <span>{s.count} things I {s.sense.toLowerCase()}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 17.5, color: 'var(--ink-muted)', fontWeight: 700 }}>{isExpanded ? '−' : '+'}</span>
                  </button>
                  {isExpanded && (
                    <div style={{ padding: '2px 14px 10px 47px', fontSize: 16, color: INK_BODY, lineHeight: 1.75 }}>
                      {list.length > 0 ? list.map((x, j) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <Check size={12} strokeWidth={3} color={GREEN} />
                          {x}
                        </div>
                      )) : <span style={{ fontStyle: 'italic', color: 'var(--ink-muted)' }}>No items entered</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* End mood */}
          <div style={{ textAlign: 'center', width: '100%', flexShrink: 0 }}>
            <div style={{ fontSize: 16.5, fontWeight: 700, color: INK_BODY, marginBottom: 9 }}>
              How do you feel now?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {MOODS.map(m => {
                const on = endMood === m.label
                return (
                  <button
                    key={m.label}
                    onClick={() => handleMoodSelect(m.label)}
                    disabled={!canInteract}
                    style={{
                      width: 64, height: 68, borderRadius: 14,
                      border: `1.5px solid ${on ? GREEN : BORDER}`,
                      background: on ? 'rgba(63,174,106,0.10)' : '#fff',
                      boxShadow: CARD_SHADOW,
                      cursor: canInteract ? 'pointer' : 'not-allowed',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                      fontSize: 27, transition: 'all 0.15s',
                    }}
                  >
                    <span>{m.emoji}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: on ? GREEN_DEEP : INK_BODY }}>{m.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <button
            onClick={handleReset}
            style={{
              flexShrink: 0,
              marginTop: 2,
              padding: '9px 22px',
              borderRadius: 11,
              border: 'none',
              background: `linear-gradient(180deg, #47bd74 0%, ${GREEN} 100%)`,
              color: '#fff',
              fontSize: 16.5,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(63,174,106,0.30)',
            }}
          >
            Start again
          </button>
        </div>
      )}

      {/* ---- Therapist controls ---- */}
      {isT && !completed && !captureStartMood && (
        <div
          style={{
            flexShrink: 0,
            paddingTop: 9,
            borderTop: `1px solid ${BORDER}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-muted)' }}>
            Step {currentStep + 1} of 5 · {filledCount}/{step.count} items entered
          </span>
          <span style={{ width: 1, height: 12, background: BORDER }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-faint)' }}>Breath</span>
          {BREATH_OPTIONS.map(b => (
            <button
              key={b.value}
              onClick={() => {
                setBreathPace(b.value)
                writeToFirestore({ 'moduleState.ggBreathPace': b.value })
              }}
              style={pillStyle(breathPace === b.value)}
            >
              {b.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {!startMood && (
            <button onClick={handleStartMoodCapture} style={ghostBtn}>
              Capture start mood
            </button>
          )}
          {startMood && (
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-muted)' }}>Mood: {startMood}</span>
          )}
          <button onClick={handleSkip} style={ghostBtn}>
            Skip to next step →
          </button>
        </div>
      )}
    </div>
  )
}
