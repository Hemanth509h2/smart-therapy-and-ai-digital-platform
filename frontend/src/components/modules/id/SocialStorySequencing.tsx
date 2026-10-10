'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { deleteField, doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'

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
      { id: 's1p1', emoji: '😴', caption: 'Wake up when the alarm rings', correctIndex: 0 },
      { id: 's1p2', emoji: '🦷', caption: 'Brush teeth and wash face', correctIndex: 1 },
      { id: 's1p3', emoji: '👕', caption: 'Put on school clothes', correctIndex: 2 },
      { id: 's1p4', emoji: '🍳', caption: 'Eat breakfast', correctIndex: 3 },
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

const PLAY_DUR = 1200
const TRANS_DUR = 300

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

  const [dragItem, setDragItem] = useState<string | null>(null)
  const [hoverSlot, setHoverSlot] = useState<number | null>(null)
  const [wrongSlots, setWrongSlots] = useState<Set<number>>(new Set())
  const [correctSlots, setCorrectSlots] = useState<Set<number>>(new Set())
  const [playIdx, setPlayIdx] = useState(-1)
  const [hintPanel, setHintPanel] = useState<string | null>(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null)
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customTitle, setCustomTitle] = useState('')
  const [customPanels, setCustomPanels] = useState<{ emoji: string; caption: string }[]>(Array.from({ length: 4 }, () => ({ emoji: '😊', caption: '' })))
  const [toast, setToast] = useState<{ msg: string } | null>(null)
  /* Tap-to-place: tap a card, then tap the slot it belongs in. Dragging still
     works; this is for small hands and touch screens where a drag is hard. */
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  /* The slot that just received a card, for the pop-in animation. */
  const [justPlaced, setJustPlaced] = useState<{ idx: number; k: number } | null>(null)
  // The celebration replay runs on the board itself; `waiting` flips to true only
  // once every panel has been walked through and read, and that is what reveals
  // the same-set / new-set choice.
  const [waiting, setWaiting] = useState(false)

  const cRef = useRef<HTMLDivElement>(null)
  const isDrag = useRef(false)
  const dragId = useRef<string | null>(null)
  const toastT = useRef<ReturnType<typeof setTimeout>>()
  const playT = useRef<ReturnType<typeof setTimeout>>()
  const chain = useRef<ReturnType<typeof setTimeout>[]>([])
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
    setWrongSlots(new Set())
    setCorrectSlots(new Set())
    setHintPanel(null)
    setShowAnswer(false)
    setPlayIdx(-1)
    setSelectedCard(null)
  }, [write, customStory])

  const handleDrop = useCallback((panelId: string, slotIdx: number) => {
    if (!canDrop || completed) return
    if (Object.values(placed).includes(panelId)) return
    const slotKey = String(slotIdx)
    // A filled slot is not overwritten — tap it first to send its card back.
    if (placed[slotKey]) return
    lastDropMine.current = true
    // Optimistic, so the card lands at once instead of after the round trip.
    setPlaced(prev => ({ ...prev, [slotKey]: panelId }))
    write({ [`moduleState.ssPlaced.${slotKey}`]: panelId })
    setSelectedCard(null)
    setJustPlaced({ idx: slotIdx, k: Date.now() })
    setWrongSlots(prev => { const n = new Set(prev); n.delete(slotIdx); return n })
    setCorrectSlots(prev => { const n = new Set(prev); n.delete(slotIdx); return n })
  }, [canDrop, completed, placed, write])

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
      const storyTitle = customStory && storyId === 'custom'
        ? customStory.title
        : STORIES.find(s => s.id === storyId)?.title ?? storyId
      logModuleEvent(sessionId, {
        module: 'social-story-sequencing',
        type: 'story_completed',
        detail: `Sequenced "${storyTitle}" correctly in ${(attempts || 0) + 1} attempt${(attempts || 0) + 1 === 1 ? '' : 's'}`,
      })
      showToast('🌟 You got the story right!')
      // The replay itself is driven by the effect below, so both therapist and
      // client walk through the finished story, not just whoever hit Check.
    } else {
      setWrongSlots(wrong)
      setCorrectSlots(correct)
      const na = (attempts || 0) + 1
      write({ 'moduleState.ssAttempts': na })
      showToast('Almost! Try moving the highlighted panels')
      if (na >= 2) {
        const firstWrong = Array.from(wrong)[0]
        const correctPanelId = activePanels.find(p => p.correctIndex === firstWrong)?.id
        if (correctPanelId) setHintPanel(correctPanelId)
      }
    }
  }, [allFilled, placed, slotCount, panelMap, write, storiesDone, showToast, activePanels, attempts, sessionId, storyId, customStory])

  /* Guided and Standard give feedback the moment a card lands — green ✓ in the
     right slot, red ✗ and a shake in the wrong one — straight from the shared
     placement, so both screens show the same marks. Challenge still waits for
     Check, which is what makes it the hard mode. */
  const instantFeedback = difficulty !== 'challenge'

  /* When the last card lands, check automatically (only on the screen that
     placed it, so the result is written once). */
  useEffect(() => {
    if (!instantFeedback || !allFilled || completed || showAnswer) return
    if (!lastDropMine.current) return
    lastDropMine.current = false
    handleCheck()
  }, [instantFeedback, allFilled, completed, showAnswer, handleCheck])

  const orderedPanels = useMemo(
    () => [...activePanels].sort((a, b) => a.correctIndex - b.correctIndex),
    [activePanels],
  )
  const orderedRef = useRef(orderedPanels)
  orderedRef.current = orderedPanels
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

  // Once the story is right, hold on the board and walk the panels in order,
  // lighting each one up in turn, before offering the same-set / new-set choice.
  // Silent by design: the voice read-back was removed at the clinic's request.
  useEffect(() => {
    if (!completed) {
      stopReplay()
      setPlayIdx(-1)
      setWaiting(false)
      return
    }

    const run = ++replayRun.current
    const alive = () => replayRun.current === run
    const ordered = orderedRef.current
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => { if (alive()) fn() }, ms)
      chain.current.push(t)
    }

    let i = 0
    const step = () => {
      if (i >= ordered.length) {
        setPlayIdx(-1)
        after(600, () => setWaiting(true))
        return
      }
      i += 1
      setPlayIdx(i - 1)
      after(PLAY_DUR + TRANS_DUR, step)
    }

    after(700, step)

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

  const skipReplay = useCallback(() => {
    stopReplay()
    setPlayIdx(-1)
    setWaiting(true)
  }, [stopReplay])

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
    setShowCustomForm(false)
  }, [customTitle, customPanels, write, showToast])

  // --- HTML5 Drag ---
  const onDragStart = useCallback((e: React.DragEvent, panelId: string) => {
    if (!canDrop || completed) return
    isDrag.current = true
    dragId.current = panelId
    e.dataTransfer.setData('text/plain', panelId)
    e.dataTransfer.effectAllowed = 'move'
  }, [canDrop, completed])

  const onDragEnd = useCallback(() => { isDrag.current = false; dragId.current = null; setHoverSlot(null) }, [])

  const onSlotDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }, [])
  const onSlotDragEnter = useCallback((e: React.DragEvent, idx: number) => { e.preventDefault(); setHoverSlot(idx) }, [])
  const onSlotDragLeave = useCallback(() => setHoverSlot(null), [])

  const onSlotDrop = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || dragId.current
    setHoverSlot(null)
    if (id) handleDrop(id, idx)
  }, [handleDrop])

  // --- Touch ---
  useEffect(() => {
    const el = cRef.current
    if (!el) return
    const onTM = (e: TouchEvent) => {
      if (!isDrag.current || !dragId.current) return
      e.preventDefault()
      const t = e.touches[0]
      setGhostPos({ x: t.clientX, y: t.clientY })
      const el2 = document.elementFromPoint(t.clientX, t.clientY)
      const slotEl = el2?.closest('[data-slot]')
      setHoverSlot(slotEl ? parseInt(slotEl.getAttribute('data-slot')!) : null)
    }
    const onTE = (e: TouchEvent) => {
      if (!isDrag.current || !dragId.current) return
      const t = e.changedTouches[0]
      const el2 = document.elementFromPoint(t.clientX, t.clientY)
      const slotEl = el2?.closest('[data-slot]')
      if (slotEl) handleDrop(dragId.current, parseInt(slotEl.getAttribute('data-slot')!))
      isDrag.current = false
      dragId.current = null
      setGhostPos(null)
      setHoverSlot(null)
    }
    el.addEventListener('touchmove', onTM, { passive: false })
    el.addEventListener('touchend', onTE)
    el.addEventListener('touchcancel', onTE)
    return () => { el.removeEventListener('touchmove', onTM); el.removeEventListener('touchend', onTE); el.removeEventListener('touchcancel', onTE) }
  }, [handleDrop])

  const onTouchStart = useCallback((panelId: string) => (e: React.TouchEvent) => {
    if (!canDrop || completed) return
    e.preventDefault()
    isDrag.current = true
    dragId.current = panelId
    setGhostPos({ x: e.touches[0].clientX, y: e.touches[0].clientY })
  }, [canDrop, completed])

  const canCheck = allFilled && !completed && !showAnswer

  // A card in hand that the other screen has just placed is no longer in hand.
  useEffect(() => {
    if (selectedCard && !unplacedIds.includes(selectedCard)) setSelectedCard(null)
  }, [selectedCard, unplacedIds])

  return (
    <>
      <style>{`
        @keyframes sf{0%{opacity:0;transform:scale(.8)}100%{opacity:1;transform:scale(1)}}
        @keyframes sh{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
        .pk-a{animation:sf .3s ease}
        .sh-a{animation:sh .35s ease}
        @keyframes pl{0%,100%{box-shadow:0 0 0 rgba(74,124,111,0)}50%{box-shadow:0 0 16px rgba(74,124,111,.4)}}
        .hint-pulse{animation:pl 1s ease-in-out infinite}
        @keyframes ss-pop{0%{transform:scale(.4) rotate(-8deg);opacity:0}60%{transform:scale(1.15) rotate(2deg);opacity:1}100%{transform:scale(1) rotate(0)}}
        @keyframes ss-badge{0%{transform:scale(0)}70%{transform:scale(1.3)}100%{transform:scale(1)}}
        @keyframes ss-next{0%,100%{border-color:rgba(74,124,111,.25)}50%{border-color:rgba(74,124,111,.9)}}
        @keyframes ss-lift{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @keyframes ss-fall{0%{transform:translateY(-20px) rotate(0);opacity:0}10%{opacity:1}100%{transform:translateY(420px) rotate(540deg);opacity:0}}
        .ss-card:hover{transform:translateY(-3px) scale(1.04)!important;box-shadow:0 8px 18px rgba(0,0,0,.18)!important}
      `}</style>

      {/* Therapist controls */}
      {isT && (
        <div style={{ flexShrink: 0, padding: '6px 10px', borderBottom: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'thin' }}>
            {STORIES.map(s => (
              <button key={s.id} onClick={() => loadStory(s.id)}
                style={{
                  whiteSpace: 'nowrap', padding: '3px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 13,
                  border: storyId === s.id ? '1px solid rgba(74,124,111,0.6)' : '1px solid rgba(0,0,0,0.08)',
                  background: storyId === s.id ? 'rgba(74,124,111,0.2)' : 'transparent',
                  color: storyId === s.id ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.4)',
                }}
              >{s.title}</button>
            ))}
            {customStory && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', flexShrink: 0, borderRadius: 10, overflow: 'hidden',
                border: storyId === 'custom' ? '1px solid rgba(74,124,111,0.6)' : '1px solid rgba(0,0,0,0.08)',
                background: storyId === 'custom' ? 'rgba(74,124,111,0.2)' : 'transparent',
              }}>
                <button onClick={() => loadStory('custom')}
                  style={{
                    whiteSpace: 'nowrap', padding: '3px 4px 3px 8px', border: 'none', background: 'transparent',
                    cursor: 'pointer', fontSize: 13,
                    color: storyId === 'custom' ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.4)',
                  }}
                >📝 {customStory.title}</button>
                <button onClick={clearCustomStory} title="Remove this custom story"
                  style={{ padding: '3px 7px 3px 3px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}
                >✕</button>
              </span>
            )}
            <button onClick={() => setShowCustomForm(true)}
              style={{ whiteSpace: 'nowrap', padding: '3px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 13, border: '1px dashed rgba(0,0,0,0.2)', background: 'transparent', color: 'rgba(0,0,0,0.4)' }}
            >+ Custom</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'rgba(0,0,0,0.4)' }}>Difficulty:</span>
            {['guided', 'standard', 'challenge'].map(d => (
              <button key={d} onClick={() => write({ 'moduleState.ssDifficulty': d, 'moduleState.ssPlaced': {}, 'moduleState.ssAttempts': 0, 'moduleState.ssCompleted': false })}
                style={{
                  padding: '2px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 13, textTransform: 'capitalize',
                  border: difficulty === d ? '1px solid rgba(74,124,111,0.6)' : '1px solid rgba(0,0,0,0.08)',
                  background: difficulty === d ? 'rgba(74,124,111,0.15)' : 'transparent',
                  color: difficulty === d ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.35)',
                }}
              >{d === 'challenge' ? 'Challenge' : d === 'standard' ? 'Standard' : 'Guided'}</button>
            ))}
          </div>
        </div>
      )}

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
        <div ref={cRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column', padding: 18, gap: 14, touchAction: 'none' }}>
          {/* Story title */}
          <div style={{ fontSize: 17.5, fontFamily: '"DM Serif Display", serif', color: 'rgba(0,0,0,0.8)', textAlign: 'center', flexShrink: 0 }}>
            {currentStory.title}
          </div>

          {/* Sequence slots */}
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            {Array.from({ length: slotCount }, (_, idx) => {
              const pid = placed[String(idx)]
              const panel = pid ? panelMap.get(pid) : null
              const isHover = hoverSlot === idx
              const liveRight = instantFeedback && !!panel && panel.correctIndex === idx
              const liveWrong = instantFeedback && !!panel && panel.correctIndex !== idx
              const isWrong = wrongSlots.has(idx) || liveWrong
              const isCorrect = correctSlots.has(idx) || liveRight
              const isPlay = playIdx === idx
              const isOccupied = !!pid
              // The first empty slot breathes when a card is in hand (tapped).
              const firstEmpty = Array.from({ length: slotCount }, (_, j) => j).find(j => !placed[String(j)])
              const isTarget = !isOccupied && !!selectedCard && idx === firstEmpty
              const pop = justPlaced && justPlaced.idx === idx
              return (
                <div key={idx} data-slot={idx}
                  onDragOver={onSlotDragOver}
                  onDragEnter={e => onSlotDragEnter(e, idx)}
                  onDragLeave={onSlotDragLeave}
                  onDrop={e => onSlotDrop(e, idx)}
                  style={{
                    // minHeight rather than aspectRatio: with six panels each slot
                    // is only ~55px wide, and a fixed ratio left no room for the
                    // caption to wrap.
                    flex: 1, minWidth: 0, minHeight: slotCount >= 5 ? 100 : 92, borderRadius: 12,
                    background: isPlay ? 'rgba(74,124,111,0.2)' : isWrong ? 'rgba(200,96,42,0.15)' : isCorrect ? 'rgba(74,124,111,0.15)' : isHover ? 'rgba(74,124,111,0.1)' : 'rgba(0,0,0,0.04)',
                    border: isPlay ? '2px solid #4a7c6f' : isWrong ? '1.5px solid rgba(200,96,42,0.5)' : isCorrect ? '1.5px solid rgba(74,124,111,0.6)' : isHover ? '1.5px solid rgba(74,124,111,0.4)' : '1.5px dashed rgba(0,0,0,0.15)',
                    borderStyle: isHover ? 'solid' : isPlay ? 'solid' : isWrong ? 'solid' : isCorrect ? 'solid' : 'dashed',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '4px 3px',
                    transition: 'all 0.2s', cursor: canDrop && (!isOccupied || !liveRight) ? 'pointer' : 'default',
                    transform: isPlay ? 'scale(1.08)' : isHover ? 'scale(1.03)' : 'scale(1)',
                    boxShadow: isPlay ? '0 0 16px rgba(74,124,111,0.3)' : 'none',
                    position: 'relative',
                    ...(isTarget ? { animation: 'ss-next 1s ease-in-out infinite', borderStyle: 'solid', borderWidth: 2 } : {}),
                  }}
                  onClick={() => {
                    if (!canDrop || completed) return
                    // Tap-to-place: a card is in hand and this slot is empty.
                    if (!isOccupied && selectedCard) { handleDrop(selectedCard, idx); return }
                    // A card already proven right stays put; anything else goes back.
                    if (isOccupied && !liveRight) removeFromSlot(idx)
                  }}
                >
                  {/* Step number, always visible, so the strip reads as 1-2-3. */}
                  <span style={{
                    position: 'absolute', top: 4, left: 6, fontSize: 11, fontWeight: 800,
                    color: isCorrect ? '#1F7A44' : isWrong ? '#B4432C' : 'rgba(0,0,0,0.3)',
                  }}>{idx + 1}</span>
                  {(isCorrect || isWrong) && panel && (
                    <span key={`${pid}-${isCorrect}`} style={{
                      position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: '50%',
                      background: isCorrect ? '#1F7A44' : '#B4432C', color: '#fff', fontSize: 13, fontWeight: 900,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.25)', animation: 'ss-badge .3s ease', zIndex: 2,
                    }}>{isCorrect ? '✓' : '✗'}</span>
                  )}
                  {panel ? (
                    <div key={pop ? justPlaced!.k : pid} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                      animation: pop
                        ? (liveWrong ? 'ss-pop .4s ease, sh .35s ease .4s 2' : 'ss-pop .4s ease')
                        : isPlay ? 'ss-lift .6s ease-in-out infinite' : undefined,
                    }}>
                      <span style={{ fontSize: slotCount >= 5 ? 26 : 31.5, lineHeight: 1 }}>{panel.emoji}</span>
                      {difficulty !== 'challenge' && (
                        <span style={{ fontSize: slotCount >= 5 ? 9.5 : 11, color: 'rgba(0,0,0,0.7)', textAlign: 'center', lineHeight: 1.15, overflowWrap: 'anywhere' }}>{panel.caption}</span>
                      )}
                    </div>
                  ) : (
                    <>
                      {difficulty === 'guided' && (
                        <span style={{ fontSize: 19.5, color: 'rgba(0,0,0,0.15)', fontWeight: 700 }}>{idx + 1}</span>
                      )}
                      <span style={{ fontSize: 12, color: isTarget ? '#1F7A44' : 'rgba(0,0,0,0.25)', fontWeight: isTarget ? 700 : 400 }}>
                        {selectedCard ? 'Tap to place' : 'Drop here'}
                      </span>
                    </>
                  )}
                  {isWrong && <div className="sh-a" style={{ position: 'absolute', inset: 0, borderRadius: 12, pointerEvents: 'none' }} />}
                </div>
              )
            })}
          </div>

          {/* What to do next, in words. */}
          {!completed && (
            <div style={{ textAlign: 'center', fontSize: 14, color: 'rgba(0,0,0,0.55)', flexShrink: 0 }}>
              {selectedCard
                ? '👆 Now tap the box where this card goes'
                : unplacedIds.length
                  ? `What happens next? Drag a card, or tap it then tap a box · ${placedCount} of ${slotCount} placed`
                  : instantFeedback ? 'Fix any red ✗ cards — tap one to send it back' : 'All placed — press Check my story!'}
            </div>
          )}

          {/* Shuffled panel cards */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 12, minHeight: 132, alignContent: 'flex-start', alignItems: 'flex-start', justifyContent: 'center', background: 'rgba(0,0,0,0.035)', borderRadius: 14, border: '1px dashed rgba(0,0,0,0.14)', flex: 1, overflowY: 'auto' }}>
            {unplacedIds.map(id => {
              const panel = panelMap.get(id)
              if (!panel) return null
              const isHint = hintPanel === id
              const isSel = selectedCard === id
              return (
                <div key={id}
                  draggable={canDrop && !completed}
                  onDragStart={e => onDragStart(e, id)}
                  onDragEnd={onDragEnd}
                  onTouchStart={onTouchStart(id)}
                  onClick={() => { if (canDrop && !completed) setSelectedCard(isSel ? null : id) }}
                  className={`ss-card ${isHint ? 'hint-pulse' : ''}`}
                  style={{
                    // Sized to fit three per row in the 420px panel. Height is a
                    // minimum, not a fixed box, and the caption is unclamped, so a
                    // long line grows the card instead of ending in an ellipsis.
                    width: 104, minHeight: difficulty === 'challenge' ? 76 : 112, borderRadius: 12,
                    background: isSel ? 'rgba(74,124,111,0.18)' : '#ffffff',
                    border: isSel ? '2.5px solid #1F7A44' : isHint ? '1.5px solid rgba(74,124,111,0.5)' : '1.5px solid rgba(0,0,0,0.12)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 6px',
                    cursor: canDrop && !completed ? 'grab' : 'default',
                    transition: 'all 0.15s', userSelect: 'none', WebkitUserSelect: 'none',
                    boxShadow: dragItem === id ? '0 8px 20px rgba(0,0,0,0.3)' : '0 2px 6px rgba(0,0,0,0.2)',
                    opacity: dragItem === id ? 0.8 : 1,
                    transform: dragItem === id || isSel ? 'scale(1.1)' : 'scale(1)',
                  }}
                >
                  <span style={{ fontSize: 30, lineHeight: 1 }}>{panel.emoji}</span>
                  {difficulty !== 'challenge' && (
                    <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.72)', textAlign: 'center', lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                      {panel.caption}
                    </span>
                  )}
                </div>
              )
            })}
            {unplacedIds.length === 0 && <div style={{ width: '100%', textAlign: 'center', color: 'rgba(0,0,0,0.2)', fontSize: 13, padding: 8 }}>All panels placed!</div>}
          </div>

          {/* Check button, or the read-back banner once the story is solved */}
          {completed && !waiting ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(74,124,111,0.14)', border: '1px solid rgba(74,124,111,0.35)',
            }}>
              <span style={{ fontSize: 15, color: '#1F7A44' }}>
                ▶ Playing your story in order… {Math.min(playIdx + 1, slotCount) || 1} of {slotCount}
              </span>
              <button onClick={skipReplay}
                style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(255,255,255,0.5)', color: 'rgba(0,0,0,0.6)', cursor: 'pointer', fontSize: 14 }}
              >Skip</button>
            </div>
          ) : (
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <button onClick={handleCheck}
              disabled={!canCheck}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 16, cursor: canCheck ? 'pointer' : 'default',
                background: canCheck ? 'rgba(74,124,111,0.3)' : 'rgba(0,0,0,0.04)',
                border: canCheck ? '1px solid rgba(74,124,111,0.4)' : '1px solid rgba(0,0,0,0.08)',
                color: canCheck ? '#1F7A44' : 'rgba(0,0,0,0.25)',
                opacity: canCheck ? 1 : 0.4,
              }}
            >Check my story ✓</button>
            {(attempts || 0) >= 3 && isT && !completed && (
              <button onClick={revealAnswer}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(200,96,42,0.3)', background: 'rgba(200,96,42,0.1)', color: 'rgba(200,120,80,0.8)', cursor: 'pointer', fontSize: 14 }}
              >Show answer</button>
            )}
          </div>
          )}

          {/* Score */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, color: 'rgba(0,0,0,0.4)', flexShrink: 0 }}>
            <span>🌟 {storiesDone} stories completed</span>
            <span>🔄 Attempt {attempts || 0} on this story</span>
          </div>
        </div>
      )}

      {/* Touch ghost */}
      {ghostPos && dragId.current && panelMap.get(dragId.current) && (
        <div style={{
          position: 'fixed', left: ghostPos.x - 52, top: ghostPos.y - 76,
          width: 104, minHeight: 112, borderRadius: 12, zIndex: 1000, pointerEvents: 'none',
          background: 'rgba(74,124,111,0.15)', border: '1.5px solid rgba(74,124,111,0.4)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
          boxShadow: '0 8px 20px rgba(0,0,0,0.3)', transform: 'scale(1.1)', opacity: 0.85, padding: '8px 6px',
        }}>
          <span style={{ fontSize: 30, lineHeight: 1 }}>{panelMap.get(dragId.current)!.emoji}</span>
          {difficulty !== 'challenge' && (
            <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.72)', textAlign: 'center', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{panelMap.get(dragId.current)!.caption}</span>
          )}
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
          <div style={{ fontSize: 16, color: 'rgba(0,0,0,0.5)' }}>Attempts: {attempts || 0}</div>
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
