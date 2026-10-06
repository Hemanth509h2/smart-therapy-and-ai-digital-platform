'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { staadCancel } from '@/lib/voice/staadVoice'

/* ── Art assets ───────────────────────────────────────────────────────────────
   The delivered folder name contains spaces, so every segment is encoded and
   the files are referenced with plain <img>/background-image rather than
   next/image (same pattern as WorryVault). */
const SS_ASSET = (file: string) =>
  `/assets/modules/ADHD/${encodeURIComponent('Simon says Assets')}/${encodeURIComponent(file)}`

const HEART_FILLED = SS_ASSET('heart-filled.svg')
const HEART_EMPTY = SS_ASSET('heart-empty.svg')
/* Glossy pad sprites (two states per colour) shipped in files.zip. */
const PAD_ART = (color: string, lit: boolean) => SS_ASSET(`${color}-${lit ? 'lit' : 'normal'}.svg`)
/* Soft pad tones shipped in "files (1).zip". */
const PAD_TONE = (color: string) => SS_ASSET(`pad-tone-${color}.wav`)

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

const BUTTONS = ['green', 'red', 'yellow', 'blue']
/* Glow colours are pulled from the lit sprite's own gradient stops so the CSS
   halo and the artwork agree. */
const PAD_GLOW: Record<string, string> = {
  green: 'rgba(34,197,94,0.55)',
  red: 'rgba(244,63,94,0.55)',
  yellow: 'rgba(251,191,36,0.55)',
  blue: 'rgba(59,130,246,0.55)',
}

/* ── Design tokens (light canvas — dark ink everywhere except solid fills) ─── */
const INK = '#2b2f33'
const INK_MUTED = '#6b7280'
const VIOLET = '#5B21B6'
const VIOLET_MID = '#6D4AE0'
const CARD_BORDER = '#e7eaef'
const CARD_SHADOW = '0 4px 14px rgba(70,45,130,0.08)'

