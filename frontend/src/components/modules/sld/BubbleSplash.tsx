'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { Eye, Headphones, Music4, BookOpen, Sparkles, Timer, Gauge, Zap, Pause, Play } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { writeModuleState } from '@/lib/modules/writeModuleState'

interface BubbleSplashProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type Difficulty = 'easy' | 'medium' | 'hard'
type Speed = 'slow' | 'normal' | 'fast'
type WordSet = 'sight-words' | 'phonics' | 'rhymes' | 'vocabulary' | 'custom'

interface BubbleData {
  id: string
  word: string
  /** Lane centre as a percentage of the sky's width. */
  x: number
  /** How many lanes the round was laid out in; sizes the bubble to fit one. */
  lanes?: number
  size: number
  color: string
  spawnedAt: number
  isCorrect: boolean
  state: 'floating' | 'popped' | 'wrong' | 'expired'
}

interface Particle {
  id: number
  x: number
  y: number
}

/* How long a bubble takes to cross the sky. The old values gave a child under
   four seconds to read six words on Normal and two on Fast, so the speed pills
   read as "hard / harder" rather than a pace the therapist can match to the
   child. Widened so each step is clearly different and every step is readable. */
const SPEED_CONFIG: Record<Speed, { floatDuration: number }> = {
  slow: { floatDuration: 9000 },
  normal: { floatDuration: 6500 },
  fast: { floatDuration: 4000 },
}

/* How many bubbles rise together. A round now draws a random count inside the
   level's range instead of always the same number, so each set feels different. */
const DIFFICULTY_CONFIG: Record<Difficulty, { minBubbles: number; maxBubbles: number }> = {
  easy: { minBubbles: 4, maxBubbles: 5 },
  medium: { minBubbles: 5, maxBubbles: 6 },
  hard: { minBubbles: 6, maxBubbles: 7 },
}

function roundSize(difficulty: Difficulty): number {
  const { minBubbles, maxBubbles } = DIFFICULTY_CONFIG[difficulty]
  return minBubbles + Math.floor(Math.random() * (maxBubbles - minBubbles + 1))
}

/* ---------------------------------------------------------------------------
   Art assets. Delivered folder names contain spaces, so every path segment is
   encoded individually and files are painted as CSS backgrounds / plain <img>
   — next/image cannot take these paths. Same helper shape as BoxPopping and
   WorryVault.

   The delivered "Bubble splash PNG.zip" holds one PNG per WORD (bubble_the,
   bubble_see, …), so the sprites cannot stand in for the live bubbles — those
   carry whatever word the round generated. They are used as the still art on
   the idle card instead; the playing bubbles stay CSS-drawn and interactive.
--------------------------------------------------------------------------- */
const A = (f: string) => `/assets/modules/SLD/${encodeURIComponent('Bubble Splash assets')}/${encodeURIComponent(f)}`
const BG = (f: string) => `/assets/modules/Background/${encodeURIComponent(f)}`

/* Pastel lavender-to-blue sky, already carrying the mockup's clouds, drifting
   bubbles and gold stars. */
const SCENE = BG('bubble splash.png')

/* The delivered pop sound (bubble_pop.mp3, shipped inside the assets zip and
   previously unused). Lazily created so nothing touches window during SSR. */
const POP_SFX = A('bubble_pop.mp3')
let bsPop: HTMLAudioElement | null = null
function playPop(volume = 0.55) {
  try {
    if (typeof window === 'undefined') return
    if (!bsPop) bsPop = new Audio(POP_SFX)
    bsPop.volume = volume
    bsPop.currentTime = 0
    void bsPop.play()
  } catch {}
}
const IDLE_SPRITES = [A('bubble_see.png'), A('bubble_the.png'), A('bubble_go.png')]

/* Palette — this renders on a WHITE stage canvas, so every label is dark ink on
   a pale surface. White text appears ONLY on solid saturated fills (the active
   mode pill, the streak badge). */
const INK = '#151b26'
const INK_BODY = '#333c4a'
const MUTED = '#6b7280'
const BORDER = '#e7eaef'
const CARD_SHADOW = '0 1px 2px rgba(20,30,45,0.04), 0 6px 16px rgba(20,30,45,0.06)'
const GREEN = '#16A34A'
const GREEN_DEEP = '#15803D'
const VIOLET = '#7C3AED'
const AMBER = '#C2410C'

type IconCmp = LucideIcon

/* Per-mode accents, straight from the design language. */
const MODES: { key: WordSet; label: string; accent: string; Icon: IconCmp }[] = [
  { key: 'sight-words', label: 'Sight', accent: '#2563EB', Icon: Eye },
  { key: 'phonics', label: 'Phonics', accent: '#7C3AED', Icon: Headphones },
  { key: 'rhymes', label: 'Rhymes', accent: '#16A34A', Icon: Music4 },
  { key: 'vocabulary', label: 'Vocab', accent: '#EA580C', Icon: BookOpen },
  { key: 'custom', label: 'Custom', accent: '#0891B2', Icon: Sparkles },
]

const DIFFS: { key: Difficulty; label: string }[] = [
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
]

const SPEEDS: { key: Speed; label: string; accent: string; Icon: IconCmp }[] = [
  { key: 'slow', label: 'Slow', accent: '#2563EB', Icon: Timer },
  { key: 'normal', label: 'Normal', accent: '#7C3AED', Icon: Gauge },
  { key: 'fast', label: 'Fast', accent: '#E11D48', Icon: Zap },
]

/* "How it works" copy — the four category descriptions shipped verbatim in the
   delivered word_lists.json. Copy only: the module keeps its own word pools. */
const HOW_IT_WORKS: { term: string; accent: string; Icon: IconCmp; body: string }[] = [
  {
    term: 'Sight',
    accent: '#2563EB',
    Icon: Eye,
    body: 'The child identifies and taps common words that should be recognized instantly without sounding them out.',
  },
  {
    term: 'Phonics',
    accent: '#7C3AED',
    Icon: Headphones,
    body: 'The child identifies and taps words based on the target letter sound or letter combination shown on the screen.',
  },
  {
    term: 'Rhymes',
    accent: '#16A34A',
    Icon: Music4,
    body: 'The child identifies and taps words that have the same ending sound as the target word.',
  },
  {
    term: 'Vocabulary',
    accent: '#EA580C',
    Icon: BookOpen,
    body: 'The child identifies and taps words that match the given meaning, category, or concept.',
  },
]

/* Candy skins for the game objects. `pick(BUBBLE_COLORS)` still stores a plain
   string on the bubble (and in Firestore) exactly as before — it is now a key
   into CANDY rather than a raw rgba, so each bubble can be shaded into a glossy
   sphere with its own DARK word ink. */
