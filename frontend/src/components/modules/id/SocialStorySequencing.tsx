'use client'

import { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { deleteField, doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import type { KidMood, SceneSpot } from './SocialStoryScene3D'
import { ModuleHeaderSlot } from '@/components/session/moduleHeaderSlot'

// three.js only runs in the browser, and only this module needs it.
const Scene3D = dynamic(() => import('./SocialStoryScene3D'), {
  ssr: false,
  loading: () => (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(23,58,94,0.5)', fontSize: 14 }}>
      Building the room…
    </div>
  ),
})

interface SocialStorySequencingProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

interface Panel {
  id: string
  emoji: string
  caption: string
  correctIndex: number
}

interface Story {
  id: string
  title: string
  panels: Panel[]
}

const STORIES: Story[] = [
  {
    id: 'getting-ready-school', title: 'Getting Ready for School',
    panels: [
      { id: 's1p1', emoji: '⏰', caption: 'Wake up when the alarm rings', correctIndex: 0 },
      { id: 's1p2', emoji: '🪥', caption: 'Brush teeth and wash face', correctIndex: 1 },
      { id: 's1p3', emoji: '👕', caption: 'Put on school clothes', correctIndex: 2 },
      { id: 's1p4', emoji: '🥣', caption: 'Eat breakfast', correctIndex: 3 },
      { id: 's1p5', emoji: '🎒', caption: 'Pack bag and go to school', correctIndex: 4 },
    ],
  },
  {
    id: 'meeting-someone-new', title: 'Meeting Someone New',
    panels: [
      { id: 's2p1', emoji: '👀', caption: 'See someone new', correctIndex: 0 },
      { id: 's2p2', emoji: '😊', caption: 'Smile and say hello', correctIndex: 1 },
      { id: 's2p3', emoji: '🤝', caption: 'Tell them your name', correctIndex: 2 },
      { id: 's2p4', emoji: '🗣️', caption: 'Ask their name and listen', correctIndex: 3 },
    ],
  },
  {
    id: 'when-i-feel-angry', title: 'When I Feel Angry',
    panels: [
      { id: 's3p1', emoji: '😡', caption: 'I start to feel angry', correctIndex: 0 },
      { id: 's3p2', emoji: '✋', caption: 'Stop and take a deep breath', correctIndex: 1 },
      { id: 's3p3', emoji: '💭', caption: "Think about why I'm angry", correctIndex: 2 },
      { id: 's3p4', emoji: '🗣️', caption: 'Use words to say how I feel', correctIndex: 3 },
      { id: 's3p5', emoji: '😌', caption: 'Feel calmer now', correctIndex: 4 },
    ],
  },
  {
    id: 'going-to-doctor', title: 'Going to the Doctor',
    panels: [
      { id: 's4p1', emoji: '🏥', caption: "We go to the doctor's office", correctIndex: 0 },
      { id: 's4p2', emoji: '🪑', caption: 'Wait quietly in the waiting room', correctIndex: 1 },
      { id: 's4p3', emoji: '👨‍⚕️', caption: 'The doctor calls my name', correctIndex: 2 },
      { id: 's4p4', emoji: '🩺', caption: "Doctor checks how I'm feeling", correctIndex: 3 },
      { id: 's4p5', emoji: '😊', caption: 'We say thank you and go home', correctIndex: 4 },
    ],
  },
  {
    id: 'sharing-with-friend', title: 'Sharing with a Friend',
    panels: [
      { id: 's5p1', emoji: '🎮', caption: 'I have a toy I like', correctIndex: 0 },
      { id: 's5p2', emoji: '👦', caption: 'My friend wants to play too', correctIndex: 1 },
      { id: 's5p3', emoji: '🤝', caption: 'I share my toy with them', correctIndex: 2 },
      { id: 's5p4', emoji: '😊', caption: 'We both feel happy playing together', correctIndex: 3 },
    ],
  },
  {
    id: 'asking-for-help', title: 'Asking for Help',
    panels: [
      { id: 's6p1', emoji: '😕', caption: "I don't understand something", correctIndex: 0 },
      { id: 's6p2', emoji: '🙋', caption: 'I raise my hand or go to a grown-up', correctIndex: 1 },
      { id: 's6p3', emoji: '🗣️', caption: 'Can you help me please?', correctIndex: 2 },
      { id: 's6p4', emoji: '😊', caption: 'I get help and feel better', correctIndex: 3 },
    ],
  },
  {
    id: 'handling-disappointment', title: 'Handling Disappointment',
    panels: [
      { id: 's7p1', emoji: '🤩', caption: 'I was really looking forward to something', correctIndex: 0 },
      { id: 's7p2', emoji: '😞', caption: "It didn't happen the way I wanted", correctIndex: 1 },
      { id: 's7p3', emoji: '😢', caption: 'I feel sad and disappointed', correctIndex: 2 },
      { id: 's7p4', emoji: '💭', caption: "I remind myself: it's okay to feel sad", correctIndex: 3 },
      { id: 's7p5', emoji: '🌈', caption: 'I think of something else to look forward to', correctIndex: 4 },
    ],
  },
  {
    id: 'birthday-party', title: 'Going to a Birthday Party',
    panels: [
      { id: 's8p1', emoji: '💌', caption: 'I get an invitation to a party', correctIndex: 0 },
      { id: 's8p2', emoji: '🎁', caption: 'We buy a present for my friend', correctIndex: 1 },
      { id: 's8p3', emoji: '🏠', caption: 'We arrive at the party', correctIndex: 2 },
      { id: 's8p4', emoji: '🎈', caption: 'I say happy birthday and give the gift', correctIndex: 3 },
      { id: 's8p5', emoji: '🎂', caption: 'We eat cake and play games', correctIndex: 4 },
      { id: 's8p6', emoji: '👋', caption: 'I say thank you and goodbye', correctIndex: 5 },
    ],
  },
]


const PICKER_EMOJIS = ['😊','😢','😡','😕','🤩','😞','😌','😰','🙋','👀','🤝','🗣️','👋','✋','💭','🌈','🏠','🏥','🎒','🪑','👨‍⚕️','🩺','🎮','🎁','🎈','🎂','🍳','🦷','👕','💌','👦','🦁','🐶','🐱','🌻','📚','🎵','🏆','🌟','🎉']

/* The character walks to a spot, then does the action there. */
const WALK_MS = 900
const ACT_MS = 1700
/** How long a wrong pick stays on the board before it goes back (Guided / Standard). */
const WRONG_HOLD_MS = 1100
/** What the character says while acting out a school step. */
const ACTION_SAYS: Record<string, string> = {
  s1p1: 'Good morning! ☀️',
  s1p2: 'Brush, brush, brush! 🪥',
  s1p3: 'My school uniform! 👕',
  s1p4: 'Yum, breakfast! 🥣',
  s1p5: 'Bye! Off to school! 👋',
  s2p1: 'Oh, someone new! 👀',
  s2p2: 'Hello! 😊',
  s2p3: "Hi, I'm Maya! 🤝",
  s2p4: "What's your name? 🗣️",
  s3p1: 'Grrr! I feel so angry! 😡',
  s3p2: 'Stop… breathe in… and out. ✋',
  s3p3: "Hmm, why am I angry? 💭",
  s3p4: "I feel angry because… 🗣️",
  s3p5: 'Ahh, I feel calmer. 😌',
  s4p1: "We're at the doctor's! 🏥",
  s4p2: 'I wait quietly. 🪑',
  s4p3: "Yes, that's me! 🙋",
  s4p4: 'Ahh… breathe in. 🩺',
  s4p5: 'Thank you, doctor! 😊',
  s5p1: 'I love this toy! 🎮',
  s5p2: 'My friend wants to play too. 👦',
  s5p3: 'Here, you can have a turn! 🤝',
  s5p4: 'We play together! 😊',
  s6p1: "Hmm… I don't understand. 😕",
  s6p2: 'I raise my hand. 🙋',
  s6p3: 'Can you help me please? 🗣️',
  s6p4: 'Now I understand! 😊',
  s7p1: "I can't wait! 🤩",
  s7p2: "Oh no, it didn't happen. 😞",
  s7p3: 'I feel sad… 😢',
  s7p4: "It's okay to feel sad. 💭",
  s7p5: "Maybe something else will be fun! 🌈",
  s8p1: 'An invitation! 💌',
  s8p2: 'A present for my friend! 🎁',
  s8p3: "We're at the party! 🏠",
  s8p4: 'Happy birthday! 🎈',
  s8p5: 'Yum, cake! 🎂',
  s8p6: 'Thank you! Bye! 👋',
}

/** Where each story happens, for the header. The 3D room itself is drawn in SocialStoryScene3D. */
const PLACES: Record<string, string> = {
  'getting-ready-school': 'At home',
  'meeting-someone-new': 'At the park',
  'when-i-feel-angry': 'In the living room',
  'going-to-doctor': 'At the clinic',
  'sharing-with-friend': 'In the play room',
  'asking-for-help': 'In the classroom',
  'handling-disappointment': 'In the garden',
  'birthday-party': 'At the party',
  custom: 'Story time',
}

/* Pastel card / glow colours, assigned by position on screen (never by the
   correct order, which would give the answer away). */
const SPOT_COLORS = ['#26b0a1', '#f0a22e', '#2a9ed6', '#3bb26d', '#8a6be0', '#e5677a']
const CARD_COLORS = [
  { bg: '#e4f4fc', bd: '#86c9e6' }, { bg: '#efe9fc', bd: '#b3a1e3' }, { bg: '#e3f6ed', bd: '#80cba5' },
  { bg: '#fdf4d8', bd: '#e8c970' }, { bg: '#ebe7fc', bd: '#a39ae2' }, { bg: '#fde8e8', bd: '#e7a0a0' },
]
/** Cheap deep-equality for the plain JSON the session doc round-trips. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] }
  return b
}

export default function SocialStorySequencing({ sessionId, role, isLocked }: SocialStorySequencingProps) {
  const isT = role === 'therapist'
  const canDrop = isT || !isLocked

  const [storyId, setStoryId] = useState('getting-ready-school')
  const [panels, setPanels] = useState<Panel[]>(STORIES[0].panels)
  const [shuffled, setShuffled] = useState<string[]>([])
  const [placed, setPlaced] = useState<Record<string, string>>({})
  const [difficulty, setDifficulty] = useState('standard')
  const [attempts, setAttempts] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [storiesDone, setStoriesDone] = useState(0)
  const [showedAnswer, setShowedAnswer] = useState(false)
  const [customStory, setCustomStory] = useState<Story | null>(null)

  const [wrongSlots, setWrongSlots] = useState<Set<number>>(new Set())
  const [correctSlots, setCorrectSlots] = useState<Set<number>>(new Set())
  const [playIdx, setPlayIdx] = useState(-1)
  const [hintPanel, setHintPanel] = useState<string | null>(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  /** The session room's top row, when it offers one: the header goes there, so there's one bar, not two. */
  const headerSlot = useContext(ModuleHeaderSlot)
  const [customTitle, setCustomTitle] = useState('')
  const [customPanels, setCustomPanels] = useState<{ emoji: string; caption: string }[]>(Array.from({ length: 4 }, () => ({ emoji: '😊', caption: '' })))
  const [toast, setToast] = useState<{ msg: string } | null>(null)
  // The celebration replay runs on the board itself; `waiting` flips to true only
  // once every panel has been walked through and read, and that is what reveals
  // the same-set / new-set choice.
  const [waiting, setWaiting] = useState(false)

  /* The character: which step it is standing at (null = the start of the room)
     and whether it is mid-walk. Derived from the shared placement, so both
     screens animate the same moves. */
  const [kid, setKid] = useState<{ at: string | null; walking: boolean }>({ at: null, walking: false })
  const [acting, setActing] = useState(false)

  const toastT = useRef<ReturnType<typeof setTimeout>>()
  const chain = useRef<ReturnType<typeof setTimeout>[]>([])
  const revertT = useRef<ReturnType<typeof setTimeout>>()
  // Bumped whenever a replay is superseded (new story, reset, skip, unmount) so
  // timers and speech callbacks still in flight from the old run bail out.
  const replayRun = useRef(0)
  /* True when THIS screen made the last placement, so only one side runs the
     automatic check when the final card lands. */
  const lastDropMine = useRef(false)

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (typeof s.ssStoryId === 'string') setStoryId(s.ssStoryId)
      if (typeof s.ssDifficulty === 'string') setDifficulty(s.ssDifficulty)
      if (typeof s.ssAttempts === 'number') setAttempts(s.ssAttempts)
      if (typeof s.ssCompleted === 'boolean') setCompleted(s.ssCompleted)
      if (typeof s.ssStoriesCompleted === 'number') setStoriesDone(s.ssStoriesCompleted)
      if (typeof s.ssShowedAnswer === 'boolean') setShowedAnswer(s.ssShowedAnswer)

      // Every module shares one session doc, so a snapshot fires for writes that
      // have nothing to do with this game. Handing back a fresh array/object each
      // time would churn identities all the way up to the replay effect and cut
      // the read-back short, so only set state when the value really changed.
      if (Array.isArray(s.ssPanels)) setPanels(prev => same(prev, s.ssPanels) ? prev : s.ssPanels as Panel[])
      if (Array.isArray(s.ssShuffled)) setShuffled(prev => same(prev, s.ssShuffled) ? prev : s.ssShuffled)
      if (typeof s.ssPlaced === 'object' && s.ssPlaced !== null) {
        setPlaced(prev => same(prev, s.ssPlaced) ? prev : s.ssPlaced as Record<string, string>)
      }
      if (s.ssCustomStory && typeof s.ssCustomStory === 'object') {
        const cs = s.ssCustomStory as { title: string; panels: Panel[] }
        if (Array.isArray(cs.panels)) {
          const next: Story = { id: 'custom', title: cs.title || 'Custom Story', panels: cs.panels }
          setCustomStory(prev => same(prev, next) ? prev : next)
        }
      } else {
        // The therapist removed it — drop the local copy too, otherwise the chip
        // lingers and the module keeps reopening on a story that no longer exists.
        setCustomStory(prev => prev === null ? prev : null)
      }
    })
    return () => unsub()
  }, [sessionId])

  useEffect(() => () => {
    if (toastT.current) clearTimeout(toastT.current)
    if (revertT.current) clearTimeout(revertT.current)
    chain.current.forEach(t => clearTimeout(t))
    chain.current = []
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast({ msg })
    if (toastT.current) clearTimeout(toastT.current)
    toastT.current = setTimeout(() => setToast(null), 2000)
  }, [])

  // Resolved once here (not again at render time) so activePanels and the board
  // can never disagree about which story is on screen.
  const currentStory = useMemo<Story | null>(() => {
    if (storyId === 'custom') {
      if (customStory) return customStory
      // ssCustomStory is gone but the panel copy survived: still playable rather
      // than a blank board.
      return panels.length ? { id: 'custom', title: 'Custom Story', panels } : null
    }
    return STORIES.find(s => s.id === storyId) ?? null
  }, [storyId, customStory, panels])

  const activePanels = useMemo(() => currentStory?.panels ?? [], [currentStory])

  const panelMap = useMemo(() => {
    const m = new Map<string, Panel>()
    for (const p of activePanels) m.set(p.id, p)
    return m
  }, [activePanels])

  const resolvedShuffled = useMemo(() => {
    const old = shuffled.filter(id => panelMap.has(id))
    if (old.length === activePanels.length) return old
    return shuffle(activePanels.map(p => p.id))
  }, [shuffled, panelMap, activePanels])

  const slotCount = activePanels.length
  const placedCount = Object.keys(placed).length
  const unplacedIds = resolvedShuffled.filter(id => !Object.values(placed).includes(id))
  const allFilled = placedCount === slotCount
  const isCorrect = useMemo(() => {
    if (!allFilled) return false
    for (let i = 0; i < slotCount; i++) {
      const pid = placed[String(i)]
      if (!pid || panelMap.get(pid)?.correctIndex !== i) return false
    }
    return true
  }, [placed, slotCount, panelMap, allFilled])

  /* Guided and Standard give feedback the moment a step is picked — the
     character does it, or shakes its head and the pick goes back. Challenge
     waits for Check, which is what makes it the hard mode. */
  const instantFeedback = difficulty !== 'challenge'

  /** The step a pick goes into: the first empty one. */
  const firstEmpty = useMemo(() => {
    for (let i = 0; i < slotCount; i++) if (!placed[String(i)]) return i
    return -1
  }, [placed, slotCount])

  const loadStory = useCallback((sid: string) => {
    // 'custom' lives on the session, not in STORIES — without this the custom
    // chip did nothing and the only way onto that story was re-saving the form.
    const story = sid === 'custom' ? customStory : STORIES.find(s => s.id === sid)
    if (!story) return
    const ord = shuffle(story.panels.map(p => p.id))
    write({
      'moduleState.ssStoryId': sid,
      'moduleState.ssPanels': story.panels,
      'moduleState.ssShuffled': ord,
      'moduleState.ssPlaced': {},
      'moduleState.ssAttempts': 0,
      'moduleState.ssCompleted': false,
      'moduleState.ssShowedAnswer': false,
    })
    // Optimistic, so the new room appears at once instead of after the round trip.
    setStoryId(sid)
    setPanels(story.panels)
    setShuffled(ord)
    setPlaced({})
    setAttempts(0)
    setCompleted(false)
    setWrongSlots(new Set())
    setCorrectSlots(new Set())
    setHintPanel(null)
    setShowAnswer(false)
    setPlayIdx(-1)
  }, [write, customStory])

  const handleDrop = useCallback((panelId: string, slotIdx: number) => {
    if (!canDrop || completed || slotIdx < 0) return
    if (Object.values(placed).includes(panelId)) return
    const slotKey = String(slotIdx)
    // A filled slot is not overwritten — tap it first to send its card back.
    if (placed[slotKey]) return
    lastDropMine.current = true
    // Optimistic, so the step lands at once instead of after the round trip.
    setPlaced(prev => ({ ...prev, [slotKey]: panelId }))
    write({ [`moduleState.ssPlaced.${slotKey}`]: panelId })
    setWrongSlots(prev => { const n = new Set(prev); n.delete(slotIdx); return n })
    setCorrectSlots(prev => { const n = new Set(prev); n.delete(slotIdx); return n })

    // A wrong pick in Guided/Standard: let the character walk over and shake its
    // head, then send the step back. Only the screen that picked it does this,
    // so the attempt is counted once.
    if (instantFeedback && panelMap.get(panelId)?.correctIndex !== slotIdx) {
      const na = (attempts || 0) + 1
      setAttempts(na)
      write({ 'moduleState.ssAttempts': na })
      if (revertT.current) clearTimeout(revertT.current)
      revertT.current = setTimeout(() => {
        setPlaced(prev => {
          if (prev[slotKey] !== panelId) return prev
          const n = { ...prev }; delete n[slotKey]; return n
        })
        write({ [`moduleState.ssPlaced.${slotKey}`]: deleteField() })
      }, WALK_MS + WRONG_HOLD_MS)
    }
  }, [canDrop, completed, placed, write, instantFeedback, panelMap, attempts])

  /** Pick a step: it always goes into the next empty place in the story. */
  const pick = useCallback((panelId: string) => handleDrop(panelId, firstEmpty), [handleDrop, firstEmpty])

  const removeFromSlot = useCallback((slotIdx: number) => {
    if (!canDrop || completed) return
    // Must delete the key, not blank it: an empty value still counts toward
    // placedCount and leaves the slot permanently occupied-but-unrenderable.
    setPlaced(prev => { const n = { ...prev }; delete n[String(slotIdx)]; return n })
    write({ [`moduleState.ssPlaced.${slotIdx}`]: deleteField() })
    chain.current.forEach(t => clearTimeout(t))
    chain.current = []
    setPlayIdx(-1)
    setShowAnswer(false)
    setCorrectSlots(new Set())
    setWrongSlots(new Set())
  }, [canDrop, completed, write])

  const handleCheck = useCallback(() => {
    if (!allFilled) return
    const wrong = new Set<number>()
    const correct = new Set<number>()
    for (let i = 0; i < slotCount; i++) {
      const pid = placed[String(i)]
      if (pid && panelMap.get(pid)?.correctIndex === i) correct.add(i)
      else wrong.add(i)
    }
    if (wrong.size === 0) {
      setCorrectSlots(correct)
      write({ 'moduleState.ssCompleted': true, 'moduleState.ssStoriesCompleted': storiesDone + 1 })
      setCompleted(true)
      setStoriesDone(storiesDone + 1)
      const storyTitle = customStory && storyId === 'custom'
        ? customStory.title
        : STORIES.find(s => s.id === storyId)?.title ?? storyId
      logModuleEvent(sessionId, {
        module: 'social-story-sequencing',
        type: 'story_completed',
        detail: `Sequenced "${storyTitle}" correctly in ${(attempts || 0) + 1} attempt${(attempts || 0) + 1 === 1 ? '' : 's'}`,
      })
      // The replay itself is driven by the effect below, so both therapist and
      // client walk through the finished story, not just whoever hit Check.
    } else {
      setWrongSlots(wrong)
      setCorrectSlots(correct)
      const na = (attempts || 0) + 1
      setAttempts(na)
      write({ 'moduleState.ssAttempts': na })
      showToast('Almost! Tap the red steps to try them again')
      if (na >= 2) {
        const firstWrong = Array.from(wrong)[0]
        const correctPanelId = activePanels.find(p => p.correctIndex === firstWrong)?.id
        if (correctPanelId) setHintPanel(correctPanelId)
      }
    }
  }, [allFilled, placed, slotCount, panelMap, write, storiesDone, showToast, activePanels, attempts, sessionId, storyId, customStory])

  /* When the last step lands right, finish automatically (only on the screen
     that placed it, so the result is written once). Wrong picks never get here
     in these modes — they are sent back instead. */
  useEffect(() => {
    if (!instantFeedback || !isCorrect || completed || showAnswer) return
    if (!lastDropMine.current) return
    lastDropMine.current = false
    handleCheck()
  }, [instantFeedback, isCorrect, completed, showAnswer, handleCheck])

  const orderedPanels = useMemo(
    () => [...activePanels].sort((a, b) => a.correctIndex - b.correctIndex),
    [activePanels],
  )
  /** Changes only when the story's actual content does, unlike the array identity. */
  const replaySig = useMemo(
    () => `${storyId}::${orderedPanels.map(p => `${p.correctIndex}:${p.caption}`).join('|')}`,
    [storyId, orderedPanels],
  )

  const stopReplay = useCallback(() => {
    replayRun.current += 1
    chain.current.forEach(t => clearTimeout(t))
    chain.current = []
  }, [])

  // Once the story is right, let the last step's action finish playing, then
  // show the celebration. (The whole story used to replay first; removed at the
  // clinic's request — the child has just done every step.)
  useEffect(() => {
    if (!completed) {
      stopReplay()
      setPlayIdx(-1)
      setWaiting(false)
      return
    }

    const run = ++replayRun.current
    const alive = () => replayRun.current === run
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => { if (alive()) fn() }, ms)
      chain.current.push(t)
    }

    after(WALK_MS + ACT_MS + 300, () => setWaiting(true))

    return () => {
      replayRun.current += 1
      chain.current.forEach(t => clearTimeout(t))
      chain.current = []
    }
    // Deliberately keyed on replaySig, not on the activePanels array: the session
    // doc is shared by every module, so an unrelated write used to hand back a new
    // array, restart this effect and cancel the line that was mid-sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed, replaySig, stopReplay])

  useEffect(() => {
    if (completed && waiting && !showAnswer) {
      showToast('🌟 Story complete!')
    }
  }, [completed, waiting, showAnswer, showToast])

  const revealAnswer = useCallback(() => {
    if (!isT) return
    write({ 'moduleState.ssShowedAnswer': true })
    const p = [...activePanels].sort((a, b) => a.correctIndex - b.correctIndex)
    const newPlaced: Record<string, string> = {}
    p.forEach((panel, i) => { newPlaced[String(i)] = panel.id })
    write({ 'moduleState.ssPlaced': newPlaced })
    setPlaced(newPlaced)
    setShowAnswer(true)
    setWrongSlots(new Set())
    setCorrectSlots(new Set())
  }, [isT, write, activePanels])

  const resetStory = useCallback(() => {
    const ord = shuffle(activePanels.map(p => p.id))
    write({
      'moduleState.ssShuffled': ord,
      'moduleState.ssPlaced': {},
      'moduleState.ssAttempts': 0,
      'moduleState.ssCompleted': false,
      'moduleState.ssShowedAnswer': false,
    })
    stopReplay()
    setShuffled(ord)
    setPlaced({})
    setAttempts(0)
    setCompleted(false)
    setPlayIdx(-1)
    setWrongSlots(new Set())
    setCorrectSlots(new Set())
    setHintPanel(null)
    setShowAnswer(false)
    setWaiting(false)
  }, [write, activePanels, stopReplay])

  const nextStory = useCallback(() => {
    // findIndex is -1 on the custom story, so that case lands on STORIES[0].
    const currentIdx = STORIES.findIndex(s => s.id === storyId)
    const next = STORIES[(currentIdx + 1) % STORIES.length]
    stopReplay()
    loadStory(next.id)
    setWaiting(false)
    setShowCustomForm(false)
  }, [storyId, loadStory, stopReplay])

  const setLevel = useCallback((d: string) => {
    write({ 'moduleState.ssDifficulty': d, 'moduleState.ssPlaced': {}, 'moduleState.ssAttempts': 0, 'moduleState.ssCompleted': false })
    setDifficulty(d)
    setPlaced({})
    setAttempts(0)
    setCompleted(false)
    setHintPanel(null)
    setWrongSlots(new Set())
    setCorrectSlots(new Set())
  }, [write])

  /** Drop the session's custom story and fall back to a built-in one. */
  const clearCustomStory = useCallback(() => {
    write({ 'moduleState.ssCustomStory': deleteField() })
    setCustomStory(null)
    if (storyId === 'custom') loadStory(STORIES[0].id)
  }, [write, storyId, loadStory])

  const saveCustomStory = useCallback(() => {
    if (!customTitle.trim()) return
    const ps: Panel[] = customPanels.filter(p => p.caption.trim()).map((p, i) => ({
      id: `cp${i}`, emoji: p.emoji, caption: p.caption.trim(), correctIndex: i,
    }))
    if (ps.length < 3) { showToast('Need at least 3 panels'); return }
    const ord = shuffle(ps.map(p => p.id))
    write({
      'moduleState.ssCustomStory': { title: customTitle.trim(), panels: ps },
      'moduleState.ssStoryId': 'custom',
      'moduleState.ssPanels': ps,
      'moduleState.ssShuffled': ord,
      'moduleState.ssPlaced': {},
      'moduleState.ssAttempts': 0,
      'moduleState.ssCompleted': false,
      'moduleState.ssShowedAnswer': false,
    })
    setCustomStory({ id: 'custom', title: customTitle.trim(), panels: ps })
    setStoryId('custom')
    setPanels(ps)
    setShuffled(ord)
    setPlaced({})
    setAttempts(0)
    setCompleted(false)
    setShowCustomForm(false)
  }, [customTitle, customPanels, write, showToast])

  // --- The scene ---

  const place = PLACES[storyId] ?? PLACES.custom

  /** Each step's on-screen position (the shuffled order, never its answer). */
  const spots = useMemo(() => {
    const m = new Map<string, { i: number }>()
    resolvedShuffled.forEach((id, i) => m.set(id, { i }))
    return m
  }, [resolvedShuffled])

  /** Which step each panel was picked for, if any. */
  const slotOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const [k, pid] of Object.entries(placed)) m.set(pid, Number(k))
    return m
  }, [placed])

  const nextCorrectId = firstEmpty >= 0 ? orderedPanels[firstEmpty]?.id ?? null : null
  // Guided always shows the way; Standard starts showing it after two misses.
  const showGuide = !completed && !showAnswer && (difficulty === 'guided' || (difficulty === 'standard' && (attempts || 0) >= 2))
  const liveWrongSlot = instantFeedback
    ? Object.entries(placed).find(([k, pid]) => panelMap.get(pid)?.correctIndex !== Number(k))
    : undefined

  /* The step the character should be standing at: during the replay, the step
     being played; otherwise the most recent step in the story. */
  const targetId = useMemo<string | null>(() => {
    if (completed && playIdx >= 0 && orderedPanels[playIdx]) return orderedPanels[playIdx].id
    let last = -1
    for (const k of Object.keys(placed)) last = Math.max(last, Number(k))
    return last >= 0 ? placed[String(last)] ?? null : null
  }, [completed, playIdx, orderedPanels, placed])

  /* Only a new step (or the replay) earns the action on arrival — walking back
     after a wrong pick is sent home is just a walk. */
  // Decided once per move and remembered, so running the effect twice (React
  // StrictMode in dev) doesn't turn a new step into "nothing new".
  const arrival = useRef<{ key: string; count: number; grew: boolean }>({ key: '', count: placedCount, grew: false })
  useEffect(() => {
    const key = `${targetId}|${playIdx}`
    if (arrival.current.key !== key) {
      arrival.current = { key, count: placedCount, grew: placedCount > arrival.current.count || (completed && playIdx >= 0) }
    }
    const grew = arrival.current.grew
    setKid(prev => (prev.at === targetId ? prev : { at: targetId, walking: true }))
    setActing(false)
    const t1 = setTimeout(() => {
      setKid(k => ({ ...k, walking: false }))
      if (grew && targetId) setActing(true)
    }, WALK_MS)
    const t2 = setTimeout(() => setActing(false), WALK_MS + ACT_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
    // Keyed on where to stand, not on every placement change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, playIdx])

  const mood: KidMood = completed && waiting ? 'cheer'
    : kid.walking ? 'walk'
    : liveWrongSlot ? 'oops'
    : acting ? 'act'
    : 'idle'

  /* Steps the 3D room should show as done: during the replay the morning
     starts over (asleep, hoodie on) and fills back in step by step. */
  const doneIds = useMemo<string[]>(() => {
    if (completed) return orderedPanels.map(p => p.id)
    return Object.entries(placed)
      .filter(([k, pid]) => !instantFeedback || panelMap.get(pid)?.correctIndex === Number(k))
      .map(([, pid]) => pid)
  }, [completed, waiting, playIdx, orderedPanels, placed, instantFeedback, panelMap])
  // In the school story she starts the morning asleep in bed.
  const asleep = storyId === 'getting-ready-school' && !doneIds.includes('s1p1')

  /** What the character says, in a speech bubble above its head. */
  const kidSays = (() => {
    if (asleep) {
      if (completed) return ''
      return liveWrongSlot && !kid.walking ? "Zzz… I'm still asleep! 😴" : 'Zzz… 💤'
    }
    if (kid.walking) return ''
    if (completed && playIdx >= 0 && !waiting) {
      const p = orderedPanels[playIdx]
      if (acting && p && ACTION_SAYS[p.id]) return ACTION_SAYS[p.id]
      return p ? (difficulty === 'challenge' ? `Step ${playIdx + 1}!` : p.caption) : ''
    }
    if (completed) return waiting ? 'I did it! 🎉' : ''
    if (liveWrongSlot) return 'Hmm… not yet! 🤔'
    if (acting && kid.at && ACTION_SAYS[kid.at]) return ACTION_SAYS[kid.at]
    if (acting) return instantFeedback ? 'Done! ✓' : 'Okay!'
    if (!canDrop) return 'Wait for your turn…'
    if (!instantFeedback && allFilled) return 'Ready? Press Check!'
    if (placedCount === 0) return 'What should I do first?'
    return "What's next?"
  })()

  const hintText = completed
    ? 'Watch the story from start to finish!'
    : difficulty === 'guided'
      ? 'Follow the glowing footsteps to what comes next.'
      : difficulty === 'challenge'
        ? 'Pick every step in order, then press Check.'
        : 'Explore the room and choose what to do next.'

  /* What the 3D room needs to know about each step spot. */
  const sceneSpots = useMemo<SceneSpot[]>(() => resolvedShuffled.flatMap(id => {
    const panel = panelMap.get(id)
    const spot = spots.get(id)
    if (!panel || !spot) return []
    const slot = slotOf.get(id)
    const isPlaced = slot !== undefined
    const right = isPlaced && panel.correctIndex === slot
    const wrongNow = isPlaced && (wrongSlots.has(slot!) || (instantFeedback && !right))
    const doneNow = isPlaced && !wrongNow && (instantFeedback || correctSlots.has(slot!) || completed || showAnswer)
    const isPlay = completed && playIdx >= 0 && orderedPanels[playIdx]?.id === id
    const here = !kid.walking && !wrongNow && kid.at === id && (acting || isPlay)
    return [{
      id,
      emoji: panel.emoji,
      caption: panel.caption,
      color: SPOT_COLORS[spot.i % SPOT_COLORS.length],
      status: wrongNow ? 'wrong' : doneNow ? 'done' : isPlaced ? 'placed' : 'open',
      badge: isPlaced ? (wrongNow ? '✗' : instantFeedback ? '✓' : String(slot! + 1)) : null,
      ring: !isPlaced && ((showGuide && id === nextCorrectId) || hintPanel === id),
      playing: isPlay,
      clickable: canDrop && !completed && (!isPlaced || !(instantFeedback && right)),
      burst: here,
      burstKey: `${playIdx}-${placedCount}`,
    }]
  }), [resolvedShuffled, panelMap, spots, slotOf, wrongSlots, correctSlots, instantFeedback, completed, showAnswer, playIdx, orderedPanels, kid, acting, showGuide, nextCorrectId, hintPanel, canDrop, placedCount])

  const onSpot = useCallback((id: string) => {
    const slot = slotOf.get(id)
    if (slot !== undefined) removeFromSlot(slot)
    else pick(id)
  }, [slotOf, removeFromSlot, pick])

  const canCheck = allFilled && !completed && !showAnswer

  /* The header row: story (therapists switch it here), progress, hint, difficulty.
     Rendered into the session room's top row when there is one, else inline. */
  const header = currentStory && (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 230px', minWidth: 0, position: 'relative' }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, background: 'linear-gradient(160deg,#eef6fd,#d3e6f5)', boxShadow: 'inset 0 0 0 1px rgba(42,158,214,.25)' }}>📖</div>
        <div style={{ minWidth: 0 }}>
          {isT ? (
            <button onClick={() => setPickerOpen(o => !o)} title="Choose a story"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 21, fontWeight: 800, color: '#173a7a', lineHeight: 1.15, maxWidth: '100%' }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentStory.title}</span>
              <span style={{ fontSize: 13, color: 'rgba(23,58,122,0.6)' }}>▾</span>
            </button>
          ) : (
            <div style={{ fontSize: 21, fontWeight: 800, color: '#173a7a', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentStory.title}</div>
          )}
          <div style={{ fontSize: 13, color: 'rgba(23,58,94,0.6)', whiteSpace: 'nowrap' }}>Social Story Sequencing · {place}</div>
        </div>
        {isT && pickerOpen && (
          <div style={{ position: 'absolute', top: '100%', left: 54, marginTop: 6, zIndex: 60, minWidth: 260, padding: 6, borderRadius: 14, background: '#fff', border: '1px solid #d6e6f4', boxShadow: '0 12px 30px rgba(23,58,94,0.18)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {STORIES.map(st => (
              <button key={st.id} onClick={() => { loadStory(st.id); setPickerOpen(false) }}
                style={{ textAlign: 'left', padding: '7px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 14, background: storyId === st.id ? '#e6f4f1' : 'transparent', color: '#173a5e', fontWeight: storyId === st.id ? 700 : 500 }}
              >{st.title}</button>
            ))}
            {customStory && (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button onClick={() => { loadStory('custom'); setPickerOpen(false) }}
                  style={{ flex: 1, textAlign: 'left', padding: '7px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 14, background: storyId === 'custom' ? '#e6f4f1' : 'transparent', color: '#173a5e', fontWeight: storyId === 'custom' ? 700 : 500 }}
                >📝 {customStory.title}</button>
                <button onClick={clearCustomStory} title="Remove this custom story"
                  style={{ padding: '4px 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>✕</button>
              </div>
            )}
            <button onClick={() => { setShowCustomForm(true); setPickerOpen(false) }}
              style={{ textAlign: 'left', padding: '7px 10px', borderRadius: 9, border: '1px dashed rgba(0,0,0,0.15)', cursor: 'pointer', fontSize: 14, background: 'transparent', color: 'rgba(23,58,94,0.7)', marginTop: 4 }}
            >+ Create a custom story</button>
          </div>
        )}
      </div>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '5px 12px', borderRadius: 14, background: '#f3f8fd', border: '1px solid #d6e6f4', flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#173a5e', whiteSpace: 'nowrap' }}>⭐ {Math.min(placedCount, slotCount)}/{slotCount} actions</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {Array.from({ length: slotCount }, (_, idx) => {
                  const pid = placed[String(idx)]
                  const panel = pid ? panelMap.get(pid) : null
                  const right = !!panel && panel.correctIndex === idx
                  const markWrong = wrongSlots.has(idx) || (instantFeedback && !!panel && !right)
                  const markRight = correctSlots.has(idx) || (instantFeedback && right)
                  const removable = canDrop && !completed && !!panel && !(instantFeedback && right)
                  const isPlay = completed && playIdx === idx
                  return (
                    <button key={idx} disabled={!removable}
                      onClick={() => removable && removeFromSlot(idx)}
                      title={panel ? (removable ? 'Tap to take this step back' : panel.caption) : `Step ${idx + 1}`}
                      style={{
                        width: 22, height: 22, borderRadius: '50%', padding: 0, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                        background: !panel ? '#dfe5eb' : markWrong ? '#fde3dd' : markRight ? '#dcf3e6' : '#fff',
                        border: isPlay ? '2px solid #22a894' : !panel ? '1px solid transparent' : markWrong ? '1.5px solid #d4553a' : markRight ? '1.5px solid #2f9e62' : '1.5px solid #c5d3e0',
                        cursor: removable ? 'pointer' : 'default',
                        animation: panel ? 'ss-chip .35s ease' : undefined,
                        transform: isPlay ? 'scale(1.2)' : undefined, transition: 'transform .2s',
                      }}
                    >{panel ? panel.emoji : ''}</button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 14, background: '#f3f8fd', border: '1px solid #d6e6f4', flex: '1 1 200px', minWidth: 0 }}>
              <span style={{ fontSize: 20 }}>💡</span>
              <span style={{ fontSize: 14, color: '#173a5e', lineHeight: 1.3 }}>{hintText}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: '#173a5e', fontWeight: 600 }}>Difficulty:</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {['guided', 'standard', 'challenge'].map(d => (
                  <button key={d} disabled={!isT} onClick={() => isT && setLevel(d)}
                    title={isT ? undefined : 'The therapist sets the difficulty'}
                    style={{
                      padding: '4px 13px', borderRadius: 999, fontSize: 13, cursor: isT ? 'pointer' : 'default',
                      border: difficulty === d ? '1px solid #1f9d8a' : '1px solid #dfe5eb',
                      background: difficulty === d ? 'linear-gradient(180deg,#2bb7a1,#1f9d8a)' : '#ffffff',
                      color: difficulty === d ? '#fff' : '#173a5e',
                      fontWeight: difficulty === d ? 700 : 500,
                      boxShadow: difficulty === d ? '0 3px 8px rgba(31,157,138,.3)' : '0 1px 3px rgba(0,0,0,.06)',
                    }}
                  >{d === 'challenge' ? 'Challenge' : d === 'standard' ? 'Standard' : 'Guided'}</button>
                ))}
              </div>
            </div>
    </div>
  )


  return (
    <>
      <style>{`
        @keyframes ss-pop{0%{transform:scale(.4) rotate(-8deg);opacity:0}60%{transform:scale(1.15) rotate(2deg);opacity:1}100%{transform:scale(1) rotate(0)}}
        @keyframes ss-fall{0%{transform:translateY(-20px) rotate(0);opacity:0}10%{opacity:1}100%{transform:translateY(420px) rotate(540deg);opacity:0}}
        @keyframes ss-float3{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes ss-glow{0%,100%{box-shadow:0 0 0 3px rgba(255,255,255,.9),0 0 14px 4px var(--c)}50%{box-shadow:0 0 0 3px rgba(255,255,255,.9),0 0 26px 10px var(--c)}}
        @keyframes ss-ring3{0%{transform:translate(-50%,-50%) scale(.8);opacity:.7}100%{transform:translate(-50%,-50%) scale(1.9);opacity:0}}
        @keyframes ss-shake3{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
        @keyframes ss-burst{0%{transform:translate(-50%,0) scale(.3);opacity:0}30%{opacity:1}100%{transform:translate(-50%,-70px) scale(1.25);opacity:0}}
        @keyframes ss-spark{0%{transform:translate(0,0) scale(.4);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}
        @keyframes ss-say3{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}
        @keyframes ss-zzz{0%{transform:translate(0,0) scale(.7);opacity:0}25%{opacity:1}100%{transform:translate(18px,-46px) scale(1.15);opacity:0}}
        @keyframes ss-chip{0%{transform:scale(0)}70%{transform:scale(1.25)}100%{transform:scale(1)}}
        .ss-spot3{transition:transform .15s}
        .ss-spot3:not(:disabled):hover{transform:scale(1.12)!important}
        .ss-card{transition:transform .15s,box-shadow .15s}
        .ss-card:not(:disabled):hover{transform:translateY(-3px) scale(1.03);box-shadow:0 8px 18px rgba(0,0,0,.14)!important}
        @media (prefers-reduced-motion: reduce){
          .ss-stage *{animation:none!important}
        }
      `}</style>

      {headerSlot && header && createPortal(header, headerSlot)}

      {/* Custom story form */}
      {showCustomForm && (
        <div style={{ flexShrink: 0, padding: '8px 10px', borderBottom: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          <div style={{ fontSize: 16.5, fontFamily: '"DM Serif Display", serif', color: 'rgba(0,0,0,0.8)' }}>Create Custom Story</div>
          <input value={customTitle} onChange={e => setCustomTitle(e.target.value)} placeholder="Story title"
            style={{ background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 6, padding: '5px 8px', color: '#2b2f33', fontSize: 14, outline: 'none' }}
          />
          {customPanels.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ color: 'rgba(0,0,0,0.3)', fontSize: 13, minWidth: 14 }}>{i + 1}.</span>
              <div style={{ position: 'relative' }}>
                <span style={{ fontSize: 23.5, cursor: 'pointer' }}
                  onClick={() => {
                    const current = PICKER_EMOJIS.indexOf(p.emoji)
                    const next = PICKER_EMOJIS[(current + 1) % PICKER_EMOJIS.length]
                    const cp = [...customPanels]; cp[i] = { ...cp[i], emoji: next }; setCustomPanels(cp)
                  }}
                >{p.emoji}</span>
              </div>
              <input value={p.caption} onChange={e => { const cp = [...customPanels]; cp[i] = { ...cp[i], caption: e.target.value.slice(0, 40) }; setCustomPanels(cp) }}
                placeholder="Caption (max 40 chars)" maxLength={40}
                style={{ flex: 1, background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 4, padding: '4px 6px', color: '#2b2f33', fontSize: 13, outline: 'none' }}
              />
              {customPanels.length > 3 && (
                <button onClick={() => setCustomPanels(cp => cp.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', color: 'rgba(200,80,80,0.6)', cursor: 'pointer', padding: 2, fontSize: 13 }}>✕</button>
              )}
            </div>
          ))}
          {customPanels.length < 6 && (
            <button onClick={() => setCustomPanels(cp => [...cp, { emoji: '😊', caption: '' }])}
              style={{ padding: '3px 0', borderRadius: 4, border: '1px dashed rgba(0,0,0,0.15)', background: 'transparent', color: 'rgba(0,0,0,0.4)', cursor: 'pointer', fontSize: 13 }}
            >+ Add panel</button>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={saveCustomStory}
              style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: '1px solid rgba(74,124,111,0.5)', background: 'rgba(74,124,111,0.2)', color: '#1F7A44', cursor: 'pointer', fontSize: 14 }}
            >Save & use</button>
            <button onClick={() => setShowCustomForm(false)}
              style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: 'transparent', color: 'rgba(0,0,0,0.4)', cursor: 'pointer', fontSize: 14 }}
            >Cancel</button>
          </div>
        </div>
      )}

      {/* No story resolved — previously the therapist just got a blank panel here */}
      {!currentStory && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20, color: 'rgba(0,0,0,0.3)', fontSize: 16.5 }}>
          {isT ? 'Pick a story above to begin.' : 'Waiting for therapist to choose a story...'}
        </div>
      )}

      {currentStory && (
        <div style={{ flex: 1, position: 'relative', overflowX: 'hidden', overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', padding: 14, gap: 10 }}>
          {!headerSlot && header}

          {/* The 3D room */}
          <div className="ss-stage" style={{
            position: 'relative', flex: '1 0 380px', minHeight: 380, borderRadius: 18, overflow: 'hidden',
            background: 'linear-gradient(180deg,#e8f3fb,#d6e6f4)',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06), 0 6px 18px rgba(23,58,94,0.08)',
          }}>
            <Scene3D
              storyId={storyId}
              spots={sceneSpots}
              kidAt={kid.at}
              mood={mood}
              kidSays={kidSays}
              guideId={showGuide && !liveWrongSlot ? nextCorrectId : null}
              showCaptions={difficulty !== 'challenge'}
              walkMs={WALK_MS}
              onSpot={onSpot}
              doneIds={doneIds}
              actionId={acting ? kid.at : null}
            />
          </div>

          {/* Action cards + suggested order */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
            <div style={{ flex: '3 1 360px', minWidth: 0, display: 'flex', gap: 12, padding: 12, borderRadius: 18, background: '#f7fafd', border: '1px solid #e1ebf4', overflowX: 'auto' }}>
              {resolvedShuffled.map(id => {
                const panel = panelMap.get(id)
                const spot = spots.get(id)
                if (!panel || !spot) return null
                const used = slotOf.has(id)
                const c = CARD_COLORS[spot.i % CARD_COLORS.length]
                const clickable = canDrop && !completed && !used
                return (
                  <button key={id} className="ss-card" disabled={!clickable} onClick={() => clickable && pick(id)}
                    aria-label={panel.caption}
                    style={{
                      flex: '1 0 110px', minHeight: 112, borderRadius: 16, padding: '10px 8px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                      background: c.bg, border: `2px solid ${c.bd}`, cursor: clickable ? 'pointer' : 'default',
                      opacity: used ? 0.32 : 1, filter: used ? 'grayscale(.6)' : undefined,
                      transform: used ? 'scale(.94)' : undefined,
                      boxShadow: hintPanel === id && !used ? `0 0 0 3px ${c.bd}88` : '0 2px 6px rgba(0,0,0,0.06)',
                    }}
                  >
                    <span style={{ fontSize: 42, lineHeight: 1 }}>{panel.emoji}</span>
                    {difficulty !== 'challenge' && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#173a5e', textAlign: 'center', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{panel.caption}</span>
                    )}
                  </button>
                )
              })}
            </div>

            {difficulty === 'guided' && (
              <div style={{ flex: '1 1 220px', padding: '12px 16px', borderRadius: 18, background: '#f7fafd', border: '1px solid #e1ebf4', minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#173a5e', marginBottom: 8 }}>💡 Suggested Order</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {orderedPanels.map((p, i) => {
                    const c = CARD_COLORS[(spots.get(p.id)?.i ?? i) % CARD_COLORS.length]
                    const done = placed[String(i)] === p.id
                    return (
                      <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span title={p.caption} style={{
                          width: 32, height: 32, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: done ? 16 : 15, fontWeight: 800, color: '#173a5e', background: done ? '#dcf3e6' : c.bg, border: `1.5px solid ${done ? '#2f9e62' : c.bd}`,
                        }}>{done ? '✓' : i + 1}</span>
                        {i < orderedPanels.length - 1 && <span style={{ color: 'rgba(23,58,94,0.35)', fontSize: 11 }}>›</span>}
                      </span>
                    )
                  })}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(23,58,94,0.75)', marginTop: 8, lineHeight: 1.45 }}>
                  {orderedPanels.map(p => p.caption).join(' → ')}
                </div>
              </div>
            )}
          </div>

          {/* Check / replay controls and score */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            {completed ? null : !instantFeedback ? (
              <button onClick={handleCheck} disabled={!canCheck}
                style={{
                  padding: '7px 18px', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: canCheck ? 'pointer' : 'default',
                  background: canCheck ? '#22a894' : 'rgba(0,0,0,0.05)', border: 'none',
                  color: canCheck ? '#fff' : 'rgba(0,0,0,0.3)',
                }}
              >Check my story ✓</button>
            ) : null}
            {(attempts || 0) >= 3 && isT && !completed && (
              <button onClick={revealAnswer}
                style={{ padding: '6px 12px', borderRadius: 10, border: '1px solid rgba(200,96,42,0.3)', background: 'rgba(200,96,42,0.1)', color: 'rgba(170,90,50,0.9)', cursor: 'pointer', fontSize: 13 }}
              >Show answer</button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 13, color: 'rgba(0,0,0,0.45)', display: 'flex', gap: 14 }}>
              <span>🌟 {storiesDone} stories completed</span>
              <span>🔄 {attempts || 0} {attempts === 1 ? 'miss' : 'misses'}</span>
            </span>
          </div>
        </div>
      )}

      {/* Completion overlay — held back until the full read-back has played */}
      {completed && waiting && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
          background: 'rgba(74,124,111,0.2)', backdropFilter: 'blur(6px)', zIndex: 50, padding: 20,
        }}>
          {/* Confetti burst */}
          <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            {Array.from({ length: 18 }, (_, i) => (
              <span key={i} style={{
                position: 'absolute', top: 0, left: `${(i * 37) % 100}%`, fontSize: 22,
                animation: `ss-fall ${1.8 + (i % 5) * 0.3}s ease-in ${(i % 6) * 0.15}s forwards`, opacity: 0,
              }}>{['🎉', '⭐', '🌟', '🎊', '✨'][i % 5]}</span>
            ))}
          </div>
          <div style={{ fontSize: 39, animation: 'ss-pop .5s ease' }}>🌟</div>
          <div style={{ fontSize: 21, fontFamily: '"DM Serif Display", serif', color: '#2b2f33', textAlign: 'center' }}>You got the story right!</div>
          {/* The finished story as a strip, so the child sees the whole sequence. */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            {orderedPanels.map((p, i) => (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 28, animation: `ss-pop .4s ease ${i * 0.12}s both` }}>{p.emoji}</span>
                {i < orderedPanels.length - 1 && <span style={{ color: 'rgba(0,0,0,0.3)' }}>→</span>}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 16, color: 'rgba(0,0,0,0.5)' }}>Misses: {attempts || 0}</div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)', textAlign: 'center' }}>
            {isT ? 'Play the same set again, or move on to a new one.' : 'Play the same set again, or wait for a new one.'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={resetStory}
              style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(0,0,0,0.07)', color: 'rgba(0,0,0,0.8)', cursor: 'pointer', fontSize: 16 }}
            >Same set</button>
            {isT && (
              <button onClick={nextStory}
                style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(74,124,111,0.4)', background: 'rgba(74,124,111,0.2)', color: '#1F7A44', cursor: 'pointer', fontSize: 16 }}
              >New set</button>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', borderRadius: 10,
          padding: '8px 16px', color: '#fff', fontSize: 16.5, zIndex: 100, pointerEvents: 'none',
        }}>
          {toast.msg}
        </div>
      )}
    </>
  )
}