const card: React.CSSProperties = {
  background: '#ffffff',
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  padding: '9px 14px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}

const microLabel: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: INK,
  letterSpacing: 0.1,
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

/* Segmented pill group — the white settings cards in the mockup. Inactive text
   stays dark-grey on a light track; white text only ever lands on a solid
   saturated fill. */
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
    <div style={{ display: 'flex', gap: 2, background: '#F3F4F8', borderRadius: 999, padding: 3 }}>
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
              padding: '5px 11px',
              borderRadius: 999,
              border: 'none',
              cursor: disabled ? 'default' : 'pointer',
              fontSize: 15.5,
              fontWeight: 700,
              lineHeight: 1.2,
              background: on ? o.fill : 'transparent',
              color: on ? '#ffffff' : INK_MUTED,
              boxShadow: on ? '0 2px 6px rgba(40,25,90,0.20)' : 'none',
              transition: 'background 0.15s, color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {o.icon && <span aria-hidden style={{ fontSize: 16 }}>{o.icon}</span>}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* Decorative audio meter in the status banner. */
function Waveform({ active }: { active: boolean }) {
  const bars = [9, 17, 27, 13, 31, 21, 34, 17, 27, 12, 20, 9]
  return (
    <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 3, height: 34, flexShrink: 0 }}>
      {bars.map((h, i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: h,
            borderRadius: 2,
            background: i % 2 ? VIOLET_MID : '#A78BFA',
            transformOrigin: 'center',
            opacity: active ? 1 : 0.4,
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
  const [litIdx, setLitIdx] = useState(-1)
  // The pad the player just pressed, so their own taps flash back at them.
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

  // Local-only presentation state — never written to Firestore.
  const [muted, setMuted] = useState(false)

  const tmr = useRef<ReturnType<typeof setInterval>>()
  const toastT = useRef<ReturnType<typeof setTimeout>>()
  const fbT = useRef<ReturnType<typeof setTimeout>>()
  const playedRef = useRef(false)

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
      // Was reading s.ssLivesRem (never written), so livesRem became undefined
      // after the first wrong tap: every heart rendered black and the game could
      // never reach 0 lives.
      if (typeof s.ssLivesRemaining === 'number') setLivesRem(s.ssLivesRemaining)
      if (typeof s.ssIsPlaying === 'boolean') setIsPlaying(s.ssIsPlaying)
      if (typeof s.ssScore === 'number') setScore(s.ssScore)
      if (Array.isArray(s.ssSequence)) setSeq(s.ssSequence)
      if (typeof s.ssCurrentRound === 'number') setRound(s.ssCurrentRound)
      if (Array.isArray(s.ssChildInput)) setChildIn(s.ssChildInput)
      if (typeof s.ssIsPlayingSequence === 'boolean') setIsPlaySeq(s.ssIsPlayingSequence)
      if (typeof s.ssLitButtonIndex === 'number') setLitIdx(s.ssLitButtonIndex)
      if (typeof s.ssBestRound === 'number') setBestRound(s.ssBestRound)
      if (typeof s.ssCommandIndex === 'number') setCmdIdx(s.ssCommandIndex)
      if (Array.isArray(s.ssCommandList)) setCmdList(s.ssCommandList as Command[])
      if (typeof s.ssTrapsAvoided === 'number') setTrapsAv(s.ssTrapsAvoided)
      if (typeof s.ssTrapsHit === 'number') setTrapsHit(s.ssTrapsHit)
      if (typeof s.ssGameOver === 'boolean') setGameOver(s.ssGameOver)
    })
    return () => unsub()
  }, [sessionId])

  // Clear all timers on unmount
  useEffect(() => () => {
    if (tmr.current) clearInterval(tmr.current)
    if (toastT.current) clearTimeout(toastT.current)
    if (fbT.current) clearTimeout(fbT.current)
    if (tapT.current) clearTimeout(tapT.current)
    staadCancel()
  }, [])

  /* ── Pad tones ──────────────────────────────────────────────────────────────
     Purely a side effect of the states the game already drives (`litIdx` while
     the sequence plays, `tapFlash` when a pad is pressed). No handler, timing
     or Firestore path is touched. */
  const padAudio = useRef<Record<string, HTMLAudioElement>>({})
  const mutedRef = useRef(false)
  useEffect(() => { mutedRef.current = muted }, [muted])

  const playPadTone = useCallback((color: string) => {
    try {
      if (typeof window === 'undefined' || mutedRef.current || !color) return
      let a = padAudio.current[color]
      if (!a) {
        a = new Audio(PAD_TONE(color))
        a.volume = 0.45
        padAudio.current[color] = a
      }
      a.currentTime = 0
      a.play()?.catch(() => {})
    } catch {}
  }, [])

  // Fires once per lit step; the -1 gap between rounds resets the guard so a
  // repeated colour at the same index still sounds.
  const lastToneRef = useRef('')
  useEffect(() => {
    const key = isPlaySeq && litIdx >= 0 && seq[litIdx] ? `${litIdx}:${seq[litIdx]}` : ''
    if (!key) { lastToneRef.current = ''; return }
    if (key === lastToneRef.current) return
    lastToneRef.current = key
    playPadTone(seq[litIdx])
  }, [litIdx, isPlaySeq, seq, playPadTone])

  useEffect(() => {
    if (tapFlash) playPadTone(tapFlash)
  }, [tapFlash, playPadTone])

  useEffect(() => () => {
    Object.values(padAudio.current).forEach(a => { try { a.pause() } catch {} })
    padAudio.current = {}
  }, [])

  const showFeedback = useCallback((type: 'correct' | 'wrong' | 'gold', msg: string) => {
    setFeedback({ type, msg })
    if (fbT.current) clearTimeout(fbT.current)
    fbT.current = setTimeout(() => setFeedback(null), 1200)
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast({ msg })
    if (toastT.current) clearTimeout(toastT.current)
    toastT.current = setTimeout(() => setToast(null), 1500)
  }, [])

  const clearTimer = useCallback(() => {
    if (tmr.current) { clearInterval(tmr.current); tmr.current = undefined }
  }, [])

  // --- Classic Mode ---
  const newRound = useCallback((s: string[], r: number) => {
    clearTimer()
    write({
      'moduleState.ssSequence': s,
      'moduleState.ssCurrentRound': r,
      'moduleState.ssChildInput': [],
      'moduleState.ssIsPlayingSequence': true,
      'moduleState.ssLitButtonIndex': 0,
    })
    setLitIdx(0)
    let i = 0
    tmr.current = setInterval(() => {
      i++
      if (i >= s.length) {
        clearInterval(tmr.current!); tmr.current = undefined
        write({ 'moduleState.ssLitButtonIndex': -1, 'moduleState.ssIsPlayingSequence': false })
        return
      }
      write({ 'moduleState.ssLitButtonIndex': i })
    }, speed)
  }, [speed, write, clearTimer])

  const startClassic = useCallback(() => {
    if (!isT) return
    const s = genSeq(startLen)
    setGameOver(false)
    setScore(0)
    setLivesRem(livesTotal)
    newRound(s, 1)
  }, [isT, startLen, livesTotal, newRound])

  const handleClassicTap = useCallback((color: string) => {
    // The therapist was previously blocked outright, which made the module look
    // completely unresponsive whenever it was driven from a single window.
    // canInteract already encodes the lock rule for the client.
    if (!canInteract || isPlaySeq || gameOver || !isPlaying) return

    // Immediate acknowledgement of the press, independent of whether the tap
    // turns out to be right or wrong.
    setTapFlash(color)
    if (tapT.current) clearTimeout(tapT.current)
    tapT.current = setTimeout(() => setTapFlash(null), 180)

    const next = [...childIn, color]
    const idx = next.length - 1
    const isCorrect = next[idx] === seq[idx]
    if (!isCorrect) {
      const nl = livesRem - 1
      setLivesAnim(prev => new Set(prev).add(livesRem - 1))
      setTimeout(() => setLivesAnim(prev => { const n = new Set(prev); n.delete(livesRem - 1); return n }), 450)
      showFeedback('wrong', 'Oops! ✗')
      showToast('Wrong!')
      write({ 'moduleState.ssLivesRemaining': nl, 'moduleState.ssChildInput': next })
      if (nl <= 0) {
        clearTimer()
        const b = Math.max(bestRound, round)
        write({ 'moduleState.ssGameOver': true, 'moduleState.ssBestRound': b, 'moduleState.ssIsPlaying': false })
        return
      }
      setTimeout(() => newRound(seq, round), 1000)
      return
    }
    if (next.length === seq.length) {
      const ns = score + 1
      showFeedback('correct', '✓ Amazing!')
      showToast('Correct!')
      const nr = round + 1
      const b = Math.max(bestRound, nr)
      const newSeq = [...seq, BUTTONS[Math.floor(Math.random() * 4)]]
      write({ 'moduleState.ssScore': ns, 'moduleState.ssCurrentRound': nr, 'moduleState.ssChildInput': next, 'moduleState.ssBestRound': b })
      setTimeout(() => newRound(newSeq, nr), 1200)
      return
    }
    write({ 'moduleState.ssChildInput': next })
  }, [canInteract, isPlaySeq, gameOver, isPlaying, childIn, seq, livesRem, score, bestRound, round, speed, write, showFeedback, showToast, clearTimer, newRound])

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
    // Therapist lockout removed for the same reason as handleClassicTap.
    if (!canInteract || !currentCmd || gameOver || !isPlaying) return
    const shouldDoIt = currentCmd.hasSimonSays
    if (doIt === shouldDoIt) {
      const ns = score + 1
      let nta = trapsAv
      if (!shouldDoIt) nta = trapsAv + 1
      const type = doIt && shouldDoIt ? 'correct' : 'gold'
      const msg = doIt && shouldDoIt ? '✓ Correct!' : shouldDoIt ? 'You should have done it!' : 'Great self-control! 💪'
      if (type === 'gold') setTrapsAv(nta)
      showFeedback(type, msg)
      showToast(msg)
      write({ 'moduleState.ssScore': ns, 'moduleState.ssTrapsAvoided': nta })
    } else {
      const nl = livesRem - 1
      setLivesAnim(prev => new Set(prev).add(livesRem - 1))
      setTimeout(() => setLivesAnim(prev => { const n = new Set(prev); n.delete(livesRem - 1); return n }), 450)
      let nta = trapsAv
      let nth = trapsHit
      const msg = shouldDoIt ? 'You should have done it!' : 'Simon didn\'t say! 🪤'
      if (!shouldDoIt) nth = trapsHit + 1
      showFeedback('wrong', msg)
      showToast(msg)
      write({ 'moduleState.ssLivesRemaining': nl, 'moduleState.ssScore': score, 'moduleState.ssTrapsHit': nth, 'moduleState.ssTrapsAvoided': nta })
      if (nl <= 0) {
        clearTimer()
        write({ 'moduleState.ssGameOver': true, 'moduleState.ssIsPlaying': false })
      }
    }
  }, [canInteract, currentCmd, gameOver, isPlaying, score, trapsAv, trapsHit, livesRem, write, showFeedback, showToast, clearTimer])

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

  // Log the sequencing result once when a game ends (therapist browser only).
  const loggedOverRef = useRef(false)
  useEffect(() => {
    if (gameOver && isT && !loggedOverRef.current) {
      loggedOverRef.current = true
      logModuleEvent(sessionId, {
        module: 'simon-says',
        type: 'game_over',
        detail: `Finished a Simon Says round (best sequence length ${Math.max(bestRound, round)}, score ${score})`,
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
    clearTimer()
    write({ 'moduleState.ssIsPlaying': false })
  }, [isT, clearTimer, write])

  const handleReset = useCallback(() => {
    if (!isT) return
    clearTimer()
    write({
      'moduleState.ssIsPlaying': false,
      'moduleState.ssScore': 0,
      'moduleState.ssLivesRemaining': livesTotal,
      'moduleState.ssSequence': [],
      'moduleState.ssCurrentRound': 1,
      'moduleState.ssChildInput': [],
      'moduleState.ssIsPlayingSequence': false,
      'moduleState.ssLitButtonIndex': -1,
      'moduleState.ssCommandIndex': -1,
      'moduleState.ssCommandList': [],
      'moduleState.ssTrapsAvoided': 0,
      'moduleState.ssTrapsHit': 0,
      'moduleState.ssGameOver': false,
    })
    setGameOver(false)
    setLitIdx(-1)
    setCmdIdx(-1)
  }, [isT, clearTimer, write, livesTotal])

  const handlePlayAgain = useCallback(() => {
    if (!isT) return
    setGameOver(false)
    write({ 'moduleState.ssGameOver': false, 'moduleState.ssScore': 0, 'moduleState.ssLivesRemaining': livesTotal })
    handleStart()
  }, [isT, livesTotal, write, handleStart])

  const cmdBarColor = countPct > 60 ? '#22C55E' : countPct > 30 ? '#F5B923' : '#EF4459'

  /* ── Derived presentation values ─────────────────────────────────────────── */

  // The "Round x / y" card: classic counts rounds, Simon Says counts commands
  // out of the generated list (both are existing state, nothing new is stored).
  const roundLabel = mode === 'classic'
    ? String(round)
    : `${Math.max(0, cmdIdx + 1)} / ${cmdList.length || '—'}`

  // Vertical Level meter. Purely visual progress — 10 rounds fills the tube in
  // classic mode, the command list length in Simon Says mode.
  const levelValue = mode === 'classic' ? round : Math.max(1, cmdIdx + 1)
  const levelPct = mode === 'classic'
    ? Math.min(100, (round / 10) * 100)
    : cmdList.length ? Math.min(100, ((cmdIdx + 1) / cmdList.length) * 100) : 0

  const banner = useMemo(() => {
    if (gameOver) return { icon: '🏁', title: 'Round complete', sub: 'Take a breath — you can play again whenever you are ready.' }
    if (!isPlaying) {
      return isT
        ? { icon: '🎮', title: 'Ready when you are', sub: 'Choose a difficulty and speed, then press Start to begin.' }
        : { icon: '🎮', title: 'Get ready!', sub: 'Your therapist is setting up the activity for you...' }
    }
    if (mode === 'classic') {
      return isPlaySeq
        ? { icon: '👀', title: 'Watch Carefully...', sub: 'Simon will show the sequence and you have to repeat the sequence.' }
        : { icon: '✋', title: 'Your Turn!', sub: `Repeat the pattern in order — ${childIn.length} of ${seq.length} taps done.` }
    }
    return { icon: '👂', title: 'Listen Carefully...', sub: 'Only follow the command when Simon says. Otherwise, hold still.' }
  }, [gameOver, isPlaying, isT, mode, isPlaySeq, childIn.length, seq.length])

  const settingsDisabled = !isT

  return (
    /* Root fills the stage and never scrolls itself — ModuleStage's body is
       overflow:hidden and expects `height:100%` plus internal flex:1 regions.
       Every glyph on this lavender panel is dark ink; white text appears only
       on the solid saturated pills, pads and buttons. */
    <div style={{
      height: '100%',
      minHeight: 0,
      maxWidth: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      borderRadius: 20,
      overflow: 'hidden',
      padding: '14px 16px 14px',
      gap: 12,
      color: INK,
      fontFamily: '"DM Sans", sans-serif',
      background: 'linear-gradient(155deg, #EFEBFD 0%, #E2DAFA 42%, #D5CAF6 100%)',
    }}>
      <style>{`
        @keyframes ci{0%{transform:scale(.9)translateY(10px);opacity:0}100%{transform:scale(1)translateY(0);opacity:1}}
        @keyframes hl{0%{transform:scale(1.3);opacity:1}100%{transform:scale(0);opacity:0}}
        @keyframes ssWave{0%,100%{transform:scaleY(.4)}50%{transform:scaleY(1)}}
        @keyframes ssPop{0%{transform:scale(.85);opacity:0}100%{transform:scale(1);opacity:1}}
        .ci-a{animation:ci .3s ease}
        .ss-pop{animation:ssPop .22s ease}
      `}</style>

      {/* ── Settings row ─────────────────────────────────────────────────── */}
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
              { key: 'easy', label: 'Easy', fill: '#22C55E' },
              { key: 'medium', label: 'Medium', fill: '#F59E0B' },
              { key: 'hard', label: 'Hard', fill: '#EF4444' },
            ]}
            onSelect={(d) => {
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
                { key: '1200', label: 'Slow', icon: '🐢', fill: '#3B82F6' },
                { key: '800', label: 'Normal', icon: '🚶', fill: '#3B82F6' },
                { key: '500', label: 'Fast', icon: '⚡', fill: '#3B82F6' },
              ]}
              onSelect={(v) => write({ 'moduleState.ssSpeed': Number(v) })}
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
              onSelect={(r) => write({ 'moduleState.ssTrapRatio': r })}
            />
          </div>
        )}

        {/* Round + Score */}
        <div style={{ ...card, gap: 0, padding: '7px 6px' }}>
          <div style={{ padding: '0 14px', textAlign: 'center', minWidth: 74 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: VIOLET }}>Round</div>
            <div style={{ fontSize: 19.5, fontWeight: 800, color: INK, lineHeight: 1.25 }}>{roundLabel}</div>
          </div>
          <div style={{ width: 1, alignSelf: 'stretch', background: CARD_BORDER }} />
          <div style={{ padding: '0 14px', textAlign: 'center', minWidth: 66 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: VIOLET, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <span aria-hidden>⭐</span> Score
            </div>
            <div style={{ fontSize: 19.5, fontWeight: 800, color: INK, lineHeight: 1.25 }}>{score}</div>
          </div>
        </div>

        {/* Therapist-only: mode + transport */}
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
                fontSize: 16, fontWeight: 800, boxShadow: '0 3px 10px rgba(91,33,182,0.32)',
              }}>▶ Start</button>
            ) : (
              <button type="button" onClick={handlePause} style={{
                padding: '7px 16px', borderRadius: 999, border: `1px solid ${CARD_BORDER}`, cursor: 'pointer',
                background: '#F3F4F8', color: INK, fontSize: 16, fontWeight: 800,
              }}>⏸ Pause</button>
            )}
            <button type="button" onClick={handleReset} style={{
              padding: '7px 13px', borderRadius: 999, border: '1px solid rgba(225,29,72,0.35)', cursor: 'pointer',
              background: 'transparent', color: '#BE123C', fontSize: 16, fontWeight: 700,
            }}>↺ Reset</button>
          </div>
        )}
      </div>

      {/* ── Play area ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', gap: 14 }}>

        {/* Left rail: Level meter + Lives */}
        <div style={{ flexShrink: 0, width: 118, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
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
            width: 60,
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
                background: `linear-gradient(180deg, #8B5CF6 0%, ${VIOLET} 100%)`,
                transition: 'height 0.45s cubic-bezier(.4,0,.2,1)',
              }} />
              <div aria-hidden style={{
                position: 'absolute', left: '50%', transform: 'translate(-50%, 50%)',
                bottom: `${levelPct}%`, fontSize: 16.5, lineHeight: 1,
                transition: 'bottom 0.45s cubic-bezier(.4,0,.2,1)',
              }}>⭐</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: INK_MUTED }}>Level</div>
              <div style={{ fontSize: 17.5, fontWeight: 800, color: INK, lineHeight: 1.2 }}>{levelValue}</div>
            </div>
          </div>

          {/* Lives */}
          <div style={{
            ...card,
            flexShrink: 0,
            flexDirection: 'column',
            gap: 6,
            padding: '10px 10px 12px',
            borderRadius: 20,
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: VIOLET }}>Lives</div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
              {Array.from({ length: livesTotal }, (_, i) => (
                <span key={i} style={{
                  display: 'inline-flex',
                  animation: livesAnim.has(i) ? 'hl 0.4s ease forwards' : 'none',
                }}>
                  <img
                    src={i < livesRem ? HEART_FILLED : HEART_EMPTY}
                    alt=""
                    aria-hidden
                    width={26}
                    height={24}
                    style={{ display: 'block' }}
                  />
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Centre stage */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {mode === 'classic' ? (
            <div style={{
              position: 'relative',
              height: '100%',
              // Two 240x200 pads side by side — keep the sprites' native ratio
              // so the artwork's corner radius is not distorted.
              aspectRatio: '1.2',
              maxWidth: '100%',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gridTemplateRows: '1fr 1fr',
              gap: 12,
              opacity: isPlaying ? 1 : 0.62,
              transition: 'opacity 0.25s',
            }}>
              {BUTTONS.map((color) => {
                // litIdx is a position in the SEQUENCE, not a pad index. Comparing
                // it against the pad index lit red/blue/green/yellow in fixed order
                // regardless of the actual sequence, so the pattern the child saw
                // was never the pattern being validated.
                const isLit = isPlaySeq && litIdx >= 0 && seq[litIdx] === color
                const isTapped = tapFlash === color
                const isHot = isLit || isTapped
                return (
                  <div
                    key={color}
                    role="button"
                    aria-label={`${color} pad`}
                    onClick={() => handleClassicTap(color)}
                    style={{
                      borderRadius: 24,
                      backgroundImage: `url("${PAD_ART(color, isHot)}")`,
                      backgroundSize: '100% 100%',
                      backgroundRepeat: 'no-repeat',
                      cursor: canInteract && !isPlaySeq ? 'pointer' : 'default',
                      transition: 'transform 0.1s, box-shadow 0.1s',
                      boxShadow: isHot
                        ? `0 0 34px 6px ${PAD_GLOW[color]}, 0 8px 20px rgba(50,30,110,0.18)`
                        : '0 8px 20px rgba(50,30,110,0.16)',
                      transform: isLit ? 'scale(1.035)' : isTapped ? 'scale(0.965)' : 'scale(1)',
                      pointerEvents: isPlaySeq ? 'none' : 'auto',
                      userSelect: 'none', WebkitUserSelect: 'none',
                    }}
                  />
                )
              })}
              {/* Centre brain badge */}
              <div aria-hidden style={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                width: 76, height: 76, borderRadius: '50%',
                background: '#ffffff',
                border: `1px solid ${CARD_BORDER}`,
                boxShadow: '0 6px 20px rgba(50,30,110,0.18)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 37, zIndex: 5,
              }}>🧠</div>
            </div>
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
                <div style={{ fontSize: 30, fontWeight: 800, color: INK, textAlign: 'center', lineHeight: 1.25 }}>
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
                  flex: 1, height: 56, borderRadius: 18, border: 'none',
                  cursor: canInteract ? 'pointer' : 'default',
                  background: 'linear-gradient(180deg,#34D77F,#1E9E56)', color: '#ffffff',
                  fontSize: 18.5, fontWeight: 800, letterSpacing: 0.2,
                  boxShadow: '0 6px 16px rgba(30,158,86,0.28)',
                }}>✅ DO IT!</button>
                <button type="button" onClick={() => handleSimonRespond(false)} style={{
                  flex: 1, height: 56, borderRadius: 18, border: 'none',
                  cursor: canInteract ? 'pointer' : 'default',
                  background: 'linear-gradient(180deg,#F4667B,#C81E38)', color: '#ffffff',
                  fontSize: 18.5, fontWeight: 800, letterSpacing: 0.2,
                  boxShadow: '0 6px 16px rgba(200,30,56,0.26)',
                }}>❌ SKIP!</button>
              </div>
            </div>
          )}
        </div>

        {/* Right spacer keeps the pad grid optically centred against the rail. */}
        <div aria-hidden style={{ flexShrink: 0, width: 118 }} />
      </div>

      {/* ── Status banner ────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 16px',
        borderRadius: 22,
        background: 'rgba(255,255,255,0.78)',
        border: '1px solid rgba(255,255,255,0.9)',
        boxShadow: CARD_SHADOW,
        backdropFilter: 'blur(6px)',
      }}>
        <div aria-hidden style={{
          flexShrink: 0, width: 46, height: 46, borderRadius: '50%',
          background: '#ffffff', border: `1px solid ${CARD_BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
          boxShadow: '0 3px 10px rgba(50,30,110,0.12)',
        }}>{banner.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20.5, fontWeight: 800, color: VIOLET, lineHeight: 1.25 }}>{banner.title}</div>
          <div style={{ fontSize: 16.5, fontWeight: 600, color: '#4A4560', lineHeight: 1.35 }}>{banner.sub}</div>
        </div>
        <Waveform active={isPlaying && !gameOver} />
        <button
          type="button"
          onClick={() => setMuted(m => !m)}
          title={muted ? 'Pad sounds off' : 'Pad sounds on'}
          aria-label={muted ? 'Turn pad sounds on' : 'Turn pad sounds off'}
          style={{
            flexShrink: 0, width: 34, height: 34, borderRadius: '50%',
            border: `1px solid ${CARD_BORDER}`, background: '#ffffff', cursor: 'pointer',
            fontSize: 17.5, lineHeight: 1, color: INK,
          }}
        >{muted ? '🔇' : '🔊'}</button>
      </div>

      {/* ── Feedback flash ───────────────────────────────────────────────── */}
      {feedback && (
        <div className="ss-pop" style={{
          position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%,-50%)',
          padding: '9px 20px', borderRadius: 999,
          background: '#ffffff', border: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 8px 24px rgba(50,30,110,0.20)',
          fontSize: 19.5, fontWeight: 800, zIndex: 30, pointerEvents: 'none', whiteSpace: 'nowrap',
          color: feedback.type === 'correct' ? '#15803D' : feedback.type === 'gold' ? '#B45309' : '#BE123C',
        }}>
          {feedback.msg}
        </div>
      )}

      {/* ── Game Over ────────────────────────────────────────────────────── */}
      {gameOver && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(233,228,251,0.82)', backdropFilter: 'blur(6px)', zIndex: 50, padding: 20,
        }}>
          <div style={{
            background: '#ffffff', border: `1px solid ${CARD_BORDER}`, borderRadius: 24,
            boxShadow: '0 16px 44px rgba(50,30,110,0.22)', padding: '24px 32px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: 420,
          }}>
            <div aria-hidden style={{ fontSize: 37 }}>🎮</div>
            <div style={{ fontSize: 25.5, fontWeight: 800, color: VIOLET }}>Game Over!</div>
            {mode === 'classic' ? (
              <>
                <div style={{ fontSize: 16.5, fontWeight: 600, color: INK_MUTED, textAlign: 'center', lineHeight: 1.5 }}>
                  You reached round {round}<br />
                  Best this session: {Math.max(bestRound, round)}
                </div>
                <div style={{ fontSize: 23.5 }}>{starRating(Math.max(bestRound, round))}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16.5, fontWeight: 600, color: INK_MUTED, textAlign: 'center', lineHeight: 1.5 }}>
                  {score} correct out of {cmdList.length} commands<br />
                  Traps dodged: {trapsAv}<br />
                  Fell for traps: {trapsHit}
                </div>
                <div style={{ fontSize: 17.5, fontWeight: 700, color: INK, textAlign: 'center' }}>
                  {cmdList.length > 0 ? (trapsAv / Math.max(1, trapsAv + trapsHit) > 0.8 ? 'Amazing self-control! ⭐⭐⭐' : trapsAv / Math.max(1, trapsAv + trapsHit) > 0.6 ? 'Great job! ⭐⭐' : 'Keep practising! ⭐') : '⭐'}
                </div>
              </>
            )}
            {isT ? (
              <button type="button" onClick={handlePlayAgain} style={{
                marginTop: 4, padding: '10px 26px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: `linear-gradient(180deg, ${VIOLET_MID}, ${VIOLET})`, color: '#ffffff',
                fontSize: 16.5, fontWeight: 800, boxShadow: '0 4px 14px rgba(91,33,182,0.32)',
              }}>Play again</button>
            ) : (
              <div style={{ marginTop: 4, fontSize: 16, fontWeight: 600, color: INK_MUTED }}>
                Your therapist can start another round.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="ss-pop" style={{
          position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
          background: '#ffffff', border: `1px solid ${CARD_BORDER}`, borderRadius: 999,
          boxShadow: '0 8px 22px rgba(50,30,110,0.18)',
          padding: '7px 18px', color: INK, fontSize: 16.5, fontWeight: 700,
          zIndex: 100, pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
