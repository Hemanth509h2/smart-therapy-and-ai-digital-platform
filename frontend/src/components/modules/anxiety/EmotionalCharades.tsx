'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { doc, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore'
import { Shuffle, MessageCircle, Lightbulb } from 'lucide-react'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'

interface EmotionalCharadesProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

interface EmotionCard {
  id: string
  emoji: string
  label: string
  color: string
  desc: string
  category: 'basic' | 'complex' | 'therapy' | 'scenario'
}

interface AnswerRecord {
  answer: string
  correct: boolean
  timestamp: number
}

interface CheckInRecord {
  emotion: string
  timestamp: number
  sessionMinute: number
}

const CARDS: EmotionCard[] = [
  { id:'happy', emoji:'😊', label:'Happy', color:'#f7c948', desc:'Feeling joy and pleasure', category:'basic' },
  { id:'sad', emoji:'😢', label:'Sad', color:'#5b8dd9', desc:'Feeling down or unhappy', category:'basic' },
  { id:'angry', emoji:'😡', label:'Angry', color:'#c8602a', desc:'Feeling mad or frustrated', category:'basic' },
  { id:'scared', emoji:'😨', label:'Scared', color:'#9b59b6', desc:'Feeling afraid or worried', category:'basic' },
  { id:'surprised', emoji:'😮', label:'Surprised', color:'#2ecc71', desc:'Feeling shocked or amazed', category:'basic' },
  { id:'disgusted', emoji:'🤢', label:'Disgusted', color:'#27ae60', desc:'Feeling yuck or repulsed', category:'basic' },
  { id:'proud', emoji:'🦁', label:'Proud', color:'#f39c12', desc:'Feeling good about yourself', category:'complex' },
  { id:'embarrassed', emoji:'😳', label:'Embarrassed', color:'#e74c3c', desc:'Feeling awkward or shy', category:'complex' },
  { id:'excited', emoji:'🤩', label:'Excited', color:'#f1c40f', desc:'Feeling thrilled and eager', category:'complex' },
  { id:'frustrated', emoji:'😤', label:'Frustrated', color:'#e67e22', desc:'Feeling stuck or blocked', category:'complex' },
  { id:'lonely', emoji:'🥺', label:'Lonely', color:'#7f8c8d', desc:'Feeling alone or left out', category:'complex' },
  { id:'calm', emoji:'😌', label:'Calm', color:'#4a7c6f', desc:'Feeling peaceful and relaxed', category:'complex' },
  { id:'confused', emoji:'😕', label:'Confused', color:'#8e44ad', desc:'Feeling unsure or puzzled', category:'complex' },
  { id:'hopeful', emoji:'🌟', label:'Hopeful', color:'#3498db', desc:'Feeling things will get better', category:'complex' },
  { id:'worried', emoji:'😰', label:'Worried', color:'#95a5a6', desc:'Feeling anxious about something', category:'therapy' },
  { id:'relieved', emoji:'😅', label:'Relieved', color:'#1abc9c', desc:'Feeling better after stress', category:'therapy' },
  { id:'grateful', emoji:'🥰', label:'Grateful', color:'#e91e63', desc:'Feeling thankful', category:'therapy' },
  { id:'jealous', emoji:'😒', label:'Jealous', color:'#607d8b', desc:'Wanting what others have', category:'therapy' },
  { id:'bored', emoji:'😑', label:'Bored', color:'#9e9e9e', desc:'Feeling uninterested', category:'therapy' },
  { id:'loved', emoji:'❤️', label:'Loved', color:'#f44336', desc:'Feeling cared for', category:'therapy' },
  { id:'overwhelmed', emoji:'🌊', label:'Overwhelmed', color:'#1565c0', desc:'Too much at once', category:'scenario' },
  { id:'nervous', emoji:'😬', label:'Nervous', color:'#ff9800', desc:'Worried about something coming up', category:'scenario' },
  { id:'disappointed', emoji:'😞', label:'Disappointed', color:'#78909c', desc:'Expected more, got less', category:'scenario' },
  { id:'determined', emoji:'💪', label:'Determined', color:'#4caf50', desc:'Ready to keep going', category:'scenario' },
  { id:'hurt', emoji:'💔', label:'Hurt', color:'#e53935', desc:'Feeling pain inside', category:'scenario' },
  { id:'curious', emoji:'🧐', label:'Curious', color:'#00bcd4', desc:'Wanting to learn more', category:'scenario' },
  { id:'silly', emoji:'🤪', label:'Silly', color:'#ff5722', desc:'In a playful funny mood', category:'scenario' },
  { id:'peaceful', emoji:'🕊️', label:'Peaceful', color:'#b2dfdb', desc:'Everything feels okay', category:'scenario' },
]

const CATEGORY_LABELS: { key: string; label: string }[] = [
  { key: 'basic', label: 'Basic' },
  { key: 'complex', label: 'Complex' },
  { key: 'therapy', label: 'Therapy' },
  { key: 'scenario', label: 'Scenario' },
]

const CHECKIN_EMOTIONS = [
  { emoji: '😊', id: 'happy' }, { emoji: '😢', id: 'sad' }, { emoji: '😡', id: 'angry' },
  { emoji: '😨', id: 'scared' }, { emoji: '😌', id: 'calm' }, { emoji: '😤', id: 'frustrated' },
  { emoji: '🥺', id: 'lonely' }, { emoji: '😰', id: 'worried' }, { emoji: '🤩', id: 'excited' },
]

// How many emoji choices to show. Kept small deliberately: this is a
// recognition task for children who may be anxious or have a reading
// difficulty, and a wall of twelve faces is a memory test, not an emotion one.
const OPTION_COUNT: Record<string, number> = {
  simple: 4,
  standard: 5,
  advanced: 6,
}

/* ============================================================================
   Visual language (redesign only — no behaviour depends on any of this).

   The module renders on ModuleStage's WHITE canvas, so every value here is
   dark-on-light. White type appears in exactly one place: on the solid forest
   green fills. `var(--ink-muted)` / `var(--glass-border)` stay in use for muted
   text and hairlines because ModuleStage scopes them to light values.
   ========================================================================== */