const CANDY: Record<string, { base: string; deep: string; ink: string; glow: string }> = {
  blue: { base: '#5AA9F7', deep: '#1D4ED8', ink: '#0B2A6B', glow: 'rgba(37,99,235,0.34)' },
  green: { base: '#7BE495', deep: '#15803D', ink: '#0F4A24', glow: 'rgba(22,163,74,0.32)' },
  violet: { base: '#B08CF8', deep: '#6D28D9', ink: '#3B1580', glow: 'rgba(124,58,237,0.32)' },
  pink: { base: '#FB7BB0', deep: '#BE185D', ink: '#6E1038', glow: 'rgba(219,39,119,0.30)' },
  orange: { base: '#FDA85A', deep: '#C2410C', ink: '#6E2A08', glow: 'rgba(234,88,12,0.30)' },
  teal: { base: '#5FDCD8', deep: '#0D9488', ink: '#0A4C48', glow: 'rgba(13,148,136,0.30)' },
}
const WRONG_CANDY = { base: '#FCA5A5', deep: '#DC2626', ink: '#7F1D1D', glow: 'rgba(220,38,38,0.32)' }

const BUBBLE_COLORS = ['blue', 'green', 'violet', 'pink', 'orange', 'teal']

/* Fixed (never random) drifting specks, so server and client markup agree. */
const DRIFT: { x: number; y: number; s: number; d: number; del: number }[] = [
  { x: 12, y: 68, s: 14, d: 13, del: 0 },
  { x: 27, y: 41, s: 9, d: 16, del: 2.4 },
  { x: 46, y: 74, s: 12, d: 15, del: 1.1 },
  { x: 63, y: 33, s: 8, d: 18, del: 3.2 },
  { x: 78, y: 62, s: 15, d: 14, del: 0.8 },
  { x: 90, y: 45, s: 10, d: 17, del: 4 },
]

const SIGHT_WORDS: Record<string, string[]> = {
  easy: ['the', 'and', 'is', 'in', 'it', 'of', 'to', 'was', 'he', 'she', 'for', 'on', 'are', 'as', 'at', 'be', 'by', 'do', 'go', 'if'],
  medium: ['said', 'have', 'from', 'they', 'we', 'but', 'not', 'what', 'all', 'were', 'when', 'your', 'can', 'an', 'each', 'which'],
  hard: ['because', 'through', 'where', 'before', 'right', 'too', 'does', 'another', 'large', 'often', 'together', 'always'],
}

/* Every pool below is now graded by difficulty. Only sight words were before —
   phonics, rhymes and vocabulary all drew from one fixed pool, so Easy, Medium
   and Hard asked exactly the same questions and only changed how many bubbles
   rose. */
const PHONICS_FAMILIES: Record<Difficulty, Record<string, string[]>> = {
  easy: {
    '-at': ['cat', 'bat', 'hat', 'mat', 'rat', 'sat'],
    '-an': ['can', 'fan', 'man', 'pan', 'ran', 'van'],
    '-ig': ['big', 'dig', 'pig', 'wig', 'fig'],
    '-op': ['hop', 'mop', 'pop', 'top', 'cop'],
  },
  medium: {
    '-ell': ['bell', 'fell', 'sell', 'tell', 'well', 'shell'],
    '-ick': ['kick', 'lick', 'pick', 'sick', 'tick', 'brick'],
    '-ump': ['bump', 'jump', 'lump', 'pump', 'dump', 'stump'],
    '-and': ['band', 'hand', 'land', 'sand', 'stand', 'grand'],
  },
  hard: {
    '-ight': ['light', 'night', 'right', 'sight', 'bright', 'fight'],
    '-ing': ['bring', 'sting', 'swing', 'thing', 'spring', 'string'],
    '-tch': ['catch', 'match', 'patch', 'watch', 'pitch', 'switch'],
    '-ound': ['round', 'sound', 'found', 'ground', 'pound'],
  },
}

/* Each group needs at least two words: one becomes the CUE named in the prompt
   and a different one becomes the answer in the bubbles. */
const RHYME_GROUPS: Record<Difficulty, string[][]> = {
  easy: [
    ['cat', 'bat', 'hat', 'mat'],
    ['dog', 'log', 'fog', 'jog'],
    ['sun', 'fun', 'run', 'bun'],
    ['pig', 'big', 'dig', 'wig'],
  ],
  medium: [
    ['cake', 'lake', 'make', 'bake'],
    ['book', 'look', 'cook', 'hook'],
    ['play', 'day', 'say', 'way'],
    ['ring', 'king', 'sing', 'wing'],
  ],
  hard: [
    ['flower', 'power', 'tower', 'shower'],
    ['bright', 'night', 'flight', 'light'],
    ['station', 'nation', 'creation'],
    ['dinner', 'winner', 'thinner'],
  ],
}

const VOCABULARY: Record<Difficulty, Record<string, string[]>> = {
  easy: {
    animals: ['cat', 'dog', 'cow', 'pig', 'hen', 'duck'],
    colours: ['red', 'blue', 'green', 'pink', 'black'],
    foods: ['milk', 'rice', 'cake', 'egg', 'apple'],
  },
  medium: {
    animals: ['tiger', 'horse', 'rabbit', 'monkey', 'parrot'],
    colours: ['purple', 'orange', 'yellow', 'silver', 'brown'],
    foods: ['bread', 'cheese', 'butter', 'tomato', 'banana'],
  },
  hard: {
    animals: ['elephant', 'crocodile', 'butterfly', 'kangaroo', 'dolphin'],
    colours: ['scarlet', 'crimson', 'turquoise', 'lavender', 'emerald'],
    foods: ['spaghetti', 'pineapple', 'chocolate', 'cucumber', 'strawberry'],
  },
}

/** "animals" -> "an animal", "colours" -> "a colour". */
function categoryPhrase(cat: string): string {
  const singular = cat.replace(/s$/, '')
  return `${/^[aeiou]/.test(singular) ? 'an' : 'a'} ${singular}`
}

let bubbleIdCounter = 0

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Build one round: the prompt, the single correct word, and the words to float.
 *
 * Every mode now has exactly ONE defensible answer. Before this, three of the
 * four modes were ambiguous or gave the answer away:
 *   - sight words drew the distractors from the same list and prompted only
 *     "Pop a sight word!", so every bubble on screen satisfied the prompt;
 *   - vocabulary drew its distractors from the SAME category, so every bubble
 *     was an animal when the prompt asked for an animal;
 *   - rhymes named the correct word in the prompt itself ("rhymes with CAT"
 *     while CAT was the bubble to pop).
 * That is why the target appeared to be rising almost every time — in practice
 * most of the bubbles were valid targets. Distractors now always come from
 * outside the answer's own set, and the rhyme cue is never the answer.
 */
