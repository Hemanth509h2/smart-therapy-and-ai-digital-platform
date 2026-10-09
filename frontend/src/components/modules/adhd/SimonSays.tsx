'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { staadCancel } from '@/lib/voice/staadVoice'

/* ── Art assets ─────────────────────────────────────────────────────────────── */
const SS_ASSET = (file: string) =>
  `/assets/modules/ADHD/${encodeURIComponent('Simon says Assets')}/${encodeURIComponent(file)}`

const HEART_FILLED = SS_ASSET('heart-filled.svg')
const HEART_EMPTY = SS_ASSET('heart-empty.svg')

interface SimonSaysProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

interface Command { text: string; emoji: string; hasSimonSays: boolean }

const COMMAND_ACTIONS: { text: string; emoji: string }[] = [
  { text: 'Clap your hands', emoji: '👏' },
  { text: 'Touch your nose', emoji: '👃' },
  { text: 'Stand up', emoji: '🧍' },
  { text: 'Wave hello', emoji: '👋' },
  { text: 'Jump once', emoji: '🦘' },
  { text: 'Blink slowly', emoji: '👁️' },
  { text: 'Nod your head', emoji: '🙂' },
  { text: 'Tap your knees', emoji: '🦵' },
  { text: 'Smile big', emoji: '😁' },
  { text: 'Take a deep breath', emoji: '🌬️' },
  { text: 'Point to the sky', emoji: '☝️' },
  { text: 'Shake your hands', emoji: '🤲' },
]

const BUTTONS = ['green', 'red', 'yellow', 'blue'] as const
type PadColor = typeof BUTTONS[number]

/* Harmonious, soothing chime frequencies (A-major chord: E4, A4, C#5, E5) */
const TONE_FREQS: Record<string, number> = {
  green: 329.63,  // E4  - Calm Forest green
  red: 440.00,    // A4  - Warm Coral ruby
  yellow: 554.37, // C#5 - Sunny Golden bell
  blue: 659.25,   // E5  - Uplifting Sky sapphire
}

/* Sensory-friendly, rich, delightful 3D pad aesthetics */
const PAD_THEMES: Record<PadColor, {
  name: string
  note: string        // Musical note symbol shown on pad
  noteLabel: string   // Short label shown below note
  idleGradient: string
  litGradient: string
  idleBorder: string
  litBorder: string
  idleShadow: string
  litShadow: string
  glowColor: string
}> = {
  green: {
    name: 'Green',
    note: '♩',
    noteLabel: 'DO',
    idleGradient: 'linear-gradient(145deg, #10b981 0%, #059669 60%, #047857 100%)',
    litGradient: 'linear-gradient(145deg, #a7f3d0 0%, #34d399 45%, #10b981 100%)',
    idleBorder: '#6ee7b7',
    litBorder: '#ffffff',
    idleShadow: '0 8px 18px rgba(4, 120, 87, 0.35), inset 0 2px 4px rgba(255,255,255,0.4)',
    litShadow: '0 0 55px 16px rgba(52, 211, 153, 0.95), 0 20px 40px rgba(5, 150, 105, 0.5), inset 0 2px 10px rgba(255,255,255,0.95)',
    glowColor: 'rgba(52, 211, 153, 0.95)',
  },
  red: {
    name: 'Red',
    note: '♪',
    noteLabel: 'RE',
    idleGradient: 'linear-gradient(145deg, #f87171 0%, #ef4444 60%, #dc2626 100%)',
    litGradient: 'linear-gradient(145deg, #fecaca 0%, #f87171 45%, #ef4444 100%)',
    idleBorder: '#fca5a5',
    litBorder: '#ffffff',
    idleShadow: '0 8px 18px rgba(220, 38, 38, 0.35), inset 0 2px 4px rgba(255,255,255,0.4)',
    litShadow: '0 0 55px 16px rgba(248, 113, 113, 0.95), 0 20px 40px rgba(220, 38, 38, 0.5), inset 0 2px 10px rgba(255,255,255,0.95)',
    glowColor: 'rgba(248, 113, 113, 0.95)',
  },
  yellow: {
    name: 'Yellow',
    note: '♫',
    noteLabel: 'MI',
    idleGradient: 'linear-gradient(145deg, #fbbf24 0%, #f59e0b 60%, #d97706 100%)',
    litGradient: 'linear-gradient(145deg, #fef08a 0%, #fbbf24 45%, #f59e0b 100%)',
    idleBorder: '#fde68a',
    litBorder: '#ffffff',
    idleShadow: '0 8px 18px rgba(217, 119, 6, 0.35), inset 0 2px 4px rgba(255,255,255,0.4)',
    litShadow: '0 0 55px 16px rgba(251, 191, 36, 0.95), 0 20px 40px rgba(217, 119, 6, 0.5), inset 0 2px 10px rgba(255,255,255,0.95)',
    glowColor: 'rgba(251, 191, 36, 0.95)',
  },
  blue: {
    name: 'Blue',
    note: '♬',
    noteLabel: 'FA',
    idleGradient: 'linear-gradient(145deg, #60a5fa 0%, #3b82f6 60%, #2563eb 100%)',
    litGradient: 'linear-gradient(145deg, #bfdbfe 0%, #60a5fa 45%, #3b82f6 100%)',
    idleBorder: '#93c5fd',
    litBorder: '#ffffff',
    idleShadow: '0 8px 18px rgba(37, 99, 235, 0.35), inset 0 2px 4px rgba(255,255,255,0.4)',
    litShadow: '0 0 55px 16px rgba(96, 165, 250, 0.95), 0 20px 40px rgba(37, 99, 235, 0.5), inset 0 2px 10px rgba(255,255,255,0.95)',
    glowColor: 'rgba(96, 165, 250, 0.95)',
  },
}

/* Design Tokens */
const INK = '#2c293d'
const INK_MUTED = '#645f78'
const VIOLET = '#5B21B6'
const VIOLET_MID = '#7C3AED'
const CARD_BORDER = '#E7E2F8'
const CARD_SHADOW = '0 6px 18px rgba(91, 33, 182, 0.06)'