const GREEN = '#1F7A44'
const GREEN_DEEP = '#17693A'
const GREEN_SOFT = '#E8F4EC'
const GREEN_LINE = 'rgba(31,122,68,0.34)'
const CREAM = '#FBF9F2'
const CARD_CREAM = '#FEFDF9'
const LINE = '#e7eaef'
const INK = '#1F2A24'
const INK_SOFT = '#48544D'

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Theatre masks — the module's hero mark, drawn inline so it needs no asset. */
function TheatreMasks({ w = 132 }: { w?: number }) {
  const body = 'M2 6c0-3 2-5 5-5h34c3 0 5 2 5 5v18c0 14-9 23-22 23S2 38 2 24V6z'
  return (
    <svg width={w} height={w * 0.6} viewBox="0 0 100 60" fill="none" aria-hidden="true">
      <g transform="translate(1 3) rotate(-9 24 25)">
        <path d={body} fill="#4E9BEA" />
        <path d="M12 19c2.5-3.6 6-3.6 8.5 0M27.5 19c2.5-3.6 6-3.6 8.5 0" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <path d="M14 30c4.5 7 15.5 7 20 0" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      </g>
      <g transform="translate(52 7) rotate(10 24 25)">
        <path d={body} fill="#F5C445" />
        <path d="M12 16c2.5 3.6 6 3.6 8.5 0M27.5 16c2.5 3.6 6 3.6 8.5 0" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <path d="M14 36c4.5-7 15.5-7 20 0" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      </g>
    </svg>
  )
}