function generateRound(
  wordSet: WordSet,
  difficulty: Difficulty,
  customWords: string[],
  customPrompt: string
): { prompt: string; correctWord: string; allWords: string[] } {
  const count = roundSize(difficulty)
  const take = (pool: string[], n: number) => shuffle(pool).slice(0, Math.max(0, n))

  let correctWord = ''
  let prompt = ''
  let distractors: string[] = []

  if (wordSet === 'sight-words') {
    const pool = SIGHT_WORDS[difficulty] || SIGHT_WORDS.easy
    correctWord = pick(pool)
    distractors = take(pool.filter((w) => w !== correctWord), count - 1)
    // Naming the word is the point of sight-word practice: recognise it on
    // sight among others. Without it, every bubble was an equally valid answer.
    prompt = `Pop the word "${correctWord.toUpperCase()}"`
  } else if (wordSet === 'phonics') {
    const families = PHONICS_FAMILIES[difficulty]
    const familyKey = pick(Object.keys(families))
    correctWord = pick(families[familyKey])
    const others = Object.entries(families)
      .filter(([k]) => k !== familyKey)
      .flatMap(([, v]) => v)
    distractors = take(others, count - 1)
    prompt = `Pop a word from the ${familyKey} family`
  } else if (wordSet === 'rhymes') {
    const groups = RHYME_GROUPS[difficulty]
    const group = pick(groups)
    // Cue and answer are two DIFFERENT words from the same group, so the prompt
    // asks the child to hear the rhyme rather than copy the word.
    const [cue, answer] = shuffle(group)
    correctWord = answer
    const others = groups.filter((g) => g !== group).flat()
    distractors = take(others, count - 1)
    prompt = `Pop a word that rhymes with ${cue.toUpperCase()}`
  } else if (wordSet === 'vocabulary') {
    const cats = VOCABULARY[difficulty]
    const catKey = pick(Object.keys(cats))
    correctWord = pick(cats[catKey])
    const others = Object.entries(cats)
      .filter(([k]) => k !== catKey)
      .flatMap(([, v]) => v)
    distractors = take(others, count - 1)
    prompt = `Pop ${categoryPhrase(catKey)} word`
  } else {
    const words = customWords.length > 0 ? customWords : ['hello', 'world']
    correctWord = pick(words)
    distractors = take(words.filter((w) => w !== correctWord), count - 1)
    prompt = customPrompt || 'Pop the word!'
  }

  // Never float the same word twice: a duplicate of the answer would be a
  // second correct-looking bubble that scores as wrong.
  const seen = new Set([correctWord])
  const unique = distractors.filter((w) => !seen.has(w) && seen.add(w))

  return { prompt, correctWord, allWords: shuffle([correctWord, ...unique]) }
}

/**
 * Lay a round out across the sky.
 *
 * Each bubble gets its OWN vertical lane, so two bubbles can never overlap
 * however many are rising — previously every x was an independent random value
 * between 8% and 82%, which routinely stacked two bubbles on top of each other
 * and made a word unreadable. `x` is the lane centre; the renderer subtracts
 * half the drawn diameter and clamps that diameter to the lane, so the guarantee
 * holds at any board width.
 *
 * Bubbles are also staggered by a few hundred milliseconds so a set drifts up
 * as a loose group rather than a rigid row.
 */
function spawnBubbles(allWords: string[], correctWord: string, difficulty: Difficulty, now: number): BubbleData[] {
  const words = allWords.slice(0, DIFFICULTY_CONFIG[difficulty].maxBubbles)
  const lanes = words.length
  // Lane order is shuffled so the answer is not biased toward any position.
  const laneOrder = shuffle(Array.from({ length: lanes }, (_, i) => i))
  return words.map((word, i) => {
    bubbleIdCounter++
    const lane = laneOrder[i]
    return {
      id: `b${bubbleIdCounter}`,
      word,
      // Lane centre, as a percentage of the sky's width.
      x: ((lane + 0.5) / lanes) * 100,
      lanes,
      size: 56 + Math.floor(Math.random() * 14),
      color: pick(BUBBLE_COLORS),
      // A short, varied head start per lane.
      spawnedAt: now + Math.round(Math.random() * 420),
      isCorrect: word === correctWord,
      state: 'floating' as const,
    }
  })
}