const card: React.CSSProperties = {
  background: '#ffffff',
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  padding: '8px 14px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}

const microLabel: React.CSSProperties = {
  fontSize: 13.5,
  fontWeight: 700,
  color: INK,
  letterSpacing: 0.2,
  whiteSpace: 'nowrap',
}

function genSeq(len: number): string[] {
  return Array.from({ length: len }, () => BUTTONS[Math.floor(Math.random() * 4)])
}

function genCmdList(ratio: string): Command[] {
  const trapPct = ratio === 'low' ? 0.3 : ratio === 'high' ? 0.7 : 0.5
  return Array.from({ length: 20 }, () => {
    const a = COMMAND_ACTIONS[Math.floor(Math.random() * COMMAND_ACTIONS.length)]
    return { ...a, hasSimonSays: Math.random() > trapPct }
  })
}

function starRating(n: number): string {
  if (n < 5) return '⭐'
  if (n <= 8) return '⭐⭐'
  return '⭐⭐⭐'
}

/* Segmented pill group with therapist/client access styles */
function PillGroup({
  options,
  value,
  onSelect,
  disabled,
}: {
  options: { key: string; label: string; icon?: string; fill: string }[]
  value: string
  onSelect: (key: string) => void
  disabled: boolean
}) {
  return (
    <div style={{
      display: 'flex',
      gap: 2,
      background: '#F1ECFA',
      borderRadius: 999,
      padding: 3,
      opacity: disabled ? 0.75 : 1,
    }}>
      {options.map(o => {
        const on = value === o.key
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => { if (!disabled) onSelect(o.key) }}
            disabled={disabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 12px',
              borderRadius: 999,
              border: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.2,
              background: on ? o.fill : 'transparent',
              color: on ? '#ffffff' : INK_MUTED,
              boxShadow: on ? '0 2px 6px rgba(124,58,237,0.22)' : 'none',
              transition: 'background 0.15s, color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {o.icon && <span aria-hidden style={{ fontSize: 14 }}>{o.icon}</span>}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* Decorative calming audio waveform */
function Waveform({ active }: { active: boolean }) {
  const bars = [10, 18, 28, 14, 32, 22, 34, 18, 28, 14, 20, 10]
  return (
    <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 3, height: 32, flexShrink: 0 }}>
      {bars.map((h, i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: h,
            borderRadius: 2,
            background: i % 2 ? VIOLET_MID : '#A78BFA',
            transformOrigin: 'center',
            opacity: active ? 1 : 0.35,
            animation: active ? `ssWave 900ms ease-in-out ${i * 70}ms infinite` : 'none',
          }}
        />
      ))}
    </div>
  )
}

export default function SimonSays({ sessionId, role, isLocked }: SimonSaysProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [mode, setMode] = useState<'classic' | 'simon-says'>('classic')
  const [difficulty, setDifficulty] = useState('medium')
  const [speed, setSpeed] = useState(800)
  const [startLen, setStartLen] = useState(2)
  const [cmdSpeed, setCmdSpeed] = useState(2000)
  const [trapRatio, setTrapRatio] = useState('medium')
  const [livesTotal, setLivesTotal] = useState(3)
  const [livesRem, setLivesRem] = useState(3)
  const [isPlaying, setIsPlaying] = useState(false)
  const [score, setScore] = useState(0)
  const [bestRound, setBestRound] = useState(0)
  const [seq, setSeq] = useState<string[]>([])
  const [round, setRound] = useState(1)
  const [childIn, setChildIn] = useState<string[]>([])
  const [isPlaySeq, setIsPlaySeq] = useState(false)
  const [activeLitColor, setActiveLitColor] = useState<string | null>(null)
  const [tapFlash, setTapFlash] = useState<string | null>(null)
  const tapT = useRef<ReturnType<typeof setTimeout>>()
  const [cmdIdx, setCmdIdx] = useState(-1)
  const [cmdList, setCmdList] = useState<Command[]>([])
  const [trapsAv, setTrapsAv] = useState(0)
  const [trapsHit, setTrapsHit] = useState(0)
  const [gameOver, setGameOver] = useState(false)

  const [feedback, setFeedback] = useState<{ type: 'correct' | 'wrong' | 'gold'; msg: string } | null>(null)
  const [countPct, setCountPct] = useState(100)
  const [livesAnim, setLivesAnim] = useState<Set<number>>(new Set())
  const [lastCmdIdx, setLastCmdIdx] = useState(-1)
  const [animateKey, setAnimateKey] = useState(0)
  const [toast, setToast] = useState<{ msg: string } | null>(null)

  // Sound toggle
  const [muted, setMuted] = useState(false)

  const tmr = useRef<ReturnType<typeof setInterval>>()
  const stepTimeouts = useRef<ReturnType<typeof setTimeout>[]>([])
  const toastT = useRef<ReturnType<typeof setTimeout>>()
  const fbT = useRef<ReturnType<typeof setTimeout>>()

  const write = useCallback(async (d: Record<string, unknown>) => {
    try {
      await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() })
    } catch (err) {
      console.warn('[SimonSays] Firestore write failed', err)
    }
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (s.ssMode === 'classic' || s.ssMode === 'simon-says') setMode(s.ssMode)
      if (typeof s.ssDifficulty === 'string') setDifficulty(s.ssDifficulty)
      if (typeof s.ssSpeed === 'number') setSpeed(s.ssSpeed)
      if (typeof s.ssStartLength === 'number') setStartLen(s.ssStartLength)
      if (typeof s.ssCommandSpeed === 'number') setCmdSpeed(s.ssCommandSpeed)
      if (typeof s.ssTrapRatio === 'string') setTrapRatio(s.ssTrapRatio)
      if (typeof s.ssLivesTotal === 'number') setLivesTotal(s.ssLivesTotal)
      if (typeof s.ssLivesRemaining === 'number') setLivesRem(s.ssLivesRemaining)
      if (typeof s.ssIsPlaying === 'boolean') setIsPlaying(s.ssIsPlaying)
      if (typeof s.ssScore === 'number') setScore(s.ssScore)
      if (Array.isArray(s.ssSequence)) setSeq(s.ssSequence)
      if (typeof s.ssCurrentRound === 'number') setRound(s.ssCurrentRound)
      if (Array.isArray(s.ssChildInput)) setChildIn(s.ssChildInput)
      if (typeof s.ssIsPlayingSequence === 'boolean') setIsPlaySeq(s.ssIsPlayingSequence)
      if (typeof s.ssActiveLitColor === 'string' || s.ssActiveLitColor === null) setActiveLitColor(s.ssActiveLitColor)
      if (typeof s.ssBestRound === 'number') setBestRound(s.ssBestRound)
      if (typeof s.ssCommandIndex === 'number') setCmdIdx(s.ssCommandIndex)
      if (Array.isArray(s.ssCommandList)) setCmdList(s.ssCommandList as Command[])
      if (typeof s.ssTrapsAvoided === 'number') setTrapsAv(s.ssTrapsAvoided)
      if (typeof s.ssTrapsHit === 'number') setTrapsHit(s.ssTrapsHit)
      if (typeof s.ssGameOver === 'boolean') setGameOver(s.ssGameOver)
    })
    return () => unsub()
  }, [sessionId])

  const clearAllTimeouts = useCallback(() => {
    if (tmr.current) clearInterval(tmr.current)
    stepTimeouts.current.forEach(t => clearTimeout(t))
    stepTimeouts.current = []
    if (toastT.current) clearTimeout(toastT.current)
    if (fbT.current) clearTimeout(fbT.current)
    if (tapT.current) clearTimeout(tapT.current)
  }, [])

  useEffect(() => () => {
    clearAllTimeouts()
    staadCancel()
  }, [clearAllTimeouts])

  /* ── Harmonious & Zero-Latency Audio Synthesis Engine ─────────────────── */
  // Single source: Web Audio API oscillator only — no WAV to avoid double-sound
  const audioCtxRef = useRef<AudioContext | null>(null)
  const mutedRef = useRef(false)
  useEffect(() => { mutedRef.current = muted }, [muted])

  // Plays a rich, calming Tibetan singing bell tone with fundamental + soft harmonic
  const playPadTone = useCallback((color: string, durationMs: number = 380) => {
    if (typeof window === 'undefined' || mutedRef.current || !color) return

    const durSec = Math.max(0.2, durationMs / 1000)

    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        audioCtxRef.current = new AudioCtx()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }

      const freq = TONE_FREQS[color] || 440
      const now = ctx.currentTime

      // Fundamental tone (smooth sine)
      const osc1 = ctx.createOscillator()
      const gain1 = ctx.createGain()
      osc1.type = 'sine'
      osc1.frequency.setValueAtTime(freq, now)

      // Soft upper octave overtone for crystal clarity
      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.type = 'sine'
      osc2.frequency.setValueAtTime(freq * 2, now)

      // Soothing bell volume envelope (instant attack + exponential decay)
      gain1.gain.setValueAtTime(0.001, now)
      gain1.gain.exponentialRampToValueAtTime(0.36, now + 0.015)
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + durSec)

      gain2.gain.setValueAtTime(0.001, now)
      gain2.gain.exponentialRampToValueAtTime(0.08, now + 0.015)
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + durSec * 0.7)

      osc1.connect(gain1)
      gain1.connect(ctx.destination)

      osc2.connect(gain2)
      gain2.connect(ctx.destination)

      osc1.start(now)
      osc2.start(now)
      osc1.stop(now + durSec + 0.05)
      osc2.stop(now + durSec + 0.05)
    } catch {}
  }, [])

  const playSuccessChime = useCallback(() => {
    if (typeof window === 'undefined' || mutedRef.current) return
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        audioCtxRef.current = new AudioCtx()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})

      // Harmonious ascending arpeggio (C5, E5, G5, C6)
      const notes = [523.25, 659.25, 783.99, 1046.5]
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const t = ctx.currentTime + idx * 0.08

        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, t)
        gain.gain.setValueAtTime(0.01, t)
        gain.gain.exponentialRampToValueAtTime(0.24, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)

        osc.connect(gain)
        gain.connect(ctx.destination)

        osc.start(t)
        osc.stop(t + 0.38)
      })
    } catch {}
  }, [])

  const playGentleRetryTone = useCallback(() => {
    if (typeof window === 'undefined' || mutedRef.current) return
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        audioCtxRef.current = new AudioCtx()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})

      // Soft, calming double-tone instead of harsh buzzer
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(320, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.28)

      gain.gain.setValueAtTime(0.18, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.32)
    } catch {}
  }, [])

  // Sync audio with Simon's demonstration sequence
  useEffect(() => {
    if (activeLitColor) {
      playPadTone(activeLitColor, Math.max(280, Math.floor(speed * 0.6)))
    }
  }, [activeLitColor, playPadTone, speed])

  useEffect(() => () => {
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close() } catch {}
    }
  }, [])

  const showFeedback = useCallback((type: 'correct' | 'wrong' | 'gold', msg: string) => {
    setFeedback({ type, msg })
    if (fbT.current) clearTimeout(fbT.current)
    fbT.current = setTimeout(() => setFeedback(null), 1200)
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast({ msg })
    if (toastT.current) clearTimeout(toastT.current)
    toastT.current = setTimeout(() => setToast(null), 200)
  }, [])

  // --- Classic Mode Sequence Flow with Clear Pop-Up Gaps ---
  const newRound = useCallback((s: string[], r: number) => {
    clearAllTimeouts()

    write({
      'moduleState.ssSequence': s,
      'moduleState.ssCurrentRound': r,
      'moduleState.ssChildInput': [],
      'moduleState.ssIsPlayingSequence': true,
      'moduleState.ssActiveLitColor': null,
    })
    setActiveLitColor(null)

    // Play each step with an active "lit & pop" window and a distinct "rest" gap
    // so repeated consecutive colors visibly pop up, drop down, and pop up again!
    const stepDuration = speed
    const onDuration = Math.max(280, Math.floor(stepDuration * 0.65))

    s.forEach((color, idx) => {
      const startTime = (idx + 1) * stepDuration

      // Turn ON, Elevate 3D Pop & Play Tone
      const onTimeout = setTimeout(() => {
        setActiveLitColor(color)
        write({ 'moduleState.ssActiveLitColor': color })
      }, startTime)
      stepTimeouts.current.push(onTimeout)

      // Turn OFF & Settle down (gap before next note)
      const offTimeout = setTimeout(() => {
        setActiveLitColor(null)
        write({ 'moduleState.ssActiveLitColor': null })
      }, startTime + onDuration)
      stepTimeouts.current.push(offTimeout)
    })

    // Finished sequence demonstration
    const finishTime = (s.length + 1) * stepDuration + 200
    const endTimeout = setTimeout(() => {
      setActiveLitColor(null)
      write({
        'moduleState.ssActiveLitColor': null,
        'moduleState.ssIsPlayingSequence': false,
      })
    }, finishTime)
    stepTimeouts.current.push(endTimeout)
  }, [speed, write, clearAllTimeouts])

  const startClassic = useCallback(() => {
    if (!isT) return
    const s = genSeq(startLen)
    setGameOver(false)
    setScore(0)
    setLivesRem(livesTotal)
    newRound(s, 1)
  }, [isT, startLen, livesTotal, newRound])

  const handleClassicTap = useCallback((color: string) => {
    if (!canInteract || isPlaySeq || gameOver || !isPlaying) return

    // Immediately trigger zero-latency tone & visual pop-up
    playPadTone(color, 280)
    setTapFlash(color)
    if (tapT.current) clearTimeout(tapT.current)
    tapT.current = setTimeout(() => setTapFlash(null), 280)

    const next = [...childIn, color]
    const idx = next.length - 1
    const isCorrect = next[idx] === seq[idx]

    if (!isCorrect) {
      playGentleRetryTone()
      const nl = livesRem - 1
      setLivesAnim(prev => new Set(prev).add(livesRem - 1))
      setTimeout(() => setLivesAnim(prev => { const n = new Set(prev); n.delete(livesRem - 1); return n }), 450)
      showFeedback('wrong', 'Gentle try! Let\'s watch again 🌸')
      showToast('Take a breath 💛')
      write({ 'moduleState.ssLivesRemaining': nl, 'moduleState.ssChildInput': next })
      if (nl <= 0) {
        clearAllTimeouts()
        const b = Math.max(bestRound, round)
        write({ 'moduleState.ssGameOver': true, 'moduleState.ssBestRound': b, 'moduleState.ssIsPlaying': false })
        return
      }
      setTimeout(() => newRound(seq, round), 1200)
      return
    }

    if (next.length === seq.length) {
      playSuccessChime()
      const ns = score + 1
      showFeedback('correct', '✨ Beautiful Memory! Next Round!')
      showToast('Awesome! 🎉')
      const nr = round + 1
      const b = Math.max(bestRound, nr)
      const newSeq = [...seq, BUTTONS[Math.floor(Math.random() * 4)]]
      write({ 'moduleState.ssScore': ns, 'moduleState.ssCurrentRound': nr, 'moduleState.ssChildInput': next, 'moduleState.ssBestRound': b })
      setTimeout(() => newRound(newSeq, nr), 1250)
      return
    }

    write({ 'moduleState.ssChildInput': next })
  }, [canInteract, isPlaySeq, gameOver, isPlaying, childIn, seq, livesRem, score, bestRound, round, write, showFeedback, showToast, clearAllTimeouts, newRound, playSuccessChime, playGentleRetryTone, playPadTone])

  // --- Simon Says Mode ---
  const startSimonSays = useCallback(() => {
    if (!isT) return
    const list = genCmdList(trapRatio)
    setGameOver(false)
    setScore(0)
    setLivesRem(livesTotal)
    setTrapsAv(0)
    setTrapsHit(0)
    write({
      'moduleState.ssCommandList': list,
      'moduleState.ssCommandIndex': 0,
      'moduleState.ssScore': 0,
      'moduleState.ssLivesRemaining': livesTotal,
      'moduleState.ssTrapsAvoided': 0,
      'moduleState.ssTrapsHit': 0,
      'moduleState.ssGameOver': false,
    })
    let i = 0
    tmr.current = setInterval(() => {
      i++
      if (i >= list.length) {
        clearInterval(tmr.current!); tmr.current = undefined
        write({ 'moduleState.ssIsPlaying': false })
        return
      }
      write({ 'moduleState.ssCommandIndex': i })
    }, cmdSpeed)
  }, [isT, trapRatio, livesTotal, cmdSpeed, write])

  const currentCmd = cmdIdx >= 0 && cmdIdx < cmdList.length ? cmdList[cmdIdx] : null

  // Countdown bar
  useEffect(() => {
    if (mode !== 'simon-says' || cmdIdx < 0 || !isPlaying || gameOver) return
    if (cmdIdx !== lastCmdIdx) {
      setLastCmdIdx(cmdIdx)
      setAnimateKey(prev => prev + 1)
      setCountPct(100)
      const raf = requestAnimationFrame(() => {
        setCountPct(0)
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [cmdIdx, mode, isPlaying, gameOver, lastCmdIdx])

  const handleSimonRespond = useCallback((doIt: boolean) => {
    if (!canInteract || !currentCmd || gameOver || !isPlaying) return
    const shouldDoIt = currentCmd.hasSimonSays
    if (doIt === shouldDoIt) {
      playSuccessChime()
      const ns = score + 1
      let nta = trapsAv
      if (!shouldDoIt) nta = trapsAv + 1
      const type = doIt && shouldDoIt ? 'correct' : 'gold'
      const msg = doIt && shouldDoIt ? '✓ Great focus!' : 'Super self-control! 🌟'
      if (type === 'gold') setTrapsAv(nta)
      showFeedback(type, msg)
      showToast(msg)
      write({ 'moduleState.ssScore': ns, 'moduleState.ssTrapsAvoided': nta })
    } else {
      playGentleRetryTone()
      const nl = livesRem - 1
      setLivesAnim(prev => new Set(prev).add(livesRem - 1))
      setTimeout(() => setLivesAnim(prev => { const n = new Set(prev); n.delete(livesRem - 1); return n }), 450)
      let nta = trapsAv
      let nth = trapsHit
      const msg = shouldDoIt ? 'Simon said to do it! 😊' : 'Simon didn\'t say! 🪤'
      if (!shouldDoIt) nth = trapsHit + 1
      showFeedback('wrong', msg)
      showToast(msg)
      write({ 'moduleState.ssLivesRemaining': nl, 'moduleState.ssScore': score, 'moduleState.ssTrapsHit': nth, 'moduleState.ssTrapsAvoided': nta })
      if (nl <= 0) {
        clearAllTimeouts()
        write({ 'moduleState.ssGameOver': true, 'moduleState.ssIsPlaying': false })
      }
    }
  }, [canInteract, currentCmd, gameOver, isPlaying, score, trapsAv, trapsHit, livesRem, write, showFeedback, showToast, clearAllTimeouts, playSuccessChime, playGentleRetryTone])

  // Keyboard handlers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'simon-says' || !isPlaying || gameOver) return
      if (e.code === 'Space') { e.preventDefault(); handleSimonRespond(true) }
      else if (e.code === 'Backspace' || e.code === 'Escape') { e.preventDefault(); handleSimonRespond(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, isPlaying, gameOver, handleSimonRespond])

  // Log the result once when game ends
  const loggedOverRef = useRef(false)
  useEffect(() => {
    if (gameOver && isT && !loggedOverRef.current) {
      loggedOverRef.current = true
      logModuleEvent(sessionId, {
        module: 'simon-says',
        type: 'game_over',
        detail: `Finished Simon Says (best round ${Math.max(bestRound, round)}, score ${score})`,
      })
    }
    if (!gameOver) loggedOverRef.current = false
  }, [gameOver, isT, sessionId, bestRound, round, score])

  const handleStart = useCallback(() => {
    if (!isT) return
    write({ 'moduleState.ssIsPlaying': true })
    if (mode === 'classic') startClassic()
    else startSimonSays()
  }, [isT, mode, startClassic, startSimonSays, write])

  const handlePause = useCallback(() => {
    if (!isT) return
    clearAllTimeouts()
    write({ 'moduleState.ssIsPlaying': false })
  }, [isT, clearAllTimeouts, write])

  const handleReset = useCallback(() => {
    if (!isT) return
    clearAllTimeouts()
    write({
      'moduleState.ssIsPlaying': false,
      'moduleState.ssScore': 0,
      'moduleState.ssLivesRemaining': livesTotal,
      'moduleState.ssSequence': [],
      'moduleState.ssCurrentRound': 1,
      'moduleState.ssChildInput': [],
      'moduleState.ssIsPlayingSequence': false,
      'moduleState.ssActiveLitColor': null,
      'moduleState.ssCommandIndex': -1,
      'moduleState.ssCommandList': [],
      'moduleState.ssTrapsAvoided': 0,
      'moduleState.ssTrapsHit': 0,
      'moduleState.ssGameOver': false,
    })
    setGameOver(false)
    setActiveLitColor(null)
    setCmdIdx(-1)
  }, [isT, clearAllTimeouts, write, livesTotal])

  const handlePlayAgain = useCallback(() => {
    if (!isT) return
    setGameOver(false)
    write({ 'moduleState.ssGameOver': false, 'moduleState.ssScore': 0, 'moduleState.ssLivesRemaining': livesTotal })
    handleStart()
  }, [isT, livesTotal, write, handleStart])

  const cmdBarColor = countPct > 60 ? '#22C55E' : countPct > 30 ? '#F5B923' : '#EF4459'

  /* ── Presentation Values ─── */
  const roundLabel = mode === 'classic'
    ? String(round)
    : `${Math.max(0, cmdIdx + 1)} / ${cmdList.length || '—'}`

  const levelValue = mode === 'classic' ? round : Math.max(1, cmdIdx + 1)
  const levelPct = mode === 'classic'
    ? Math.min(100, (round / 10) * 100)
    : cmdList.length ? Math.min(100, ((cmdIdx + 1) / cmdList.length) * 100) : 0

  const banner = useMemo(() => {
    if (gameOver) return { icon: '🏆', title: 'Round Completed!', sub: 'Take a calm breath. You did wonderful work today.' }
    if (!isPlaying) {
      return isT
        ? { icon: '🎮', title: 'Ready to Begin', sub: 'Pick your difficulty, then press Start to play.' }
        : { icon: '✨', title: 'Get Ready!', sub: 'Your therapist is getting the activity ready for you...' }
    }
    if (mode === 'classic') {
      return isPlaySeq
        ? { icon: '👀', title: 'Simon\'s Turn — Watch & Listen', sub: 'Relax, watch the glowing pads and listen to the melody.' }
        : { icon: '🎈', title: 'Your Turn — Tap the Colors!', sub: `Repeat the pattern: ${childIn.length} of ${seq.length} taps matched.` }
    }
    return { icon: '👂', title: 'Listen Carefully...', sub: 'Follow the command only when Simon says so!' }
  }, [gameOver, isPlaying, isT, mode, isPlaySeq, childIn.length, seq.length])

  const settingsDisabled = !isT

  return (
    <div style={{
      height: '100%',
      minHeight: 0,
      maxWidth: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      borderRadius: 24,
      overflow: 'hidden',
      padding: '16px 20px',
      gap: 14,
      color: INK,
      fontFamily: '"DM Sans", system-ui, sans-serif',
      background: 'linear-gradient(160deg, #faf8ff 0%, #ede8fb 40%, #ddd3f7 75%, #cfc4f2 100%)',
      border: '1px solid rgba(255,255,255,0.9)',
      boxShadow: '0 12px 40px rgba(91,33,182,0.10)',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap');
        @keyframes ci{0%{transform:scale(.9)translateY(10px);opacity:0}100%{transform:scale(1)translateY(0);opacity:1}}
        @keyframes hl{0%{transform:scale(1.4);opacity:1}100%{transform:scale(0);opacity:0}}
        @keyframes ssWave{0%,100%{transform:scaleY(.4)}50%{transform:scaleY(1)}}
        @keyframes ssPop{0%{transform:scale(.7) translateY(-16px);opacity:0}60%{transform:scale(1.08) translateY(2px);opacity:1}100%{transform:scale(1) translateY(0);opacity:1}}
        @keyframes pad3DPop{
          0% { transform: scale(1) translateY(0); }
          45% { transform: scale(1.14) translateY(-12px); }
          100% { transform: scale(1.10) translateY(-8px); }
        }
        @keyframes toastFlash{
          0%{opacity:0;transform:translate(-50%,-50%) scale(.7)}
          30%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}
          70%{opacity:1;transform:translate(-50%,-50%) scale(1)}
          100%{opacity:0;transform:translate(-50%,-50%) scale(.9)}
        }
        @keyframes orbitSpin{
          from{transform:translate(-50%,-50%) rotate(0deg)}
          to{transform:translate(-50%,-50%) rotate(360deg)}
        }
        @keyframes orbitSpinRev{
          from{transform:translate(-50%,-50%) rotate(0deg)}
          to{transform:translate(-50%,-50%) rotate(-360deg)}
        }
        @keyframes consoleFloat{
          0%,100%{transform:translateY(0px)}
          50%{transform:translateY(-6px)}
        }
        @keyframes haloPulse{
          0%,100%{opacity:0.25;transform:translate(-50%,-50%) scale(1)}
          50%{opacity:0.55;transform:translate(-50%,-50%) scale(1.04)}
        }
        @keyframes orbitDot{
          from{transform:rotate(var(--start)) translateX(var(--r)) rotate(calc(-1 * var(--start)))}
          to{transform:rotate(calc(var(--start) + 360deg)) translateX(var(--r)) rotate(calc(-1 * (var(--start) + 360deg)))}
        }
        @keyframes correctFlash{
          0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}
          35%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}
          65%{opacity:1;transform:translate(-50%,-50%) scale(1)}
          100%{opacity:0;transform:translate(-50%,-50%) scale(.8)}
        }
        .ci-a{animation:ci .3s ease}
        .ss-pop{animation:ssPop .3s cubic-bezier(0.34,1.56,0.64,1)}
        .toast-flash{animation:toastFlash .22s ease forwards}
        .pad-elevated{
          animation: pad3DPop 0.26s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>

      {/* ── Settings / Top Bar ────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 10,
      }}>
        {/* Difficulty */}
        <div style={card}>
          <span style={microLabel}>Difficulty</span>
          <PillGroup
            value={difficulty}
            disabled={settingsDisabled}
            options={[
              { key: 'easy', label: 'Easy', fill: '#10B981' },
              { key: 'medium', label: 'Medium', fill: '#F59E0B' },
              { key: 'hard', label: 'Hard', fill: '#EF4444' },
            ]}
            onSelect={(d) => {
              if (!isT) return
              const sp = d === 'easy' ? 1200 : d === 'hard' ? 500 : 800
              const cs = d === 'easy' ? 3000 : d === 'hard' ? 1200 : 2000
              const lt = d === 'easy' ? 5 : d === 'hard' ? 3 : 3
              write({ 'moduleState.ssDifficulty': d, 'moduleState.ssSpeed': sp, 'moduleState.ssCommandSpeed': cs, 'moduleState.ssLivesTotal': lt, 'moduleState.ssLivesRemaining': lt })
            }}
          />
        </div>

        {/* Speed (classic) / Traps (simon says) */}
        {mode === 'classic' ? (
          <div style={card}>
            <span style={microLabel}>Speed</span>
            <PillGroup
              value={String(speed)}
              disabled={settingsDisabled}
              options={[
                { key: '1200', label: 'Calm', icon: '🐢', fill: '#3B82F6' },
                { key: '800', label: 'Balanced', icon: '🚶', fill: '#3B82F6' },
                { key: '500', label: 'Fast', icon: '⚡', fill: '#3B82F6' },
              ]}
              onSelect={(v) => {
                if (!isT) return
                write({ 'moduleState.ssSpeed': Number(v) })
              }}
            />
          </div>
        ) : (
          <div style={card}>
            <span style={microLabel}>Traps</span>
            <PillGroup
              value={trapRatio}
              disabled={settingsDisabled}
              options={[
                { key: 'low', label: 'Low', icon: '🍀', fill: '#3B82F6' },
                { key: 'medium', label: 'Medium', icon: '🪤', fill: '#3B82F6' },
                { key: 'high', label: 'High', icon: '🔥', fill: '#3B82F6' },
              ]}
              onSelect={(r) => {
                if (!isT) return
                write({ 'moduleState.ssTrapRatio': r })
              }}
            />
          </div>
        )}

        {/* Round + Score */}
        <div style={{ ...card, gap: 0, padding: '7px 6px' }}>
          <div style={{ padding: '0 14px', textAlign: 'center', minWidth: 70 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: VIOLET }}>Round</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: INK, lineHeight: 1.25 }}>{roundLabel}</div>
          </div>
          <div style={{ width: 1, alignSelf: 'stretch', background: CARD_BORDER }} />
          <div style={{ padding: '0 14px', textAlign: 'center', minWidth: 66 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: VIOLET, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <span aria-hidden>⭐</span> Score
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, color: INK, lineHeight: 1.25 }}>{score}</div>
          </div>
        </div>

        {/* Therapist-only: mode + transport controls */}
        {isT && (
          <div style={{ ...card, gap: 8 }}>
            <PillGroup
              value={mode}
              disabled={false}
              options={[
                { key: 'classic', label: 'Classic', icon: '🎨', fill: VIOLET_MID },
                { key: 'simon-says', label: 'Simon Says', icon: '🗣️', fill: VIOLET_MID },
              ]}
              onSelect={(m) => write({ 'moduleState.ssMode': m })}
            />
            <div style={{ width: 1, alignSelf: 'stretch', background: CARD_BORDER }} />
            {!isPlaying ? (
              <button type="button" onClick={handleStart} style={{
                padding: '7px 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: `linear-gradient(180deg, ${VIOLET_MID}, ${VIOLET})`, color: '#ffffff',
                fontSize: 14.5, fontWeight: 800, boxShadow: '0 3px 10px rgba(91,33,182,0.32)',
              }}>▶ Start</button>
            ) : (
              <button type="button" onClick={handlePause} style={{
                padding: '7px 16px', borderRadius: 999, border: `1px solid ${CARD_BORDER}`, cursor: 'pointer',
                background: '#F3F4F8', color: INK, fontSize: 14.5, fontWeight: 800,
              }}>⏸ Pause</button>
            )}
            <button type="button" onClick={handleReset} style={{
              padding: '7px 13px', borderRadius: 999, border: '1px solid rgba(225,29,72,0.35)', cursor: 'pointer',
              background: 'transparent', color: '#BE123C', fontSize: 14.5, fontWeight: 700,
            }}>↺ Reset</button>
          </div>
        )}
      </div>

      {/* ── Play Area ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', gap: 14 }}>

        {/* Left Rail: Level Meter + Hearts */}
        <div style={{ flexShrink: 0, width: 114, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          {/* Level meter */}
          <div style={{
            ...card,
            flex: 1,
            minHeight: 0,
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: '10px 8px 10px',
            borderRadius: 22,
            alignSelf: 'center',
            width: 66,
          }}>
            <div style={{
              flex: 1,
              minHeight: 0,
              width: 26,
              borderRadius: 999,
              background: '#F1EDFC',
              border: `1px solid ${CARD_BORDER}`,
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', left: 0, right: 0, bottom: 0,
                height: `${levelPct}%`,
                borderRadius: 999,
                background: `linear-gradient(180deg, #A78BFA 0%, ${VIOLET_MID} 100%)`,
                transition: 'height 0.45s cubic-bezier(.4,0,.2,1)',
              }} />
              <div aria-hidden style={{
                position: 'absolute', left: '50%', transform: 'translate(-50%, 50%)',
                bottom: `${levelPct}%`, fontSize: 15, lineHeight: 1,
                transition: 'bottom 0.45s cubic-bezier(.4,0,.2,1)',
              }}>⭐</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: INK_MUTED }}>Level</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: INK, lineHeight: 1.2 }}>{levelValue}</div>
            </div>
          </div>

          {/* Lives (Hearts) */}
          <div style={{
            ...card,
            flexShrink: 0,
            flexDirection: 'column',
            gap: 6,
            padding: '10px 8px 12px',
            borderRadius: 20,
          }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: VIOLET, textAlign: 'center' }}>Chances</div>
            <div style={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
              {Array.from({ length: livesTotal }, (_, i) => (
                <span key={i} style={{
                  display: 'inline-flex',
                  animation: livesAnim.has(i) ? 'hl 0.4s ease forwards' : 'none',
                }}>
                  <img
                    src={i < livesRem ? HEART_FILLED : HEART_EMPTY}
                    alt=""
                    aria-hidden
                    width={24}
                    height={22}
                    style={{ display: 'block' }}
                  />
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Centre Stage: Calming, Responsive Arcade Console */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          {mode === 'classic' ? (
            <>
              {/* ── Animated Orbital Wrapper ── */}
              <div style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                // Extra space for orbit rings
                width: 420,
                height: 420,
                flexShrink: 0,
              }}>

                {/* Outer halo pulse (ambient glow) */}
                <div aria-hidden style={{
                  position: 'absolute',
                  top: '50%', left: '50%',
                  width: 410, height: 410,
                  borderRadius: '50%',
                  background: isPlaySeq
                    ? 'radial-gradient(circle, rgba(168,85,247,0.18) 0%, transparent 70%)'
                    : isPlaying
                    ? 'radial-gradient(circle, rgba(52,211,153,0.15) 0%, transparent 70%)'
                    : 'radial-gradient(circle, rgba(139,92,246,0.10) 0%, transparent 70%)',
                  animation: 'haloPulse 2.5s ease-in-out infinite',
                  pointerEvents: 'none',
                }} />

                {/* Outer spinning conic ring */}
                <div aria-hidden style={{
                  position: 'absolute',
                  top: '50%', left: '50%',
                  width: 402, height: 402,
                  borderRadius: '50%',
                  background: 'conic-gradient(from 0deg, #10b981 0%, #3b82f6 25%, #f59e0b 50%, #ef4444 75%, #10b981 100%)',
                  animation: 'orbitSpin 8s linear infinite',
                  opacity: isPlaying ? 0.55 : 0.2,
                  transition: 'opacity 0.5s ease',
                  mask: 'radial-gradient(circle, transparent 190px, black 193px)',
                  WebkitMask: 'radial-gradient(circle, transparent 190px, black 193px)',
                  pointerEvents: 'none',
                }} />

                {/* Inner counter-spinning dashed ring */}
                <div aria-hidden style={{
                  position: 'absolute',
                  top: '50%', left: '50%',
                  width: 390, height: 390,
                  borderRadius: '50%',
                  border: '2px dashed rgba(167,139,250,0.35)',
                  animation: 'orbitSpinRev 12s linear infinite',
                  pointerEvents: 'none',
                }} />

                {/* Orbiting color dots */}
                {isPlaying && [0,1,2,3].map((i) => {
                  const colors = ['#10b981','#ef4444','#f59e0b','#3b82f6']
                  const startDeg = i * 90
                  const r = 200
                  const x = r * Math.cos(startDeg * Math.PI / 180)
                  const y = r * Math.sin(startDeg * Math.PI / 180)
                  return (
                    <div
                      key={i}
                      aria-hidden
                      style={{
                        position: 'absolute',
                        top: `calc(50% + ${y}px)`,
                        left: `calc(50% + ${x}px)`,
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        background: colors[i],
                        boxShadow: `0 0 10px 4px ${colors[i]}88`,
                        transform: 'translate(-50%,-50%)',
                        animation: `orbitSpin ${6 + i * 1.2}s linear infinite`,
                        transformOrigin: `${-x}px ${-y}px`,
                        pointerEvents: 'none',
                      }}
                    />
                  )
                })}

                {/* Pop-Up Classic Simon Console */}
                <div style={{
                  position: 'relative',
                  width: 370,
                  height: 370,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gridTemplateRows: '1fr 1fr',
                  gap: 16,
                  padding: 16,
                  background: 'radial-gradient(circle at 40% 35%, #352b5e 0%, #1f1738 55%, #120f24 100%)',
                  borderRadius: '50%',
                  boxShadow: isPlaySeq
                    ? '0 24px 60px rgba(35, 20, 65, 0.5), 0 0 40px rgba(167,139,250,0.45), inset 0 3px 10px rgba(255,255,255,0.22)'
                    : isPlaying
                    ? '0 24px 60px rgba(35, 20, 65, 0.45), 0 0 24px rgba(52,211,153,0.25), inset 0 3px 10px rgba(255,255,255,0.18)'
                    : '0 20px 48px rgba(35, 20, 65, 0.35), inset 0 2px 8px rgba(255,255,255,0.14)',
                  animation: 'consoleFloat 4s ease-in-out infinite',
                  opacity: isPlaying ? 1 : 0.9,
                  transition: 'box-shadow 0.35s ease, opacity 0.25s',
                  flexShrink: 0,
                }}>
                {BUTTONS.map((color, padIdx) => {
                  const isLit = isPlaySeq && activeLitColor === color
                  const isTapped = tapFlash === color
                  const isHot = isLit || isTapped
                  const theme = PAD_THEMES[color]

                  // Corner radii to shape quadrant buttons into a seamless circular console
                  const borderRadii = [
                    '100% 28px 28px 28px', // Top Left (Green)
                    '28px 100% 28px 28px', // Top Right (Red)
                    '28px 28px 28px 100%', // Bottom Left (Yellow)
                    '28px 28px 100% 28px', // Bottom Right (Blue)
                  ][padIdx]

                  return (
                    <button
                      key={color}
                      type="button"
                      role="button"
                      aria-label={`${theme.name} pad`}
                      onClick={() => handleClassicTap(color)}
                      disabled={isPlaySeq || !isPlaying}
                      className={isHot ? 'pad-elevated' : ''}
                      style={{
                        position: 'relative',
                        borderRadius: borderRadii,
                        background: isHot ? theme.litGradient : theme.idleGradient,
                        border: `3.5px solid ${isHot ? theme.litBorder : theme.idleBorder}`,
                        cursor: canInteract && !isPlaySeq && isPlaying ? 'pointer' : 'default',
                        boxShadow: isHot ? theme.litShadow : theme.idleShadow,
                        transform: isHot
                          ? 'scale(1.09) translateY(-7px)'
                          : isPlaySeq
                          ? 'scale(0.97)'
                          : 'scale(1)',
                        zIndex: isHot ? 12 : 1,
                        transition: 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease',
                        outline: 'none',
                        overflow: 'hidden',
                        userSelect: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {/* Glossy curved reflection lens */}
                      <div
                        aria-hidden
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          height: '50%',
                          background: 'linear-gradient(180deg, rgba(255,255,255,0.52) 0%, rgba(255,255,255,0.06) 100%)',
                          borderRadius: borderRadii,
                          pointerEvents: 'none',
                        }}
                      />

                      {/* Pop-up glowing flash aura */}
                      {isHot && (
                        <div
                          aria-hidden
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 70%)',
                            pointerEvents: 'none',
                          }}
                        />
                      )}

                      {/* Musical note symbol + solmization label */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 1,
                        transform: isHot ? 'scale(1.22)' : 'scale(1)',
                        transition: 'transform 0.18s ease',
                        userSelect: 'none',
                        pointerEvents: 'none',
                      }}>
                        <span style={{
                          fontSize: isHot ? 36 : 28,
                          lineHeight: 1,
                          color: isHot ? '#ffffff' : 'rgba(255,255,255,0.88)',
                          fontWeight: 900,
                          textShadow: isHot
                            ? '0 0 18px rgba(255,255,255,1), 0 2px 8px rgba(0,0,0,0.3)'
                            : '0 2px 6px rgba(0,0,0,0.3)',
                          transition: 'font-size 0.18s ease, text-shadow 0.18s ease',
                        }}>
                          {theme.note}
                        </span>
                        <span style={{
                          fontSize: isHot ? 13 : 11,
                          fontWeight: 800,
                          letterSpacing: 1.5,
                          color: isHot ? '#ffffff' : 'rgba(255,255,255,0.7)',
                          textShadow: '0 1px 4px rgba(0,0,0,0.4)',
                          transition: 'font-size 0.18s ease',
                          lineHeight: 1,
                        }}>
                          {theme.noteLabel}
                        </span>
                      </div>
                    </button>
                  )
                })}

                {/* Centre Console Hub — concentric rings with status glow */}
                <div aria-hidden style={{
                  position: 'absolute',
                  top: '50%', left: '50%',
                  transform: 'translate(-50%,-50%)',
                  width: 100,
                  height: 100,
                  borderRadius: '50%',
                  zIndex: 15,
                }}>
                  {/* Outer decorative ring */}
                  <div style={{
                    position: 'absolute', inset: -6,
                    borderRadius: '50%',
                    border: `2.5px solid ${isPlaySeq ? 'rgba(192,132,252,0.6)' : isPlaying ? 'rgba(52,211,153,0.5)' : 'rgba(139,92,246,0.3)'}`,
                    transition: 'border-color 0.3s ease',
                    animation: isPlaying ? 'orbitSpinRev 6s linear infinite' : 'none',
                  }} />
                  {/* Main hub */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle at 35% 30%, #46375e 0%, #1e1732 100%)',
                    border: '3px solid #5c4a85',
                    boxShadow: isPlaySeq
                      ? '0 0 32px rgba(168,85,247,0.9), inset 0 2px 8px rgba(255,255,255,0.15)'
                      : isPlaying
                      ? '0 0 32px rgba(52,211,153,0.9), inset 0 2px 8px rgba(255,255,255,0.12)'
                      : '0 6px 20px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'box-shadow 0.3s ease',
                    gap: 2,
                  }}>
                    {/* Inner glossy lens */}
                    <div style={{
                      position: 'absolute', top: 4, left: 8, right: 8, height: '42%',
                      borderRadius: '50%',
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 100%)',
                      pointerEvents: 'none',
                    }} />
                    <span style={{ fontSize: 22, lineHeight: 1, position: 'relative' }}>🎵</span>
                    <span style={{
                      fontSize: 9.5,
                      fontWeight: 900,
                      letterSpacing: 1.5,
                      textTransform: 'uppercase',
                      color: isPlaySeq ? '#e9d5ff' : isPlaying ? '#6ee7b7' : '#c4b5fd',
                      position: 'relative',
                      transition: 'color 0.3s ease',
                    }}>
                      {isPlaySeq ? 'WATCH' : isPlaying ? 'YOUR TURN' : 'SIMON'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Close orbital wrapper */}
              </div>

              {/* Calming Sequence Step Indicators (helps clients with anxiety/ADHD visually track their progress) */}
              {isPlaying && seq.length > 0 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '4px 14px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.7)',
                  border: `1px solid ${CARD_BORDER}`,
                }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: INK_MUTED }}>Sequence:</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {seq.map((_, i) => {
                      const isDone = i < childIn.length
                      const isCurrent = !isPlaySeq && i === childIn.length
                      return (
                        <span
                          key={i}
                          style={{
                            width: 11,
                            height: 11,
                            borderRadius: '50%',
                            background: isDone
                              ? VIOLET_MID
                              : isCurrent
                              ? '#34D399'
                              : '#DDD6FE',
                            boxShadow: isCurrent ? '0 0 8px #34D399' : 'none',
                            transform: isCurrent ? 'scale(1.3)' : 'scale(1)',
                            transition: 'all 0.2s ease',
                          }}
                        />
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Simon Says mode — command card + response buttons */
            <div style={{ width: '100%', maxWidth: 620, height: '100%', display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
              <div key={animateKey} className="ci-a" style={{
                ...card,
                flex: '0 1 auto',
                minHeight: 150,
                borderRadius: 24,
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 8,
                padding: 22,
              }}>
                {currentCmd?.hasSimonSays ? (
                  <div style={{ fontSize: 16, fontWeight: 800, color: VIOLET, letterSpacing: 0.3 }}>SIMON SAYS...</div>
                ) : (
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'transparent' }}>&nbsp;</div>
                )}
                <div style={{ fontSize: 28, fontWeight: 800, color: INK, textAlign: 'center', lineHeight: 1.25 }}>
                  {currentCmd ? `${currentCmd.text} ${currentCmd.emoji}` : 'Waiting for the first command...'}
                </div>
                <div style={{ width: '100%', height: 6, borderRadius: 3, background: '#F1EDFC', marginTop: 6 }}>
                  <div style={{
                    width: `${countPct}%`, height: '100%', borderRadius: 3,
                    background: cmdBarColor,
                    transition: `width ${cmdSpeed}ms linear`,
                  }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                <button type="button" onClick={() => handleSimonRespond(true)} style={{
                  flex: 1, height: 54, borderRadius: 18, border: 'none',
                  cursor: canInteract ? 'pointer' : 'default',
                  background: 'linear-gradient(180deg,#34D77F,#1E9E56)', color: '#ffffff',
                  fontSize: 17, fontWeight: 800, letterSpacing: 0.2,
                  boxShadow: '0 6px 16px rgba(30,158,86,0.28)',
                }}>✅ DO IT!</button>
                <button type="button" onClick={() => handleSimonRespond(false)} style={{
                  flex: 1, height: 54, borderRadius: 18, border: 'none',
                  cursor: canInteract ? 'pointer' : 'default',
                  background: 'linear-gradient(180deg,#F4667B,#C81E38)', color: '#ffffff',
                  fontSize: 17, fontWeight: 800, letterSpacing: 0.2,
                  boxShadow: '0 6px 16px rgba(200,30,56,0.26)',
                }}>❌ SKIP!</button>
              </div>
            </div>
          )}
        </div>

        {/* Right spacer for symmetrical centering */}
        <div aria-hidden style={{ flexShrink: 0, width: 114 }} />
      </div>

      {/* ── Status Banner ────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 18px',
        borderRadius: 22,
        background: 'rgba(255,255,255,0.85)',
        border: '1px solid rgba(255,255,255,0.95)',
        boxShadow: CARD_SHADOW,
        backdropFilter: 'blur(6px)',
      }}>
        <div aria-hidden style={{
          flexShrink: 0, width: 44, height: 44, borderRadius: '50%',
          background: '#ffffff', border: `1px solid ${CARD_BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26,
          boxShadow: '0 3px 10px rgba(91,33,182,0.10)',
        }}>{banner.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: VIOLET, lineHeight: 1.25 }}>{banner.title}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#4A4560', lineHeight: 1.35 }}>{banner.sub}</div>
        </div>
        <Waveform active={isPlaying && !gameOver} />
        <button
          type="button"
          onClick={() => setMuted(m => !m)}
          title={muted ? 'Turn sound on' : 'Turn sound off'}
          aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
          style={{
            flexShrink: 0, width: 34, height: 34, borderRadius: '50%',
            border: `1px solid ${CARD_BORDER}`, background: '#ffffff', cursor: 'pointer',
            fontSize: 16.5, lineHeight: 1, color: INK,
          }}
        >{muted ? '🔇' : '🔊'}</button>
      </div>

      {/* ── Feedback Flash ───────────────────────────────────────────────── */}
      {feedback && (
        <div className="ss-pop" style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          padding: '14px 28px',
          borderRadius: 999,
          background: feedback.type === 'correct'
            ? 'linear-gradient(135deg, #d1fae5, #a7f3d0)'
            : feedback.type === 'gold'
            ? 'linear-gradient(135deg, #fef3c7, #fde68a)'
            : 'linear-gradient(135deg, #fee2e2, #fecaca)',
          border: `2px solid ${
            feedback.type === 'correct' ? '#34d399'
            : feedback.type === 'gold' ? '#fbbf24'
            : '#f87171'
          }`,
          boxShadow: `0 12px 36px ${
            feedback.type === 'correct' ? 'rgba(52,211,153,0.35)'
            : feedback.type === 'gold' ? 'rgba(251,191,36,0.35)'
            : 'rgba(248,113,113,0.3)'
          }`,
          fontSize: 18, fontWeight: 800, zIndex: 30, pointerEvents: 'none', whiteSpace: 'nowrap',
          color: feedback.type === 'correct' ? '#065f46' : feedback.type === 'gold' ? '#92400e' : '#991b1b',
        }}>
          {feedback.msg}
        </div>
      )}

      {/* ── Game Over Screen (Gentle & Encouraging) ───────────────────────── */}
      {gameOver && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(235, 230, 252, 0.88)', backdropFilter: 'blur(8px)', zIndex: 50, padding: 20,
        }}>
          <div style={{
            background: '#ffffff', border: `1px solid ${CARD_BORDER}`, borderRadius: 26,
            boxShadow: '0 18px 48px rgba(70,30,120,0.22)', padding: '26px 34px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: 430,
          }}>
            <div aria-hidden style={{ fontSize: 38 }}>🎉</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: VIOLET }}>Great Session!</div>
            {mode === 'classic' ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, color: INK_MUTED, textAlign: 'center', lineHeight: 1.5 }}>
                  You reached round {round}<br />
                  Best sequence this run: {Math.max(bestRound, round)}
                </div>
                <div style={{ fontSize: 24 }}>{starRating(Math.max(bestRound, round))}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, color: INK_MUTED, textAlign: 'center', lineHeight: 1.5 }}>
                  {score} correct out of {cmdList.length} commands<br />
                  Traps dodged: {trapsAv}<br />
                  Fell for traps: {trapsHit}
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: INK, textAlign: 'center' }}>
                  {cmdList.length > 0 ? (trapsAv / Math.max(1, trapsAv + trapsHit) > 0.8 ? 'Amazing self-control! ⭐⭐⭐' : trapsAv / Math.max(1, trapsAv + trapsHit) > 0.6 ? 'Great job! ⭐⭐' : 'Keep practising! ⭐') : '⭐'}
                </div>
              </>
            )}
            {isT ? (
              <button type="button" onClick={handlePlayAgain} style={{
                marginTop: 6, padding: '10px 28px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: `linear-gradient(180deg, ${VIOLET_MID}, ${VIOLET})`, color: '#ffffff',
                fontSize: 16, fontWeight: 800, boxShadow: '0 4px 14px rgba(91,33,182,0.32)',
              }}>Play again</button>
            ) : (
              <div style={{ marginTop: 6, fontSize: 15.5, fontWeight: 600, color: INK_MUTED }}>
                Your therapist can start another round.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Toast — 200ms correct flash in centre of console ──────────────── */}
      {toast && (
        <div
          className="toast-flash"
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            background: 'linear-gradient(135deg, #059669, #34d399)',
            borderRadius: 999,
            padding: '10px 22px',
            color: '#ffffff',
            fontSize: 17,
            fontWeight: 900,
            letterSpacing: 0.5,
            zIndex: 200,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 0 30px rgba(52,211,153,0.7), 0 6px 20px rgba(5,150,105,0.5)',
            border: '2px solid rgba(255,255,255,0.4)',
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