/** Card-stack mark. `fill` is the card colour, `ink` the little face on it. */
function CardStackIcon({ s = 26, fill = GREEN, ink = '#ffffff' }: { s?: number; fill?: string; ink?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="14" height="17" rx="3.5" fill={fill} opacity="0.42" />
      <rect x="8" y="6" width="16" height="18" rx="4" fill={fill} />
      <circle cx="13.4" cy="13" r="1.15" fill={ink} />
      <circle cx="18.6" cy="13" r="1.15" fill={ink} />
      <path d="M13 17c1.6 1.9 4.4 1.9 6 0" stroke={ink} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/** Faint leaf / sparkle / heart motifs scattered across the activity ground. */
const DECOR: { kind: 'leaf' | 'sparkle' | 'heart'; s: number; rot: number; pos: React.CSSProperties }[] = [
  { kind: 'leaf', s: 66, rot: 12, pos: { left: '1%', bottom: '4%' } },
  { kind: 'leaf', s: 52, rot: -160, pos: { right: '3%', top: '6%' } },
  { kind: 'leaf', s: 44, rot: 200, pos: { right: '14%', bottom: '8%' } },
  { kind: 'sparkle', s: 22, rot: 0, pos: { left: '6%', top: '14%' } },
  { kind: 'sparkle', s: 15, rot: 0, pos: { left: '17%', top: '46%' } },
  { kind: 'sparkle', s: 18, rot: 0, pos: { right: '7%', top: '44%' } },
  { kind: 'sparkle', s: 13, rot: 0, pos: { left: '12%', bottom: '18%' } },
  { kind: 'heart', s: 20, rot: -8, pos: { right: '20%', bottom: '30%' } },
]

function GroundDecor() {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden', borderRadius: 24 }}>
      {DECOR.map((d, i) => (
        <span key={i} style={{ position: 'absolute', lineHeight: 0, transform: `rotate(${d.rot}deg)`, ...d.pos }}>
          {d.kind === 'leaf' && (
            <svg width={d.s} height={d.s} viewBox="0 0 24 24" fill="none">
              <path d="M21 3c0 9.4-6 15.4-13 15.4-2 0-3.8-.5-4.8-1.3C2.4 8.9 9.6 3 21 3z" fill="#2F7D5F" opacity="0.10" />
              <path d="M21 3C13.8 6.2 7.8 12.2 3.6 20.4" stroke="#2F7D5F" strokeOpacity="0.18" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          )}
          {d.kind === 'sparkle' && (
            <svg width={d.s} height={d.s} viewBox="0 0 24 24" fill="none">
              <path d="M12 1.6c.9 5.7 3.8 8.6 9.5 9.5-5.7.9-8.6 3.8-9.5 9.5-.9-5.7-3.8-8.6-9.5-9.5 5.7-.9 8.6-3.8 9.5-9.5z" fill="#5FA98A" opacity="0.26" />
            </svg>
          )}
          {d.kind === 'heart' && (
            <svg width={d.s} height={d.s} viewBox="0 0 24 24" fill="none">
              <path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3z" fill="#E8A33D" opacity="0.16" />
            </svg>
          )}
        </span>
      ))}
    </div>
  )
}

export default function EmotionalCharades({ sessionId, role, isLocked }: EmotionalCharadesProps) {
  const isTherapist = role === 'therapist'
  const canInteract = isTherapist || !isLocked

  const [mode, setMode] = useState<'identify' | 'express'>('identify')
  const [difficulty, setDifficulty] = useState<'simple' | 'standard' | 'advanced'>('standard')
  const [categories, setCategories] = useState<string[]>(['basic', 'complex', 'therapy', 'scenario'])
  const [currentCardId, setCurrentCardId] = useState<string | null>(null)
  const [score, setScore] = useState(0)
  const [cardsPlayed, setCardsPlayed] = useState(0)
  const [deckRemaining, setDeckRemaining] = useState<string[]>([])
  const [deckDrawn, setDeckDrawn] = useState<string[]>([])
  const [answerHistory, setAnswerHistory] = useState<AnswerRecord[]>([])
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null)
  const [answered, setAnswered] = useState(false)
  const [options, setOptions] = useState<EmotionCard[]>([])
  const [expressSubMode, setExpressSubMode] = useState<'child-acts' | 'therapist-acts'>('child-acts')
  /* The emoji pool offered for an Express round: the chooser picks their
     feeling from it and the guesser guesses from the same set, so the answer is
     always among the options and neither side's grid gives it away. */
  const [expressPool, setExpressPool] = useState<string[]>([])
  /* The guesser's submitted answer for the open Express round, shared through
     Firestore. It has to be shared, not local: the round's outcome is rendered
     on BOTH screens (the guesser sees the result, the chooser sees whether they
     were read correctly), and a new round has to clear it on both. While this
     lived in local `answered`/`feedback` the chooser waited forever and the
     guesser carried the previous round's reveal into the next one. '' = no
     guess yet, i.e. the round is still open. */
  const [expressGuess, setExpressGuess] = useState<string>('')
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [checkIns, setCheckIns] = useState<CheckInRecord[]>([])
  const [cardFlip, setCardFlip] = useState(false)
  const [animKey, setAnimKey] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>()
  const elapsedRef = useRef<ReturnType<typeof setInterval>>()

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

      if (typeof s.ecMode === 'string') setMode(s.ecMode)
      if (typeof s.ecDifficulty === 'string') setDifficulty(s.ecDifficulty)
      if (Array.isArray(s.ecCategories)) setCategories(s.ecCategories)
      if (typeof s.ecCurrentCard === 'string') {
        if (s.ecCurrentCard !== currentCardId) {
          setCardFlip(true)
          setTimeout(() => setCardFlip(false), 350)
        }
        setCurrentCardId(s.ecCurrentCard)
      } else if (s.ecCurrentCard === null || s.ecCurrentCard === undefined) {
        setCurrentCardId(null)
      }
      if (Array.isArray(s.ecDeckRemaining)) setDeckRemaining(s.ecDeckRemaining)
      if (Array.isArray(s.ecDeckDrawn)) setDeckDrawn(s.ecDeckDrawn)
      if (typeof s.ecScore === 'number') setScore(s.ecScore)
      if (typeof s.ecCardsPlayed === 'number') setCardsPlayed(s.ecCardsPlayed)
      if (Array.isArray(s.ecAnswerHistory)) setAnswerHistory(s.ecAnswerHistory.slice(-5))
      if (typeof s.ecExpressSubMode === 'string') setExpressSubMode(s.ecExpressSubMode)
      if (Array.isArray(s.ecExpressPool)) setExpressPool(s.ecExpressPool as string[])
      if (typeof s.ecExpressGuess === 'string') setExpressGuess(s.ecExpressGuess)
      if (Array.isArray(s.ecCheckIns)) setCheckIns(s.ecCheckIns)
    })
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const getFilteredCards = useCallback((): EmotionCard[] => {
    if (difficulty === 'simple') return CARDS.filter(c => c.category === 'basic')
    let cats = [...categories]
    if (difficulty === 'advanced' && !cats.includes('scenario')) cats.push('scenario')
    if (cats.length === 0) return [...CARDS]
    return CARDS.filter(c => cats.includes(c.category))
  }, [categories, difficulty])

  // Generate options when card changes.
  //
  // Two problems fixed here:
  //  - Distractors were drawn from ALL cards while the target came from the
  //    difficulty-filtered deck, so on 'simple' the target was the only basic
  //    emotion among complex/therapy/scenario cards — identifiable by category
  //    without reading it.
  //  - Twelve options is far too many for emotion recognition with an anxious
  //    or SLD child; comparable tasks here use 4-6.
  useEffect(() => {
    if (!currentCardId || answered) return
    const card = CARDS.find(c => c.id === currentCardId)
    if (!card) return

    const tier = getFilteredCards()
    const wanted = OPTION_COUNT[difficulty] ?? 5
    const sameTier = shuffleArray(tier.filter(c => c.id !== currentCardId))
    let distractors = sameTier.slice(0, wanted - 1)

    // Only if the chosen tier cannot fill the row (a narrow category
    // selection) do we top up from the wider deck.
    if (distractors.length < wanted - 1) {
      const used = new Set([currentCardId, ...distractors.map(c => c.id)])
      const extra = shuffleArray(CARDS.filter(c => !used.has(c.id)))
      distractors = [...distractors, ...extra.slice(0, wanted - 1 - distractors.length)]
    }

    setOptions(shuffleArray([card, ...distractors]))
  }, [currentCardId, answered, difficulty, getFilteredCards])

  // Elapsed session time for check-in
  useEffect(() => {
    const start = Date.now()
    elapsedRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 60000))
    }, 60000)
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current)
    }
  }, [])

  // Cleanup
  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
      if (elapsedRef.current) clearInterval(elapsedRef.current)
    }
  }, [])

  /**
   * Open an Express round.
   *
   * Express is no longer dealt from the deck. The person expressing chooses the
   * emotion themselves — for the child that is "how am I feeling right now?",
   * which is the point of the exercise — so this only lays out the pool and
   * clears any previous choice. The card stays empty until the chooser picks.
   */
  const handleStartExpressRound = () => {
    if (!isTherapist) return
    const tier = getFilteredCards()
    const wanted = OPTION_COUNT[difficulty] ?? 5
    const pool = shuffleArray(tier).slice(0, Math.max(3, wanted)).map(c => c.id)

    setExpressPool(pool)
    setCurrentCardId(null)
    setExpressGuess('')
    setAnswered(false)
    setFeedback(null)

    writeToFirestore({
      'moduleState.ecExpressPool': pool,
      'moduleState.ecCurrentCard': '',
      'moduleState.ecExpressGuess': '',
    })
  }

  /**
   * The chooser commits their emotion. It is written to state so the round can
   * be graded, and the guesser's side of the UI renders a face-down card for it
   * — nothing about the choice is shown to them until they have answered.
   */
  const handleChooseExpress = (cardId: string) => {
    // Only the chooser may pick, and only while the card slot is empty — the
    // guesser must never be able to write the answer they are guessing.
    if (!isExpressChooser || !canInteract || currentCardId) return
    setCurrentCardId(cardId)
    setExpressGuess('')
    setAnswered(false)
    setFeedback(null)
    writeToFirestore({ 'moduleState.ecCurrentCard': cardId, 'moduleState.ecExpressGuess': '' })
  }

  const handleDrawCard = () => {
    if (!isTherapist) return
    if (mode === 'express') {
      handleStartExpressRound()
      return
    }
    const filtered = getFilteredCards().map(c => c.id)
    let remaining = deckRemaining.length > 0 ? [...deckRemaining] : shuffleArray(filtered)
    if (remaining.length === 0) remaining = shuffleArray(filtered)
    const pick = remaining[0]
    const newRemaining = remaining.slice(1)
    const newDrawn = [...deckDrawn, pick]

    setCurrentCardId(pick)
    setDeckRemaining(newRemaining)
    setDeckDrawn(newDrawn)
    setAnswered(false)
    setFeedback(null)

    writeToFirestore({
      'moduleState.ecCurrentCard': pick,
      'moduleState.ecDeckRemaining': newRemaining,
      'moduleState.ecDeckDrawn': newDrawn,
    })
  }

  const handleShuffleDeck = () => {
    if (!isTherapist) return
    const filtered = getFilteredCards().map(c => c.id)
    const shuffled = shuffleArray(filtered)
    setDeckRemaining(shuffled)
    setDeckDrawn([])
    setCurrentCardId(null)
    setAnswered(false)
    setFeedback(null)
    setExpressGuess('')
    writeToFirestore({
      'moduleState.ecDeckRemaining': shuffled,
      'moduleState.ecDeckDrawn': [],
      'moduleState.ecCurrentCard': '',
      'moduleState.ecExpressGuess': '',
    })
  }

  const handleAnswer = (cardId: string) => {
    if (answered || !currentCardId || feedback) return
    setAnswered(true)
    const correct = cardId === currentCardId
    const record: AnswerRecord = { answer: cardId, correct, timestamp: Date.now() }
    const newHistory = [...answerHistory, record]

    if (correct) {
      setScore(prev => prev + 1)
      setFeedback('correct')
    } else {
      setFeedback('wrong')
    }
    setCardsPlayed(prev => prev + 1)
    setAnswerHistory(newHistory.slice(-5))

    writeToFirestore({
      'moduleState.ecScore': correct ? score + 1 : score,
      'moduleState.ecCardsPlayed': cardsPlayed + 1,
      'moduleState.ecLastAnswer': record,
      'moduleState.ecAnswerHistory': newHistory,
    })

    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => {
      setFeedback(null)
    }, correct ? 1000 : 1500)
  }

  /**
   * The guesser submits. This is the ONLY thing that ends an Express round and
   * the ONLY point at which it is graded — there is no reveal step, so every
   * round is played out and recorded as correct or incorrect.
   *
   * The guess is written to shared state rather than kept local so that both
   * screens resolve off the same value: the guesser sees the outcome, and the
   * chooser stops waiting and learns whether they were read correctly.
   */
  const handleAnswerExpress = (cardId: string) => {
    // Only the guesser grades the round, and only once. Guarding on the shared
    // guess (not a local flag) also makes a double-submit from a second tab a
    // no-op instead of a second score.
    if (!isExpressGuesser || !currentCardId || expressGuess) return
    setExpressGuess(cardId)
    const correct = cardId === currentCardId
    const record: AnswerRecord = { answer: cardId, correct, timestamp: Date.now() }
    const newHistory = [...answerHistory, record]

    if (correct) setScore(prev => prev + 1)
    setCardsPlayed(prev => prev + 1)
    setAnswerHistory(newHistory.slice(-5))

    writeToFirestore({
      'moduleState.ecExpressGuess': cardId,
      'moduleState.ecScore': correct ? score + 1 : score,
      'moduleState.ecCardsPlayed': cardsPlayed + 1,
      'moduleState.ecLastAnswer': record,
      'moduleState.ecAnswerHistory': newHistory,
    })
  }

  const handleCheckInResponse = (emotionId: string) => {
    const checkIn: CheckInRecord = { emotion: emotionId, timestamp: Date.now(), sessionMinute: elapsed }
    setShowCheckIn(false)
    setCheckIns(prev => [...prev, checkIn])
    writeToFirestore({
      'moduleState.ecCheckIns': arrayUnion(checkIn),
    })
    const emo = CARDS.find(c => c.id === emotionId)?.label || emotionId
    logModuleEvent(sessionId, {
      module: 'emotional-charades',
      type: 'emotion_check_in',
      detail: `Emotional check-in: reported feeling "${emo}"`,
    })
  }

  const currentCard = currentCardId ? CARDS.find(c => c.id === currentCardId) || null : null
  const showDesc = difficulty !== 'advanced' && difficulty !== 'simple'
  const deckTotal = getFilteredCards().length
  // An un-shuffled deck is stored as [] but plays as the full filtered set
  // (handleDrawCard reshuffles on empty), so show it as full rather than 0.
  const deckLeft = deckRemaining.length > 0 ? deckRemaining.length : deckTotal

  /**
   * In Identify mode the child answers by tapping an EMOJI, so the prompt card
   * must not display that same emoji — it did, alongside the answer's label,
   * which reduced the exercise to matching two identical pictures. ("It shows
   * one emoji, and the same emoji is already present in the answer options.")
   *
   * While a question is open the prompt therefore describes the feeling in
   * words instead. On 'simple' the emotion word is kept as scaffolding, so the
   * task is word -> face; on the harder tiers only the description is shown and
   * the child has to infer the feeling first. Once answered, the full card is
   * revealed as feedback.
   *
   * Express mode is unaffected: the guesser already sees a face-down card and
   * the actor is *supposed* to see the full card in order to act it out.
   */
  const identifyQuestionOpen = mode === 'identify' && !answered
  const promptShowsEmoji = !identifyQuestionOpen
  const promptShowsLabel = !identifyQuestionOpen || difficulty === 'simple'

  /* Express roles. 'child-acts' means the client chooses and expresses while
     the therapist guesses; 'therapist-acts' is the mirror. The chooser sees the
     emotion, the guesser sees a face-down card — with no way to flip it early. */
  const isExpressChooser = mode === 'express' && (
    (expressSubMode === 'child-acts' && !isTherapist) ||
    (expressSubMode === 'therapist-acts' && isTherapist)
  )
  const isExpressGuesser = mode === 'express' && !isExpressChooser
  const guesserSeesCardBack = isExpressGuesser
  const actorSeesFullCard = isExpressChooser

  /* The Express round's outcome, derived on both screens from the one shared
     guess. Until the guesser submits, `expressGuess` is '' — the round is open,
     the card stays face down, and nothing is scored. Deriving it (rather than
     reading the local `answered`/`feedback` used by Identify) is what keeps a
     finished round from bleeding into the next one on the guesser's screen. */
  const expressAnswered = mode === 'express' && !!expressGuess
  const expressFeedback: 'correct' | 'wrong' | null = expressAnswered
    ? (expressGuess === currentCardId ? 'correct' : 'wrong')
    : null

  /* Both sides work from the same pool, so the guess list always contains the
     answer and its makeup never hints at which card it is. */
  const expressCards = expressPool
    .map(id => CARDS.find(c => c.id === id))
    .filter((c): c is EmotionCard => !!c)
  const expressChoices = expressCards.length > 0 ? expressCards : options

  /* ---- Style helpers (presentation only) ---- */

  /** Mode / difficulty segment pill: mint tint + green type when selected. */
  const segPill = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 15px',
    borderRadius: 999,
    border: `1px solid ${active ? GREEN_LINE : LINE}`,
    background: active ? GREEN_SOFT : '#ffffff',
    color: active ? GREEN : INK,
    fontSize: 16.5,
    fontWeight: 700,
    lineHeight: 1.1,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: active ? 'none' : '0 1px 2px rgba(20,30,40,0.05)',
    transition: 'all 0.15s',
  })

  /** Category pill: solid green + white type when selected, outline when not. */
  const catPill = (active: boolean): React.CSSProperties => ({
    padding: '7px 16px',
    borderRadius: 999,
    border: `1px solid ${active ? GREEN : GREEN_LINE}`,
    background: active ? GREEN : '#ffffff',
    color: active ? '#ffffff' : GREEN,
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.1,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  })

  /** White secondary action (Shuffle / Check-in). */
  const ghostBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '10px 20px',
    borderRadius: 12,
    border: `1px solid ${LINE}`,
    background: '#ffffff',
    color: INK,
    fontSize: 17,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(20,30,40,0.06)',
    transition: 'all 0.15s',
  }

  const sideCard: React.CSSProperties = {
    background: '#ffffff',
    border: `1px solid ${LINE}`,
    borderRadius: 18,
    boxShadow: '0 4px 16px rgba(24,40,32,0.06)',
    padding: 14,
    position: 'relative',
    zIndex: 1,
  }

  const tipText = mode === 'express'
    ? 'Use gestures, expressions and actions to express the emotion!'
    : 'Read the clue out loud, then pick the face that matches the feeling.'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <style>{`
        @keyframes ecCardFlip {
          0% { transform: rotateY(90deg); opacity: 0; }
          100% { transform: rotateY(0deg); opacity: 1; }
        }
        @keyframes ecShake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        @keyframes ecPulse {
          0%,100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        .ec-hover:hover { border-color: ${GREEN_LINE} !important; box-shadow: 0 3px 10px rgba(31,122,68,0.13) !important; }
        .ec-opt:hover { transform: translateY(-2px); border-color: ${GREEN_LINE} !important; box-shadow: 0 6px 16px rgba(31,122,68,0.16) !important; }
        .ec-primary:hover { background: ${GREEN_DEEP} !important; }
      `}</style>

      {/* ── Settings rows (therapist only). No module title here — ModuleStage
          already renders "Emotional Charades" and the category line above. ── */}
      {isTherapist && (
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 10 }}>
          {/* Mode pair + difficulty triple */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => {
              setMode('identify')
              setExpressPool([])
              setCurrentCardId(null)
              setExpressGuess('')
              setAnswered(false)
              setFeedback(null)
              writeToFirestore({ 'moduleState.ecMode': 'identify', 'moduleState.ecExpressPool': [], 'moduleState.ecCurrentCard': '', 'moduleState.ecExpressGuess': '' })
            }} style={segPill(mode === 'identify')}>
              <span style={{ fontSize: 17.5 }}>🔍</span> Identify
            </button>
            <button onClick={() => {
              setMode('express')
              setExpressPool([])
              setCurrentCardId(null)
              setExpressGuess('')
              setAnswered(false)
              setFeedback(null)
              writeToFirestore({ 'moduleState.ecMode': 'express', 'moduleState.ecExpressPool': [], 'moduleState.ecCurrentCard': '', 'moduleState.ecExpressGuess': '' })
            }} style={segPill(mode === 'express')}>
              <span style={{ fontSize: 17.5 }}>🎭</span> Express
            </button>
            <span style={{ width: 1, height: 20, background: 'var(--glass-border)', margin: '0 4px' }} />
            {(['simple', 'standard', 'advanced'] as const).map(d => (
              <button key={d} onClick={() => {
                setDifficulty(d)
                setDeckRemaining([])
                setDeckDrawn([])
                writeToFirestore({ 'moduleState.ecDifficulty': d, 'moduleState.ecDeckRemaining': [], 'moduleState.ecDeckDrawn': [] })
              }} style={segPill(difficulty === d)}>
                {d === 'simple' ? 'Simple' : d === 'standard' ? 'Standard' : 'Advanced'}
              </button>
            ))}
          </div>

          {/* Categories */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-muted)', marginRight: 2 }}>Categories:</span>
            <button onClick={() => {
              const all = categories.length === 4
              const next = all ? [] : ['basic', 'complex', 'therapy', 'scenario']
              setCategories(next)
              setDeckRemaining([])
              setDeckDrawn([])
              writeToFirestore({ 'moduleState.ecCategories': next, 'moduleState.ecDeckRemaining': [], 'moduleState.ecDeckDrawn': [] })
            }} style={catPill(categories.length === 4)}>
              All
            </button>
            {CATEGORY_LABELS.map(cat => (
              <button key={cat.key} onClick={() => {
                const next = categories.includes(cat.key)
                  ? categories.filter(c => c !== cat.key)
                  : [...categories, cat.key]
                setCategories(next)
                setDeckRemaining([])
                setDeckDrawn([])
                writeToFirestore({ 'moduleState.ecCategories': next, 'moduleState.ecDeckRemaining': [], 'moduleState.ecDeckDrawn': [] })
              }} style={catPill(categories.includes(cat.key))}>
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Activity ground: cream, decorated, three columns ── */}
      <div style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        display: 'flex',
        alignItems: 'stretch',
        gap: 14,
        padding: 16,
        borderRadius: 24,
        background: `linear-gradient(150deg, ${CREAM} 0%, #F7F4EA 100%)`,
        border: '1px solid rgba(31,122,68,0.10)',
        overflow: 'hidden',
      }}>
        <GroundDecor />

        {/* Check-in overlay (light scrim — dark type on cream) */}
        {showCheckIn && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 20,
            background: 'rgba(251,249,242,0.97)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 20, borderRadius: 24,
          }}>
            <div style={{ fontSize: 23.5, fontWeight: 800, color: INK, marginBottom: 4, letterSpacing: -0.3 }}>
              How are you feeling right now?
            </div>
            <div style={{ fontSize: 16.5, color: 'var(--ink-muted)', marginBottom: 16 }}>
              Tap the face that fits best.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {CHECKIN_EMOTIONS.map(ce => (
                <button key={ce.id} onClick={() => handleCheckInResponse(ce.id)} className="ec-opt" style={{
                  width: 66,
                  height: 66,
                  borderRadius: 16,
                  border: `1px solid ${LINE}`,
                  background: '#ffffff',
                  boxShadow: '0 2px 8px rgba(20,30,40,0.06)',
                  cursor: 'pointer',
                  fontSize: 31.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                }}>
                  {ce.emoji}
                </button>
              ))}
            </div>
            {isTherapist && (
              <button onClick={() => setShowCheckIn(false)} style={{ ...ghostBtn, marginTop: 16, padding: '8px 20px', fontSize: 16.5 }}>
                Cancel
              </button>
            )}
          </div>
        )}

        {/* ── LEFT: deck / score card ── */}
        <aside style={{ width: 178, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: 1 }}>
          <div style={sideCard}>
            <button
              onClick={handleDrawCard}
              disabled={!isTherapist}
              className={isTherapist ? 'ec-hover' : undefined}
              style={{
                width: '100%',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                border: 'none', background: 'transparent', padding: 0,
                cursor: isTherapist ? 'pointer' : 'default',
              }}
            >
              <CardStackIcon s={54} fill={GREEN} ink={CARD_CREAM} />
              <span style={{ fontSize: 18.5, fontWeight: 800, color: INK, letterSpacing: -0.2 }}>
                {isTherapist ? 'Draw card' : 'Card deck'}
              </span>
            </button>
            <div style={{ textAlign: 'center', fontSize: 16.5, color: 'var(--ink-muted)', marginTop: 2 }}>
              {deckLeft} / {deckTotal} cards
            </div>

            {isTherapist && (
              <button onClick={() => setShowCheckIn(true)} className="ec-hover" style={{ ...ghostBtn, width: '100%', marginTop: 12, padding: '9px 10px', fontSize: 16.5 }}>
                <MessageCircle size={15} strokeWidth={2.2} color={GREEN} /> Check in
              </button>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: GREEN }}>✓ {score} correct</span>
              <span style={{ fontSize: 16, color: 'var(--ink-muted)' }}>📋 {cardsPlayed} cards</span>
            </div>

            {answerHistory.length > 0 && (
              <div style={{ display: 'flex', gap: 5, marginTop: 9, justifyContent: 'center', flexWrap: 'wrap' }}>
                {answerHistory.map((a, i) => {
                  const card = CARDS.find(c => c.id === a.answer)
                  if (!card) return null
                  return (
                    <div key={i} style={{
                      width: 24,
                      height: 24,
                      borderRadius: 8,
                      border: `1.5px solid ${a.correct ? GREEN : '#DB5A55'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      background: '#ffffff',
                      position: 'relative',
                    }}>
                      {card.emoji}
                      <span style={{
                        position: 'absolute',
                        top: -5,
                        right: -4,
                        fontSize: 12,
                        color: a.correct ? GREEN : '#DB5A55',
                        fontWeight: 800,
                      }}>
                        {a.correct ? '✓' : '✗'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        {/* ── CENTRE: the play card ── */}
        <main style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          zIndex: 1,
          background: CARD_CREAM,
          border: '1px solid rgba(31,122,68,0.09)',
          borderRadius: 22,
          boxShadow: '0 10px 30px rgba(24,40,32,0.06)',
          padding: '18px 22px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          overflowY: 'auto',
        }}>
          {/* Idle: no card drawn */}
          {!currentCardId && (
            <>
              <TheatreMasks w={136} />
              <div style={{ fontSize: 37, fontWeight: 800, color: INK, letterSpacing: -1, lineHeight: 1.1 }}>
                Ready to Play?
              </div>
              {mode === 'express' && expressPool.length > 0 ? (
                /* Express round is open but nobody has chosen yet. The chooser
                   picks their feeling from the pool; the guesser waits. Same
                   grid, same emoji, as the answer row below. */
                isExpressChooser ? (
                  <>
                    <div style={{ fontSize: 19, color: INK_SOFT, lineHeight: 1.5, textAlign: 'center', maxWidth: 460 }}>
                      Pick how you are feeling.<br />
                      Keep it to yourself and act it out — no words!
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${Math.max(expressChoices.length, 1)}, 1fr)`,
                      gap: 10,
                      width: '100%',
                      maxWidth: 76 * Math.max(expressChoices.length, 1),
                      margin: '0 auto',
                    }}>
                      {expressChoices.map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => handleChooseExpress(opt.id)}
                          disabled={!canInteract}
                          className="ec-opt"
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            borderRadius: 16,
                            border: `1px solid ${LINE}`,
                            background: '#ffffff',
                            boxShadow: '0 2px 8px rgba(20,30,40,0.06)',
                            cursor: canInteract ? 'pointer' : 'not-allowed',
                            opacity: canInteract ? 1 : 0.55,
                            fontSize: 31.5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}
                        >
                          {opt.emoji}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 18.5, color: INK_SOFT, lineHeight: 1.5, textAlign: 'center', maxWidth: 420 }}>
                    Waiting for {expressSubMode === 'child-acts' ? 'the client' : 'the therapist'} to choose an emotion…
                  </div>
                )
              ) : isTherapist ? (
                <>
                  <div style={{ fontSize: 19, color: INK_SOFT, lineHeight: 1.5, textAlign: 'center', maxWidth: 460 }}>
                    {mode === 'express'
                      ? <>Click “Start Round” to lay out the emotions.<br />The other person picks how they feel and acts it out!</>
                      : <>Click “Draw Card” to get a new emotion.<br />Act it out and let the other person guess!</>}
                  </div>
                  <button onClick={handleDrawCard} className="ec-primary" style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                    marginTop: 6,
                    padding: '15px 42px',
                    borderRadius: 14,
                    border: 'none',
                    background: GREEN,
                    color: '#ffffff',
                    fontSize: 24.5,
                    fontWeight: 800,
                    letterSpacing: -0.3,
                    cursor: 'pointer',
                    boxShadow: '0 8px 20px rgba(31,122,68,0.28)',
                    transition: 'background 0.15s',
                  }}>
                    <CardStackIcon s={26} fill="#ffffff" ink={GREEN} /> {mode === 'express' ? 'Start Round' : 'Draw Card'}
                  </button>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button onClick={handleShuffleDeck} className="ec-hover" style={ghostBtn}>
                      <Shuffle size={16} strokeWidth={2.2} color={INK} /> Shuffle
                    </button>
                    <button onClick={() => setShowCheckIn(true)} className="ec-hover" style={ghostBtn}>
                      <MessageCircle size={16} strokeWidth={2.2} color={GREEN} /> Check-in
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 18.5, color: INK_SOFT, lineHeight: 1.5, textAlign: 'center', maxWidth: 420 }}>
                  Waiting for your therapist to {mode === 'express' ? 'start a round' : 'draw a card'}…
                </div>
              )}
            </>
          )}

          {/* Card drawn */}
          {currentCard && currentCardId && (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              {/* Prompt card */}
              {guesserSeesCardBack ? (
                <div style={{
                  width: '100%',
                  maxWidth: 520,
                  background: '#ffffff',
                  border: `1.5px dashed ${GREEN_LINE}`,
                  borderRadius: 18,
                  padding: '18px 20px',
                  textAlign: 'center',
                  animation: 'ecCardFlip 0.35s ease',
                }}>
                  <div style={{ fontSize: 50.5, marginBottom: 6, lineHeight: 1 }}>❓</div>
                  <div style={{ fontSize: 17.5, color: INK_SOFT, fontStyle: 'italic' }}>
                    {expressSubMode === 'child-acts'
                      ? 'Watch the webcam — what emotion is it?'
                      : 'Watch the therapist — what feeling is it?'}
                  </div>
                  {!expressAnswered && (
                    <div style={{ fontSize: 16.5, color: 'var(--ink-muted)', marginTop: 7 }}>
                      Pick an emotion below
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  width: '100%',
                  maxWidth: 520,
                  background: `linear-gradient(135deg, ${currentCard.color}2e 0%, ${currentCard.color}12 100%)`,
                  border: `1px solid ${currentCard.color}66`,
                  borderRadius: 18,
                  padding: '18px 20px',
                  textAlign: 'center',
                  animation: cardFlip ? 'none' : 'ecCardFlip 0.35s ease',
                }}>
                  {promptShowsEmoji && (
                    <div style={{ fontSize: 58.5, marginBottom: 4, lineHeight: 1 }}>{currentCard.emoji}</div>
                  )}
                  {promptShowsLabel && (
                    <div style={{
                      fontSize: difficulty === 'simple' ? 27 : 23,
                      fontWeight: 800,
                      letterSpacing: -0.5,
                      color: INK,
                    }}>
                      {currentCard.label}
                    </div>
                  )}
                  {/* The description carries the question while the answer is
                      hidden, so it is shown prominently rather than as a footnote. */}
                  {(identifyQuestionOpen || showDesc) && (
                    <div style={{
                      fontSize: identifyQuestionOpen ? 17 : 12.5,
                      lineHeight: 1.5,
                      fontWeight: identifyQuestionOpen ? 600 : 400,
                      color: identifyQuestionOpen ? INK : INK_SOFT,
                      fontStyle: 'italic',
                      marginTop: promptShowsLabel || promptShowsEmoji ? 5 : 0,
                    }}>
                      {currentCard.desc}
                    </div>
                  )}
                  {identifyQuestionOpen && (
                    <div style={{ fontSize: 16.5, color: 'var(--ink-muted)', marginTop: 8 }}>
                      Which face matches this feeling?
                    </div>
                  )}
                </div>
              )}

              {/* Express mode instructions */}
              {actorSeesFullCard && (
                <div style={{ fontSize: 17, color: INK_SOFT, fontStyle: 'italic', textAlign: 'center' }}>
                  {isTherapist
                    ? 'Act this out on camera!'
                    : 'Act out this feeling without words!'}
                </div>
              )}

              {/* Identify response area */}
              {mode === 'identify' && !guesserSeesCardBack && (
                <div style={{ width: '100%' }}>
                  {!answered && (
                    <div style={{ fontSize: 16.5, fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 9, textAlign: 'center' }}>
                      How does this person feel?
                    </div>
                  )}

                  {feedback && (
                    <div style={{ textAlign: 'center', padding: '6px 0' }}>
                      {feedback === 'correct' ? (
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7,
                          padding: '9px 22px', borderRadius: 999,
                          background: GREEN_SOFT,
                          border: `1px solid ${GREEN_LINE}`,
                          color: GREEN, fontSize: 18.5, fontWeight: 800,
                          animation: 'ecPulse 0.5s ease 2',
                        }}>
                          ✓ That&apos;s right!
                        </div>
                      ) : (
                        <div style={{ fontSize: 17.5, color: INK_SOFT }}>
                          The feeling is <strong style={{ color: INK }}>{currentCard.label}</strong> {currentCard.emoji}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Emoji options (hidden during feedback) */}
                  {!feedback && !answered && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${Math.max(options.length, 1)}, 1fr)`,
                      gap: 10,
                      width: '100%',
                      maxWidth: 76 * Math.max(options.length, 1),
                      margin: '0 auto',
                    }}>
                      {options.map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => handleAnswer(opt.id)}
                          disabled={!canInteract}
                          className="ec-opt"
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            borderRadius: 16,
                            border: `1px solid ${LINE}`,
                            background: '#ffffff',
                            boxShadow: '0 2px 8px rgba(20,30,40,0.06)',
                            cursor: canInteract ? 'pointer' : 'not-allowed',
                            opacity: canInteract ? 1 : 0.55,
                            fontSize: 31.5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}
                        >
                          {opt.emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  {answered && !feedback && (
                    <div style={{ fontSize: 16.5, color: 'var(--ink-muted)', textAlign: 'center', marginTop: 8 }}>
                      Waiting for next card…
                    </div>
                  )}
                </div>
              )}

              {/* Express response area */}
              {mode === 'express' && guesserSeesCardBack && (
                <div style={{ width: '100%' }}>
                  {!expressAnswered && (
                    <div style={{ fontSize: 16.5, fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 9, textAlign: 'center' }}>
                      What emotion is it?
                    </div>
                  )}
                  {expressFeedback ? (
                    <div style={{ textAlign: 'center', padding: '6px 0' }}>
                      {expressFeedback === 'correct' ? (
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7,
                          padding: '9px 22px', borderRadius: 999,
                          background: GREEN_SOFT,
                          border: `1px solid ${GREEN_LINE}`,
                          color: GREEN, fontSize: 18.5, fontWeight: 800,
                        }}>
                          ✓ That&apos;s right!
                        </div>
                      ) : (
                        <div style={{ fontSize: 17.5, color: INK_SOFT }}>
                          It was <strong style={{ color: INK }}>{currentCard.label}</strong> {currentCard.emoji}
                        </div>
                      )}
                    </div>
                  ) : !expressAnswered ? (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${Math.max(expressChoices.length, 1)}, 1fr)`,
                      gap: 10,
                      width: '100%',
                      maxWidth: 76 * Math.max(expressChoices.length, 1),
                      margin: '0 auto',
                    }}>
                      {expressChoices.map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => handleAnswerExpress(opt.id)}
                          disabled={!canInteract}
                          className="ec-opt"
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            borderRadius: 16,
                            border: `1px solid ${LINE}`,
                            background: '#ffffff',
                            boxShadow: '0 2px 8px rgba(20,30,40,0.06)',
                            cursor: canInteract ? 'pointer' : 'not-allowed',
                            opacity: canInteract ? 1 : 0.55,
                            fontSize: 31.5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}
                        >
                          {opt.emoji}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Express: the chooser waits for the guess, then sees the result.
                  There is no reveal step — the round is decided by the guess. */}
              {mode === 'express' && actorSeesFullCard && (
                <div style={{ fontSize: 16.5, color: 'var(--ink-muted)', textAlign: 'center' }}>
                  {expressAnswered ? (
                    expressFeedback === 'correct'
                      ? <span style={{ color: GREEN, fontWeight: 800 }}>✓ They guessed it!</span>
                      : <span>Not guessed this time — it was <strong style={{ color: INK }}>{currentCard.label}</strong> {currentCard.emoji}</span>
                  ) : (
                    <>Waiting for {expressSubMode === 'child-acts' ? 'therapist' : 'client'} to guess…</>
                  )}
                </div>
              )}

              {/* Therapist deck actions while a card is in play */}
              {isTherapist && (
                <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
                  <button onClick={handleDrawCard} className="ec-primary" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 9,
                    padding: '11px 26px', borderRadius: 12, border: 'none',
                    background: GREEN, color: '#ffffff', fontSize: 18, fontWeight: 800,
                    cursor: 'pointer', boxShadow: '0 6px 16px rgba(31,122,68,0.26)',
                    transition: 'background 0.15s',
                  }}>
                    <CardStackIcon s={19} fill="#ffffff" ink={GREEN} /> {mode === 'express' ? 'New Round' : 'Next Card'}
                  </button>
                  <button onClick={handleShuffleDeck} className="ec-hover" style={{ ...ghostBtn, padding: '10px 18px', fontSize: 16.5 }}>
                    <Shuffle size={15} strokeWidth={2.2} color={INK} /> Shuffle
                  </button>
                  {mode === 'express' && (
                    <>
                      {(['child-acts', 'therapist-acts'] as const).map(sm => (
                        <button key={sm} onClick={() => {
                          setExpressSubMode(sm)
                          // Swapping roles mid-round would hand the card to the
                          // person who just chose it, so the round restarts.
                          setCurrentCardId(null)
                          setExpressGuess('')
                          setAnswered(false)
                          setFeedback(null)
                          writeToFirestore({
                            'moduleState.ecExpressSubMode': sm,
                            'moduleState.ecCurrentCard': '',
                            'moduleState.ecExpressGuess': '',
                          })
                        }} style={segPill(expressSubMode === sm)}>
                          {sm === 'child-acts' ? '👶 Acts → You guess' : 'You act → 👶 guesses'}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </main>

        {/* ── RIGHT: tip card ── */}
        <aside style={{ width: 196, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', zIndex: 1 }}>
          <div style={{ ...sideCard, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ flexShrink: 0, lineHeight: 0, marginTop: 1 }}>
              <Lightbulb size={22} strokeWidth={2.1} color="#E0A82E" fill="#FBE7B2" />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: INK, letterSpacing: -0.2, marginBottom: 3 }}>Tip</div>
              <div style={{ fontSize: 16.5, lineHeight: 1.45, color: INK_SOFT }}>{tipText}</div>
              {checkIns.length > 0 && (
                <div style={{ fontSize: 15.5, color: 'var(--ink-muted)', marginTop: 8 }}>
                  {checkIns.length} check-in{checkIns.length === 1 ? '' : 's'} logged
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