export default function BubbleSplash({ sessionId, role, isLocked }: BubbleSplashProps) {
  const isTherapist = role === 'therapist'
  const canInteract = isTherapist || !isLocked

  const [isPlaying, setIsPlaying] = useState(false)
  const [wordSet, setWordSet] = useState<WordSet>('sight-words')
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [speed, setSpeed] = useState<Speed>('normal')
  const [prompt, setPrompt] = useState('')
  const [correctWord, setCorrectWord] = useState('')
  const [bubbles, setBubbles] = useState<BubbleData[]>([])
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [customWords, setCustomWords] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [showStreakBadge, setShowStreakBadge] = useState(false)
  const [streakBadgeText, setStreakBadgeText] = useState('')
  const [particles, setParticles] = useState<Particle[]>([])
  const [floatingStars, setFloatingStars] = useState<{ id: number; x: number; y: number }[]>([])
  const [waitingForTap, setWaitingForTap] = useState(true)
  // The word list for the CURRENT round, kept so the correct bubble can be
  // respawned without generating a different word.
  const [roundWords, setRoundWords] = useState<string[]>([])

  const spawnTimerRef = useRef<ReturnType<typeof setInterval>>()
  const gameRef = useRef({ isPlaying, wordSet, difficulty, speed, customWords, customPrompt, bubbles, correctWord, score, streak, roundWords, waitingForTap })
  gameRef.current = { isPlaying, wordSet, difficulty, speed, customWords, customPrompt, bubbles, correctWord, score, streak, roundWords, waitingForTap }
  // Guards the respawn so a round cannot be refilled twice while the delay runs.
  const respawnPendingRef = useRef(false)
  const starIdRef = useRef(0)
  const particleIdRef = useRef(0)

  /* The negative animation-delay that resumes a bubble mid-flight, FROZEN per
     bubble on first sight.

     This was recomputed from Date.now() on every render. The module re-renders
     several times a second (expiry sweep, round timer, Firestore snapshots), and
     each render handed the element a slightly different animationDelay, so the
     browser restarted the rise from a new offset every time — the stutter that
     made the bubbles look like they were lagging. Frozen, the value never
     changes after mount, React writes nothing to the style, and the CSS
     animation runs uninterrupted on the compositor. */
  const delayRef = useRef<Record<string, number>>({})

  /* Sky size, so a bubble can rise the full height of whatever board it is on
     and be sized to fit its lane. */
  const skyRef = useRef<HTMLDivElement>(null)
  const [sky, setSky] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = skyRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSky((prev) =>
        Math.abs(prev.w - width) < 2 && Math.abs(prev.h - height) < 2
          ? prev
          : { w: width, h: height }
      )
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Shared helper: same liveSessions write as before, but a failure is reported
  // instead of vanishing into an empty catch.
  const writeToFirestore = useCallback(
    (data: Record<string, unknown>) => writeModuleState(sessionId, data, { label: 'BubbleSplash' }),
    [sessionId]
  )

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      const s = data.moduleState || {}
      if (typeof s.bsIsPlaying === 'boolean') setIsPlaying(s.bsIsPlaying)
      if (typeof s.bsWordSet === 'string') setWordSet(s.bsWordSet as WordSet)
      if (typeof s.bsDifficulty === 'string') setDifficulty(s.bsDifficulty as Difficulty)
      if (typeof s.bsSpeed === 'string') setSpeed(s.bsSpeed as Speed)
      if (typeof s.bsPrompt === 'string') setPrompt(s.bsPrompt)
      if (typeof s.bsCorrectWord === 'string') setCorrectWord(s.bsCorrectWord)
      if (Array.isArray(s.bsBubbles)) setBubbles(s.bsBubbles as BubbleData[])
      if (Array.isArray(s.bsRoundWords)) setRoundWords(s.bsRoundWords as string[])
      if (typeof s.bsScore === 'number') setScore(s.bsScore)
      if (typeof s.bsStreak === 'number') setStreak(s.bsStreak)
      if (typeof s.bsCustomWords === 'string') setCustomWords(s.bsCustomWords)
      if (typeof s.bsCustomPrompt === 'string') setCustomPrompt(s.bsCustomPrompt)
    })
    return () => unsub()
  }, [sessionId])

  /**
   * Begin a NEW round: a fresh prompt, a new target word, and one fixed batch of
   * bubbles (target + distractors, sized by difficulty).
   *
   * Only called when a round genuinely ends — on Start and after a correct tap.
   * It used to be driven by the spawn timer as well, which regenerated the
   * prompt and target roughly once a second: the word the child was being asked
   * to find kept changing mid-read, and every bubble was reset to below the
   * canvas, so the activity was effectively unplayable.
   */
  const startNewRound = useCallback(() => {
    const { wordSet, difficulty, customWords, customPrompt } = gameRef.current
    const { prompt: p, correctWord: cw, allWords } = generateRound(wordSet, difficulty, customWords.split(',').map(s => s.trim()).filter(Boolean), customPrompt)
    setPrompt(p)
    setCorrectWord(cw)
    setRoundWords(allWords)
    const now = Date.now()
    const newBubbles = spawnBubbles(allWords, cw, difficulty, now)
    setBubbles(newBubbles)
    setWaitingForTap(true)
    respawnPendingRef.current = false
    writeToFirestore({
      'moduleState.bsPrompt': p,
      'moduleState.bsCorrectWord': cw,
      'moduleState.bsRoundWords': allWords,
      'moduleState.bsBubbles': newBubbles.map(b => ({ ...b, spawnedAt: now })),
    })
  }, [writeToFirestore])

  /**
   * Refill the SAME round: identical prompt and target word, a fresh batch of
   * bubbles. Used when the target floated off before the child reached it, so a
   * missed bubble costs a little time rather than the answer, matching the
   * non-punishing approach used elsewhere in the app.
   */
  const respawnRound = useCallback(() => {
    const { correctWord: cw, roundWords, difficulty } = gameRef.current
    if (!cw || roundWords.length === 0) return
    const now = Date.now()
    const refreshed = spawnBubbles(roundWords, cw, difficulty, now)
    setBubbles(refreshed)
    setWaitingForTap(true)
    respawnPendingRef.current = false
    writeToFirestore({
      'moduleState.bsBubbles': refreshed.map(b => ({ ...b, spawnedAt: now })),
    })
  }, [writeToFirestore])

  /**
   * Keeps the current round alive. Deliberately does NOT top up bubbles
   * continuously: each round is a fixed, readable set (target + distractors) so
   * a child who needs longer to decode a word is not facing an endless stream.
   *
   * Therapist-driven, like every other timed module here — otherwise both
   * browsers would refill the round independently and fight over Firestore.
   */
  const maintainRound = useCallback(() => {
    const { isPlaying, bubbles, correctWord, waitingForTap, roundWords } = gameRef.current
    if (!isPlaying || respawnPendingRef.current) return

    // Play state can be restored from Firestore with no usable round attached —
    // e.g. a session left running, or state written before the round word list
    // was persisted. Start a fresh round rather than sitting on a blank canvas.
    if (!correctWord || roundWords.length === 0) {
      respawnPendingRef.current = true
      setTimeout(() => {
        respawnPendingRef.current = false
        if (gameRef.current.isPlaying) startNewRound()
      }, 150)
      return
    }

    if (!waitingForTap) return

    // The batch is recycled as a WHOLE. Bubbles float off the top and are swept
    // as they expire; refreshing only the target would leave the child staring
    // at a single correct answer with no distractors, and refreshing nothing
    // would dead-end the round. Keeping the set intact means the choice stays
    // the same size and equally readable every time it comes round again.
    const expected = Math.min(roundWords.length, DIFFICULTY_CONFIG[gameRef.current.difficulty].maxBubbles)
    const floating = bubbles.filter((b) => b.state === 'floating').length
    if (floating >= expected) return

    respawnPendingRef.current = true
    setTimeout(() => {
      respawnPendingRef.current = false
      if (gameRef.current.isPlaying && gameRef.current.waitingForTap) respawnRound()
    }, 700)
  }, [respawnRound, startNewRound])

  useEffect(() => {
    if (!isPlaying || !isTherapist) {
      if (spawnTimerRef.current) {
        clearInterval(spawnTimerRef.current)
        spawnTimerRef.current = undefined
      }
      return
    }

    spawnTimerRef.current = setInterval(maintainRound, 400)

    return () => {
      if (spawnTimerRef.current) clearInterval(spawnTimerRef.current)
    }
  }, [isPlaying, isTherapist, maintainRound])

  /* Sweeps bubbles that have floated off the top.

     Deliberately local: both browsers hold the same spawnedAt values and the
     same speed, so both expire the same bubbles at the same moment with no
     traffic. It used to publish the whole array to Firestore twice a second,
     and every echo back re-set React state and re-rendered every bubble.

     Returning `prev` unchanged when nothing expired matters just as much —
     `filter` always allocates a new array, so this fired a state update (and a
     full re-render) every 500ms even when the board was untouched. */
  const removeExpiredBubbles = useCallback(() => {
    setBubbles((prev) => {
      const duration = SPEED_CONFIG[gameRef.current.speed].floatDuration
      const now = Date.now()
      const next = prev.filter((b) => b.state !== 'floating' || now - b.spawnedAt < duration)
      return next.length === prev.length ? prev : next
    })
  }, [])

  useEffect(() => {
    if (!isPlaying) return
    const interval = setInterval(removeExpiredBubbles, 500)
    return () => clearInterval(interval)
  }, [isPlaying, removeExpiredBubbles])

  // Frozen animation offsets belong to bubbles that are gone once a round is
  // swept or replaced; drop them so the map tracks the board.
  useEffect(() => {
    const live = new Set(bubbles.map((b) => b.id))
    for (const id of Object.keys(delayRef.current)) {
      if (!live.has(id)) delete delayRef.current[id]
    }
  }, [bubbles])

  useEffect(() => {
    return () => {
      if (spawnTimerRef.current) clearInterval(spawnTimerRef.current)
    }
  }, [])

  const triggerParticles = (x: number, y: number) => {
    for (let i = 0; i < 6; i++) {
      const id = particleIdRef.current++
      setParticles((prev) => [...prev, { id, x, y }])
      setTimeout(() => {
        setParticles((prev) => prev.filter((p) => p.id !== id))
      }, 500)
    }
  }

  const triggerStar = (x: number, y: number) => {
    const id = starIdRef.current++
    setFloatingStars((prev) => [...prev, { id, x, y }])
    setTimeout(() => setFloatingStars((prev) => prev.filter((s) => s.id !== id)), 1600)
  }

  const handleBubbleTap = (bubble: BubbleData) => {
    if (!canInteract || !isPlaying || bubble.state !== 'floating' || !waitingForTap) return

    if (bubble.isCorrect) {
      const newScore = score + 1
      const newStreak = streak + 1
      setScore(newScore)
      setStreak(newStreak)
      setWaitingForTap(false)

      setBubbles((prev) => {
        const next = prev.map((b) => b.id === bubble.id ? { ...b, state: 'popped' as const } : b)
        writeToFirestore({
          'moduleState.bsBubbles': next,
          'moduleState.bsScore': newScore,
          'moduleState.bsStreak': newStreak,
        })
        return next
      })

      playPop()
      triggerParticles(bubble.x, 50)
      triggerStar(bubble.x, 50)

      if (newStreak === 3) {
        setStreakBadgeText('🔥 On a roll!')
        setShowStreakBadge(true)
        setTimeout(() => setShowStreakBadge(false), 2000)
      }
      if (newStreak >= 5) {
        triggerStar(30, 40)
        setTimeout(() => triggerStar(70, 30), 100)
      }

      setTimeout(() => startNewRound(), 600)
    } else {
      // Same pop, quieter — the tap is acknowledged, the bounce says "not that one".
      playPop(0.28)
      setStreak(0)
      setStreakBadgeText('')
      setShowStreakBadge(false)
      writeToFirestore({ 'moduleState.bsStreak': 0 })

      setBubbles((prev) => {
        const next = prev.map((b) => b.id === bubble.id ? { ...b, state: 'wrong' as const } : b)
        writeToFirestore({ 'moduleState.bsBubbles': next })
        return next
      })

      setTimeout(() => {
        setBubbles((prev) => {
          const next = prev.map((b) => b.id === bubble.id ? { ...b, state: 'floating' as const } : b)
          writeToFirestore({ 'moduleState.bsBubbles': next })
          return next
        })
      }, 500)
    }
  }

  const handleTogglePlaying = () => {
    const next = !isPlaying
    setIsPlaying(next)
    writeToFirestore({ 'moduleState.bsIsPlaying': next })

    if (!next) {
      // Stopping clears the round. A leftover prompt in Firestore used to keep
      // rendering "Pop a sight word!" over an empty canvas next to a Start
      // button, implying an activity was live when it was not.
      setPrompt('')
      setCorrectWord('')
      setRoundWords([])
      setBubbles([])
      setWaitingForTap(true)
      respawnPendingRef.current = false
      writeToFirestore({
        'moduleState.bsPrompt': '',
        'moduleState.bsCorrectWord': '',
        'moduleState.bsRoundWords': [],
        'moduleState.bsBubbles': [],
      })
    }

    if (!next && score > 0 && isTherapist) {
      logModuleEvent(sessionId, {
        module: 'bubble-splash',
        type: 'practice_summary',
        detail: `Reading Bubbles practice (${wordSet}): ${score} bubble${score === 1 ? '' : 's'} popped correctly`,
      })
    }

    if (next) {
      // Stopping always clears the round, so starting always begins a fresh one.
      startNewRound()
    }
  }

  const handleWordSetChange = (ws: WordSet) => {
    setWordSet(ws)
    setPrompt('')
    setCorrectWord('')
    setRoundWords([])
    setBubbles([])
    respawnPendingRef.current = false
    writeToFirestore({
      'moduleState.bsWordSet': ws,
      'moduleState.bsPrompt': '',
      'moduleState.bsCorrectWord': '',
      'moduleState.bsRoundWords': [],
      'moduleState.bsBubbles': [],
    })
  }

  const handleDifficultyChange = (d: Difficulty) => {
    setDifficulty(d)
    setBubbles([])
    writeToFirestore({
      'moduleState.bsDifficulty': d,
      'moduleState.bsBubbles': [],
    })
  }

  const handleSpeedChange = (s: Speed) => {
    setSpeed(s)
    writeToFirestore({ 'moduleState.bsSpeed': s })
  }

  const handleCustomWordsChange = (val: string) => {
    setCustomWords(val)
    writeToFirestore({ 'moduleState.bsCustomWords': val })
  }

  const handleCustomPromptChange = (val: string) => {
    setCustomPrompt(val)
    writeToFirestore({ 'moduleState.bsCustomPrompt': val })
  }

  const floatDur = SPEED_CONFIG[speed].floatDuration

  /* ---- Shared control styles ---------------------------------------------
     Every pill carries a 2px border so switching state never nudges the row,
     and every one is a comfortable ~42px tap target.
  ------------------------------------------------------------------------- */
  const settingCursor: React.CSSProperties['cursor'] = isTherapist ? 'pointer' : 'default'

  const modePill = (accent: string, on: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 9,
    padding: '10px 19px',
    borderRadius: 999,
    border: `2px solid ${on ? accent : `${accent}33`}`,
    background: on ? accent : '#ffffff',
    color: on ? '#ffffff' : accent,
    fontSize: 17.5,
    fontWeight: 700,
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
    cursor: settingCursor,
    boxShadow: on ? `0 6px 16px ${accent}47` : CARD_SHADOW,
    opacity: isTherapist ? 1 : 0.85,
    transition: 'all 0.16s ease',
  })

  const diffPill = (on: boolean): React.CSSProperties => ({
    padding: '10px 22px',
    borderRadius: 999,
    border: `2px solid ${on ? '#BBE7CC' : 'transparent'}`,
    background: on ? '#E7F7EE' : '#F3F5F8',
    color: on ? GREEN_DEEP : MUTED,
    fontSize: 17.5,
    fontWeight: 700,
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
    cursor: settingCursor,
    boxShadow: on ? '0 4px 12px rgba(22,163,74,0.16)' : 'none',
    opacity: isTherapist ? 1 : 0.85,
    transition: 'all 0.16s ease',
  })

  const speedPill = (accent: string, on: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 18px',
    borderRadius: 999,
    border: `2px solid ${on ? accent : BORDER}`,
    background: on ? `${accent}12` : '#ffffff',
    color: on ? accent : INK_BODY,
    fontSize: 17.5,
    fontWeight: 700,
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
    cursor: settingCursor,
    boxShadow: on ? `0 4px 12px ${accent}26` : CARD_SHADOW,
    opacity: isTherapist ? 1 : 0.85,
    transition: 'all 0.16s ease',
  })

  const divider = (
    <span aria-hidden style={{ width: 2, height: 30, borderRadius: 2, background: BORDER, flexShrink: 0 }} />
  )

  const card: React.CSSProperties = {
    borderRadius: 20,
    border: `1px solid ${BORDER}`,
    background: '#ffffff',
    boxShadow: CARD_SHADOW,
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: '#ffffff',
    color: INK,
    fontSize: 16.5,
    fontWeight: 600,
    outline: 'none',
  }

  return (
    <>
      <style>{`
        @keyframes bsIdleBob {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-8px); }
        }
        @keyframes bsDrift {
          0%   { transform: translateY(12px) translateX(0); opacity: 0; }
          15%  { opacity: 0.75; }
          85%  { opacity: 0.6; }
          100% { transform: translateY(-90px) translateX(14px); opacity: 0; }
        }
        .bs-input::placeholder { color:#9aa3ad; font-weight: 500; }
        .bs-input:focus { border-color:${VIOLET}; box-shadow:0 0 0 3px rgba(124,58,237,0.14); }
        .bs-scroll { scrollbar-width: thin; scrollbar-color:#d7dde3 transparent; }
        .bs-scroll::-webkit-scrollbar { width:6px; }
        .bs-scroll::-webkit-scrollbar-thumb { background:#d7dde3; border-radius:999px; }
        /* Rises by --rise, set per bubble from the measured sky height, so a
           bubble always clears the top instead of stalling at a fixed 400px and
           fading in mid-air on a taller board. Linear: a bubble rising through
           water does not ease in and out. */
        @keyframes bsFloatUp {
          0%   { transform: translateY(0) scale(1); opacity: 0; }
          6%   { opacity: 1; }
          88%  { opacity: 1; }
          100% { transform: translateY(var(--rise, -420px)) scale(0.97); opacity: 0; }
        }
        @keyframes bsPop {
          0%   { transform: scale(1); opacity: 1; }
          40%  { transform: scale(1.4); opacity: 0.8; }
          100% { transform: scale(0); opacity: 0; }
        }
        @keyframes bsWrongBounce {
          0%,100% { transform: scale(1); }
          30%     { transform: scale(0.85); }
          60%     { transform: scale(1.1); }
        }
        @keyframes bsSplash {
          0%   { transform: translate(0,0) scale(1); opacity: 1; }
          100% { transform: translate(var(--dx),var(--dy)) scale(0); opacity: 0; }
        }
        @keyframes bsFloatStar {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-90px) scale(1.5); }
        }
        @keyframes bsFadeUp {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes bsStreakBadge {
          0% { opacity: 0; transform: translateY(6px); }
          15% { opacity: 1; transform: translateY(0); }
          75% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          // Belt and braces: in a BLOCK parent (GlassModulePanel's .gm-canvas)
          // `height: 100%` can resolve to auto and collapse the module to 0px.
          minHeight: 560,
          gap: 16,
          userSelect: 'none',
          fontFamily: '"DM Sans", system-ui, sans-serif',
        }}
      >
        {/* ---- CONTROL BAR ------------------------------------------------
            White pills on a white canvas, so each one carries its own border
            and its mode accent. Settings stay therapist-only: the client sees
            the live state, but every button is inert for them.
        ------------------------------------------------------------------- */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            rowGap: 14,
            flexWrap: 'wrap',
          }}
        >
          {MODES.map((m) => {
            const on = wordSet === m.key
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => { if (isTherapist) handleWordSetChange(m.key) }}
                disabled={!isTherapist}
                aria-pressed={on}
                title={`${m.label} words`}
                style={modePill(m.accent, on)}
              >
                <m.Icon size={17} strokeWidth={2.4} color={on ? '#ffffff' : m.accent} />
                {m.label}
              </button>
            )
          })}

          {divider}

          {DIFFS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => { if (isTherapist) handleDifficultyChange(d.key) }}
              disabled={!isTherapist}
              aria-pressed={difficulty === d.key}
              style={diffPill(difficulty === d.key)}
            >
              {d.label}
            </button>
          ))}

          {/* Pushes the speed group and Pause to the right edge, as in the mockup. */}
          <span aria-hidden style={{ flex: '1 1 24px' }} />

          {SPEEDS.map((s) => {
            const on = speed === s.key
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => { if (isTherapist) handleSpeedChange(s.key) }}
                disabled={!isTherapist}
                aria-pressed={on}
                title={`${s.label} float speed`}
                style={speedPill(s.accent, on)}
              >
                <s.Icon size={16} strokeWidth={2.4} color={s.accent} />
                {s.label}
              </button>
            )
          })}

          {divider}

          <button
            type="button"
            onClick={() => { if (isTherapist) handleTogglePlaying() }}
            disabled={!isTherapist}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 9,
              padding: '10px 24px',
              borderRadius: 999,
              border: `2px solid ${isPlaying ? '#F6D6AE' : '#BBE7CC'}`,
              background: isPlaying ? '#FFF6EC' : '#E7F7EE',
              color: isPlaying ? AMBER : GREEN_DEEP,
              fontSize: 17.5,
              fontWeight: 700,
              lineHeight: 1.15,
              whiteSpace: 'nowrap',
              cursor: settingCursor,
              opacity: isTherapist ? 1 : 0.85,
              boxShadow: isPlaying ? '0 4px 12px rgba(194,65,12,0.18)' : '0 4px 12px rgba(22,163,74,0.16)',
              transition: 'all 0.16s ease',
            }}
          >
            {isPlaying
              ? <><Pause size={16} strokeWidth={2.6} color={AMBER} /> Pause</>
              : <><Play size={16} strokeWidth={2.6} color={GREEN_DEEP} /> Start</>}
          </button>
        </div>

        {/* ---- Explainer column + sky ---- */}
        <div style={{ flex: 1, minHeight: 460, display: 'flex', gap: 16 }}>
          <aside
            className="bs-scroll"
            style={{
              width: 'clamp(232px, 26%, 308px)',
              flexShrink: 0,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              paddingRight: 2,
            }}
          >
            {/* "How it works" — the four category descriptions shipped in the
                delivered word_lists.json, used as copy only. */}
            <div style={{ ...card, padding: 18, flexShrink: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  paddingBottom: 14,
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                <BookOpen size={18} strokeWidth={2.4} color={VIOLET} />
                <span style={{ fontSize: 18.5, fontWeight: 800, color: VIOLET, letterSpacing: -0.2 }}>
                  How it works
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16 }}>
                {HOW_IT_WORKS.map((h) => (
                  <div key={h.term} style={{ display: 'flex', gap: 11 }}>
                    <span aria-hidden style={{ flexShrink: 0, marginTop: 2, lineHeight: 0 }}>
                      <h.Icon size={17} strokeWidth={2.3} color={h.accent} />
                    </span>
                    <p style={{ margin: 0, fontSize: 16.5, fontWeight: 600, lineHeight: 1.6, color: INK_BODY }}>
                      <span style={{ fontWeight: 800, color: h.accent }}>{h.term}:</span> {h.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom set-up moves off the control bar and into the column, so
                the bar keeps the mockup's single clean row. */}
            {isTherapist && wordSet === 'custom' && (
              <div style={{ ...card, padding: 18, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Sparkles size={17} strokeWidth={2.4} color="#0891B2" />
                  <span style={{ fontSize: 17.5, fontWeight: 800, color: '#0E7490' }}>Custom words</span>
                </div>
                <input
                  className="bs-input"
                  value={customWords}
                  onChange={(e) => handleCustomWordsChange(e.target.value)}
                  placeholder="Comma-separated words"
                  style={inputStyle}
                />
                <input
                  className="bs-input"
                  value={customPrompt}
                  onChange={(e) => handleCustomPromptChange(e.target.value)}
                  placeholder="Custom prompt text"
                  style={inputStyle}
                />
              </div>
            )}

            <div style={{ ...card, padding: 18, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 16.5, fontWeight: 600, color: MUTED }}>💧 Bubbles popped</span>
                <span style={{ fontSize: 20.5, fontWeight: 800, color: INK, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 16.5, fontWeight: 600, color: MUTED }}>⚡ In a row</span>
                <span style={{ fontSize: 20.5, fontWeight: 800, color: GREEN_DEEP, fontVariantNumeric: 'tabular-nums' }}>{streak}</span>
              </div>
            </div>

            {!canInteract && (
              <div style={{ flexShrink: 0, fontSize: 16, fontWeight: 600, color: MUTED, textAlign: 'center', padding: '2px 6px 6px' }}>
                Your therapist is controlling this activity
              </div>
            )}
          </aside>

          {/* ---- Pastel sky. The delivered scene already carries the clouds,
              gold stars and drifting bubbles, so it is painted as a covering
              background with a gradient underneath it as the fallback. ---- */}
          <div
            ref={skyRef}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              position: 'relative',
              borderRadius: 24,
              border: `1px solid ${BORDER}`,
              boxShadow: CARD_SHADOW,
              // Every bubble is absolutely positioned, so this box has no
              // intrinsic height. The row above gives it a real floor rather
              // than relying on `flex: 1` inside a block parent, which used to
              // collapse it to 0px and clip every bubble.
              overflow: 'hidden',
              backgroundColor: '#eaeefb',
              backgroundImage: `url("${SCENE}"), linear-gradient(165deg,#e9f1ff 0%,#efe7fb 55%,#fdeef8 100%)`,
              backgroundSize: 'cover, cover',
              backgroundPosition: 'center center, center center',
              backgroundRepeat: 'no-repeat, no-repeat',
            }}
          >
            {/* Small drifting bubbles — fixed coordinates, never random, so the
                server and client markup agree. */}
            {DRIFT.map((d, i) => (
              <span
                key={i}
                aria-hidden
                style={{
                  position: 'absolute',
                  left: `${d.x}%`,
                  top: `${d.y}%`,
                  width: d.s,
                  height: d.s,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95), rgba(255,255,255,0.22) 62%, rgba(255,255,255,0) 74%)',
                  border: '1px solid rgba(255,255,255,0.72)',
                  animation: `bsDrift ${d.d}s linear ${d.del}s infinite`,
                  pointerEvents: 'none',
                }}
              />
            ))}

            {/* Prompt for the round */}
            {isPlaying && prompt && (
              <div
                style={{
                  position: 'absolute',
                  top: 18,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  maxWidth: 'calc(100% - 40px)',
                  padding: '11px 22px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.94)',
                  border: `1px solid ${BORDER}`,
                  boxShadow: '0 6px 18px rgba(20,30,45,0.12)',
                  fontSize: 17.5,
                  fontWeight: 700,
                  color: INK,
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  animation: 'bsFadeUp 0.3s ease',
                  zIndex: 8,
                  pointerEvents: 'none',
                }}
              >
                {prompt}
              </div>
            )}

            {isPlaying && bubbles.map((bubble) => {
              // Frozen on first sight; see delayRef above.
              let animDelay = delayRef.current[bubble.id]
              if (animDelay === undefined) {
                animDelay = -Math.min(Date.now() - bubble.spawnedAt, floatDur) / 1000
                delayRef.current[bubble.id] = animDelay
              }

              let animName = 'bsFloatUp'
              let animDuration = `${floatDur}ms`
              let animFill = 'forwards'
              let candy = CANDY[bubble.color] || CANDY.blue
              let opacity = 1
              let pointerStyle: React.CSSProperties = {}

              if (bubble.state === 'popped') {
                animName = 'bsPop'
                animDuration = '0.3s'
                animFill = 'forwards'
                pointerStyle = { pointerEvents: 'none' as const }
              } else if (bubble.state === 'wrong') {
                animName = 'bsWrongBounce'
                animDuration = '0.4s'
                animFill = 'forwards'
                candy = WRONG_CANDY
                pointerStyle = { pointerEvents: 'none' as const }
              } else if (bubble.state === 'expired') {
                opacity = 0
                pointerStyle = { pointerEvents: 'none' as const }
              }

              /* Rendered diameter, clamped to this browser's lane width so two
                 bubbles can never touch even if the sky is narrower here than on
                 the screen that dealt the round. */
              const lanes = bubble.lanes ?? Math.max(1, bubbles.length)
              const laneW = sky.w > 0 ? sky.w / lanes : 0
              const px = Math.max(
                44,
                Math.round(laneW > 0 ? Math.min(bubble.size * 1.42, laneW * 0.86) : bubble.size * 1.42)
              )
              // Big, bold ink, stepped down only far enough that a long word
              // still fits inside its bubble.
              const wordSize = Math.max(
                13,
                Math.min(Math.round(px * 0.28), Math.round((px * 1.42) / Math.max(2, bubble.word.length)))
              )

              return (
                <div
                  key={bubble.id}
                  onClick={() => handleBubbleTap(bubble)}
                  style={{
                    position: 'absolute',
                    // `x` is the lane CENTRE, so half the diameter comes back off.
                    left: `calc(${bubble.x}% - ${px / 2}px)`,
                    bottom: -px,
                    width: px,
                    height: px,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    ['--rise' as string]: `${-(sky.h + px + 60)}px`,
                    animation: `${animName} ${animDuration} ${bubble.state === 'floating' ? 'linear' : 'ease-in-out'} ${animFill}`,
                    animationDelay: bubble.state === 'floating' ? `${animDelay}s` : '0s',
                    willChange: 'transform',
                    cursor: canInteract && isPlaying && bubble.state === 'floating' && waitingForTap ? 'pointer' : 'default',
                    opacity,
                    zIndex: bubble.state === 'popped' ? 6 : 3,
                    ...pointerStyle,
                  }}
                >
                  {/* Jet trail under the bubble */}
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: '86%',
                      left: '50%',
                      width: Math.round(px * 0.46),
                      height: Math.round(px * 0.95),
                      transform: 'translateX(-50%)',
                      borderRadius: '50% 50% 46% 46% / 18% 18% 82% 82%',
                      background: `linear-gradient(180deg, ${candy.glow} 0%, rgba(255,255,255,0.62) 34%, rgba(255,255,255,0) 100%)`,
                      filter: 'blur(3px)',
                      opacity: 0.9,
                      pointerEvents: 'none',
                    }}
                  />
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: '108%',
                      left: '46%',
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,0.9)',
                      pointerEvents: 'none',
                    }}
                  />
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: '132%',
                      left: '56%',
                      width: 3,
                      height: 3,
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,0.75)',
                      pointerEvents: 'none',
                    }}
                  />

                  {/* Glossy sphere */}
                  <span
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: '100%',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `radial-gradient(circle at 33% 26%, #ffffff 0%, rgba(255,255,255,0.88) 11%, ${candy.base}D9 47%, ${candy.deep}F0 100%)`,
                      border: '1px solid rgba(255,255,255,0.7)',
                      boxShadow: `inset 0 -9px 18px rgba(0,0,0,0.10), inset 0 7px 14px rgba(255,255,255,0.45), 0 10px 22px ${candy.glow}`,
                    }}
                  >
                    {/* Specular highlight */}
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        top: '12%',
                        left: '19%',
                        width: '30%',
                        height: '21%',
                        borderRadius: '50%',
                        background: 'rgba(255,255,255,0.95)',
                        transform: 'rotate(-26deg)',
                        pointerEvents: 'none',
                      }}
                    />
                    {/* The word — DARK ink on the bubble fill, never white on pale. */}
                    <span
                      style={{
                        position: 'relative',
                        zIndex: 1,
                        fontSize: wordSize,
                        fontWeight: 800,
                        letterSpacing: -0.3,
                        color: candy.ink,
                        textShadow: '0 1px 0 rgba(255,255,255,0.55)',
                        textAlign: 'center',
                        padding: '0 6px',
                        lineHeight: 1.15,
                        pointerEvents: 'none',
                        wordBreak: 'break-word',
                      }}
                    >
                      {bubble.word}
                    </span>
                  </span>

                  {/* Splash particles */}
                  {bubble.state === 'popped' && particles.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        position: 'absolute',
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: candy.deep,
                        left: '50%',
                        top: '50%',
                        animation: 'bsSplash 0.5s ease forwards',
                        '--dx': `${(Math.random() - 0.5) * 60}px`,
                        '--dy': `${(Math.random() - 0.5) * 60}px`,
                      } as React.CSSProperties}
                    />
                  ))}
                </div>
              )
            })}

            {/* Floating stars */}
            {floatingStars.map((star) => (
              <div
                key={star.id}
                style={{
                  position: 'absolute',
                  left: `${star.x}%`,
                  top: `${star.y}%`,
                  fontSize: 30,
                  zIndex: 10,
                  pointerEvents: 'none',
                  animation: 'bsFloatStar 1.4s ease forwards',
                }}
              >
                ⭐
              </div>
            ))}

            {/* Streak badge — white type only on a solid saturated fill. */}
            {showStreakBadge && (
              <div
                style={{
                  position: 'absolute',
                  top: 74,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: 16.5,
                  fontWeight: 800,
                  color: '#ffffff',
                  background: GREEN,
                  padding: '9px 20px',
                  borderRadius: 999,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 8px 20px rgba(22,163,74,0.34)',
                  animation: 'bsStreakBadge 2s ease forwards',
                  zIndex: 12,
                  pointerEvents: 'none',
                }}
              >
                {streakBadgeText}
              </div>
            )}

            {/* Idle card — the delivered sprites are word-locked art, so they
                sit here rather than standing in for live bubbles. */}
            {!isPlaying && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 24,
                  zIndex: 14,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 18,
                    padding: '26px 34px 28px',
                    borderRadius: 24,
                    maxWidth: 430,
                    textAlign: 'center',
                    background: 'rgba(255,255,255,0.93)',
                    border: `1px solid ${BORDER}`,
                    boxShadow: '0 14px 36px rgba(20,30,45,0.14)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
                    {IDLE_SPRITES.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={src}
                        src={src}
                        alt=""
                        aria-hidden
                        style={{
                          width: [66, 84, 62][i],
                          height: 'auto',
                          display: 'block',
                          animation: `bsIdleBob 3.${i}s ease-in-out infinite`,
                          animationDelay: `${i * 0.35}s`,
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ fontSize: 19.5, fontWeight: 800, color: INK, letterSpacing: -0.2 }}>
                    {isTherapist ? 'Press Start to begin' : 'Waiting for your therapist to start…'}
                  </div>
                  <div style={{ fontSize: 16.5, fontWeight: 600, color: MUTED, lineHeight: 1.6 }}>
                    Bubbles float up carrying words. Tap the one that matches the prompt before it drifts away.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
