'use client'

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import {
  Leaf,
  Waves,
  Moon,
  Timer,
  Box,
  Flag,
  Ban,
  Footprints,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Lock,
} from 'lucide-react'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { staadPraise } from '@/lib/voice/staadVoice'
import { useVoiceLanguage } from '@/lib/voice/useVoiceLanguage'

interface VirtualMazeProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type Difficulty = 'easy' | 'medium' | 'hard'
type ThemeName = 'calm' | 'ocean' | 'night'
type Direction = 'up' | 'down' | 'left' | 'right'

interface Pos {
  row: number
  col: number
}

const DIFFICULTY_MAP: Record<Difficulty, number> = {
  easy: 7,
  medium: 11,
  hard: 15,
}

/* Segmented control copy: bold name stacked over the muted grid size. */
const DIFFICULTY_LABELS: { key: Difficulty; label: string; size: string }[] = [
  { key: 'easy', label: 'Easy', size: '7 × 7' },
  { key: 'medium', label: 'Medium', size: '11 × 11' },
  { key: 'hard', label: 'Hard', size: '15 × 15' },
]

const THEME_LIST: { key: ThemeName; label: string; Icon: typeof Leaf; tint: string }[] = [
  { key: 'calm', label: 'Calm', Icon: Leaf, tint: '#3fae6a' },
  { key: 'ocean', label: 'Ocean', Icon: Waves, tint: '#2563EB' },
  { key: 'night', label: 'Night', Icon: Moon, tint: '#6d5bd0' },
]

/* ---- Design tokens for the light module canvas (#ffffff) ----
   Dark ink on light surfaces everywhere; white only ever sits on a solid
   saturated fill (navy walls, coral start marker, the green player sprite). */
const UI = {
  card: '#ffffff',
  border: '#e7eaef',
  shadow: '0 6px 18px rgba(20,30,40,0.05)',
  shadowKey: '0 6px 16px rgba(20,30,40,0.10)',
  ink: '#1e2a3a',
  inkSoft: '#4b5563',
  muted: '#8b9096',
  blue: '#2563EB',
  blueSoft: 'rgba(37,99,235,0.07)',
  coral: '#ff5a5f',
  coralInk: '#e0393f',
  coralSoft: 'rgba(255,90,95,0.10)',
  green: '#3fae6a',
  greenInk: '#2f7d4f',
  greenSoft: 'rgba(63,174,106,0.12)',
} as const

/* Theme now only re-tints the maze surfaces — the trail, start marker and goal
   keep the reference palette (coral / green) so contrast never regresses. */
const THEME_COLORS: Record<ThemeName, {
  wall: string
  wallEdge: string
  board: string
  corridor: string
}> = {
  calm: { wall: '#1e2a3a', wallEdge: '#33415a', board: '#f4f7f5', corridor: '#ffffff' },
  ocean: { wall: '#16324c', wallEdge: '#2b5478', board: '#f1f6fb', corridor: '#ffffff' },
  night: { wall: '#1c1b30', wallEdge: '#37345c', board: '#f5f3fb', corridor: '#ffffff' },
}

const START: Pos = { row: 0, col: 0 }

const TIME_LIMITS = [60, 90, 120]

function generateMaze(gridSize: number): { maze: number[]; startPos: Pos; goalPos: Pos } {
  const cells = gridSize * gridSize
  const maze = new Array(cells).fill(1)
  const visited = new Set<string>()

  const getIdx = (r: number, c: number) => r * gridSize + c
  const inBounds = (r: number, c: number) => r >= 0 && r < gridSize && c >= 0 && c < gridSize
  const isRoom = (r: number, c: number) => r % 2 === 0 && c % 2 === 0

  const stack: Pos[] = [{ row: 0, col: 0 }]
  maze[getIdx(0, 0)] = 0
  visited.add('0-0')

  while (stack.length > 0) {
    const current = stack[stack.length - 1]
    const neighbors: { dr: number; dc: number }[] = []

    for (const [dr, dc] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
      const nr = current.row + dr
      const nc = current.col + dc
      const key = `${nr}-${nc}`
      if (inBounds(nr, nc) && isRoom(nr, nc) && !visited.has(key)) {
        neighbors.push({ dr, dc })
      }
    }

    if (neighbors.length > 0) {
      const { dr, dc } = neighbors[Math.floor(Math.random() * neighbors.length)]
      const nr = current.row + dr
      const nc = current.col + dc

      const wallR = current.row + dr / 2
      const wallC = current.col + dc / 2
      maze[getIdx(wallR, wallC)] = 0
      maze[getIdx(nr, nc)] = 0
      visited.add(`${nr}-${nc}`)
      stack.push({ row: nr, col: nc })
    } else {
      stack.pop()
    }
  }

  return {
    maze,
    startPos: { row: 0, col: 0 },
    goalPos: { row: gridSize - 1, col: gridSize - 1 },
  }
}

function getRating(wrongMoves: number): { stars: string; text: string } {
  if (wrongMoves <= 2) return { stars: '⭐⭐⭐', text: 'Perfect!' }
  if (wrongMoves <= 5) return { stars: '⭐⭐', text: 'Great job!' }
  return { stars: '⭐', text: 'Keep practising!' }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function VirtualMaze({ sessionId, role, isLocked }: VirtualMazeProps) {
  const isTherapist = role === 'therapist'
  const canInteract = isTherapist || !isLocked

  const voiceLanguage = useVoiceLanguage(sessionId)
  const voiceLangRef = useRef(voiceLanguage)
  voiceLangRef.current = voiceLanguage

  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [themeName, setThemeName] = useState<ThemeName>('calm')
  const [gridSize, setGridSize] = useState(7)
  const [maze, setMaze] = useState<number[]>([])
  const [playerPos, setPlayerPos] = useState<Pos>({ row: 0, col: 0 })
  const [goalPos, setGoalPos] = useState<Pos>({ row: 0, col: 0 })
  const [visited, setVisited] = useState<string[]>([])
  const [wrongMoves, setWrongMoves] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [completionTime, setCompletionTime] = useState(0)
  const [timerMode, setTimerMode] = useState(false)
  const [timeLimit, setTimeLimit] = useState(60)
  const [timeRemaining, setTimeRemaining] = useState(60)
  const [timeUp, setTimeUp] = useState(false)
  const [mazeReady, setMazeReady] = useState(false)
  const [bumpCell, setBumpCell] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [startTime, setStartTime] = useState<number | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const elapsedRef = useRef<ReturnType<typeof setInterval>>()
  const timeRemainingRef = useRef(timeRemaining)
  timeRemainingRef.current = timeRemaining

  const theme = THEME_COLORS[themeName]

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
      const data = snap.data()
      const s = data.moduleState || {}

      if (Array.isArray(s.vmMaze)) setMaze(s.vmMaze)
      if (typeof s.vmGridSize === 'number') setGridSize(s.vmGridSize)
      if (typeof s.vmDifficulty === 'string') setDifficulty(s.vmDifficulty as Difficulty)
      if (typeof s.vmTheme === 'string') setThemeName(s.vmTheme as ThemeName)
      if (typeof s.vmTimerMode === 'boolean') setTimerMode(s.vmTimerMode)
      if (typeof s.vmTimeLimit === 'number') setTimeLimit(s.vmTimeLimit)
      if (typeof s.vmTimeRemaining === 'number') setTimeRemaining(s.vmTimeRemaining)
      if (typeof s.vmWrongMoves === 'number') setWrongMoves(s.vmWrongMoves)
      if (typeof s.vmCompleted === 'boolean') setCompleted(s.vmCompleted)
      if (typeof s.vmCompletionTime === 'number') setCompletionTime(s.vmCompletionTime)
      if (typeof s.vmTimeUp === 'boolean') setTimeUp(s.vmTimeUp)
      if (Array.isArray(s.vmVisited)) setVisited(s.vmVisited)
      if (typeof s.vmStartPos?.row === 'number') {
        // startPos doesn't change after generation, only set initially
      }
      if (typeof s.vmGoalPos?.row === 'number') {
        setGoalPos(s.vmGoalPos as Pos)
      }
      if (typeof s.vmPlayerPos?.row === 'number') {
        setPlayerPos(s.vmPlayerPos as Pos)
      }
      if (s.vmMaze && s.vmMaze.length > 0) setMazeReady(true)
    })
    return () => unsub()
  }, [sessionId])

  const handleGenerateMaze = useCallback((diff?: Difficulty, newTheme?: ThemeName) => {
    const d = diff || difficulty
    const t = newTheme || themeName
    const size = DIFFICULTY_MAP[d]
    const { maze: newMaze, startPos, goalPos: gp } = generateMaze(size)

    const data: Record<string, unknown> = {
      'moduleState.vmMaze': newMaze,
      'moduleState.vmGridSize': size,
      'moduleState.vmDifficulty': d,
      'moduleState.vmTheme': t,
      'moduleState.vmStartPos': startPos,
      'moduleState.vmGoalPos': gp,
      'moduleState.vmPlayerPos': startPos,
      'moduleState.vmVisited': [],
      'moduleState.vmWrongMoves': 0,
      'moduleState.vmCompleted': false,
      'moduleState.vmCompletionTime': 0,
      'moduleState.vmTimeUp': false,
      'moduleState.vmTimeRemaining': timerMode ? timeLimit : 0,
    }

    writeToFirestore(data)
    setMaze(newMaze)
    setGridSize(size)
    setPlayerPos(startPos)
    setGoalPos(gp)
    setVisited([])
    setWrongMoves(0)
    setCompleted(false)
    setCompletionTime(0)
    setTimeUp(false)
    setStartTime(null)
    setElapsed(0)
    setBumpCell('')
    if (timerMode) setTimeRemaining(timeLimit)
  }, [difficulty, themeName, timerMode, timeLimit, writeToFirestore])

  const handleDifficultyChange = (d: Difficulty) => {
    if (!isTherapist) return
    writeToFirestore({ 'moduleState.vmDifficulty': d })
    setDifficulty(d)
    handleGenerateMaze(d)
  }

  const handleThemeChange = (t: ThemeName) => {
    if (!isTherapist) return
    writeToFirestore({ 'moduleState.vmTheme': t })
    setThemeName(t)
  }

  const handleNewMaze = () => handleGenerateMaze()

  const handleHarder = () => {
    const order: Difficulty[] = ['easy', 'medium', 'hard']
    const idx = order.indexOf(difficulty)
    if (idx < order.length - 1) {
      handleGenerateMaze(order[idx + 1])
    }
  }

  const movePlayer = useCallback((dir: Direction) => {
    if (!canInteract || completed || !mazeReady || timeUp) return

    const delta: Record<Direction, Pos> = {
      up: { row: -1, col: 0 },
      down: { row: 1, col: 0 },
      left: { row: 0, col: -1 },
      right: { row: 0, col: 1 },
    }

    const d = delta[dir]
    const target: Pos = { row: playerPos.row + d.row, col: playerPos.col + d.col }

    if (target.row < 0 || target.row >= gridSize || target.col < 0 || target.col >= gridSize) return

    const targetIdx = target.row * gridSize + target.col

    if (maze[targetIdx] === 1) {
      const newWrong = wrongMoves + 1
      setWrongMoves(newWrong)
      setBumpCell(`${playerPos.row}-${playerPos.col}`)
      setTimeout(() => setBumpCell(''), 250)
      writeToFirestore({ 'moduleState.vmWrongMoves': newWrong })
      return
    }

    const posKey = `${playerPos.row}-${playerPos.col}`
    const newVisited = [...visited, posKey].slice(-100)
    const newPos: Pos = { row: target.row, col: target.col }

    if (!startTime) {
      const now = Date.now()
      setStartTime(now)
    }

    setVisited(newVisited)
    setPlayerPos(newPos)

    const isGoal = newPos.row === goalPos.row && newPos.col === goalPos.col

    if (isGoal) {
      const elapsedSeconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0
      setCompleted(true)
      setCompletionTime(elapsedSeconds)
      setBumpCell('')

      staadPraise(voiceLangRef.current, 'Amazing! You found the way out!')

      writeToFirestore({
        'moduleState.vmPlayerPos': newPos,
        'moduleState.vmVisited': newVisited,
        'moduleState.vmCompleted': true,
        'moduleState.vmCompletionTime': elapsedSeconds,
        'moduleState.vmWrongMoves': wrongMoves,
        'moduleState.vmTimeUp': false,
      })
      logModuleEvent(sessionId, {
        module: 'maze',
        type: 'maze_solved',
        detail: `Solved the maze in ${elapsedSeconds}s with ${wrongMoves} wrong move${wrongMoves === 1 ? '' : 's'}`,
      })
    } else {
      writeToFirestore({
        'moduleState.vmPlayerPos': newPos,
        'moduleState.vmVisited': newVisited,
      })
    }
  }, [canInteract, completed, mazeReady, timeUp, playerPos, gridSize, maze, wrongMoves, visited, goalPos, startTime, writeToFirestore, sessionId])

  const movePlayerRef = useRef(movePlayer)
  movePlayerRef.current = movePlayer

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const dirMap: Record<string, Direction> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      }
      const dir = dirMap[e.key]
      if (dir) {
        e.preventDefault()
        movePlayerRef.current(dir)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStartRef.current
    if (!start) return
    swipeStartRef.current = null

    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    const minSwipe = 30

    if (Math.abs(dx) < minSwipe && Math.abs(dy) < minSwipe) return

    if (Math.abs(dx) > Math.abs(dy)) {
      movePlayerRef.current(dx > 0 ? 'right' : 'left')
    } else {
      movePlayerRef.current(dy > 0 ? 'down' : 'up')
    }
  }

  // Therapist timer countdown
  useEffect(() => {
    if (!isTherapist || !timerMode || !mazeReady || completed || timeUp) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
      }
      return
    }

    timerRef.current = setInterval(() => {
      const next = timeRemainingRef.current - 1
      if (next <= 0) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
        writeToFirestore({
          'moduleState.vmTimeRemaining': 0,
          'moduleState.vmTimeUp': true,
        })
      } else {
        writeToFirestore({ 'moduleState.vmTimeRemaining': next })
      }
    }, 1000)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
      }
    }
  }, [isTherapist, timerMode, mazeReady, completed, timeUp, writeToFirestore])

  // Elapsed time counter for stats bar
  useEffect(() => {
    if (!startTime || completed) {
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current)
        elapsedRef.current = undefined
      }
      return
    }
    elapsedRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current)
    }
  }, [startTime, completed])

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (elapsedRef.current) clearInterval(elapsedRef.current)
    }
  }, [])

  /* ===================== Presentation ===================== */

  /** White pill with a 1px hairline border; `accent` drives the selected look. */
  const pill = (active: boolean, accent: string, tint: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '9px 14px',
    borderRadius: 14,
    border: `1.5px solid ${active ? accent : UI.border}`,
    background: active ? tint : UI.card,
    color: active ? accent : UI.ink,
    fontSize: 16.5,
    fontWeight: 600,
    letterSpacing: -0.1,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: UI.shadow,
    transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.12s',
  })

  const microLabel: React.CSSProperties = {
    fontSize: 13.5,
    fontWeight: 700,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: UI.muted,
  }

  /* ---- Settings row: segmented difficulty · theme · timer · new maze ---- */
  const settingsRow = (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 10,
        paddingBottom: 8,
      }}
    >
      {/* Difficulty — one segmented card, name stacked over grid size */}
      <div
        style={{
          display: 'flex',
          background: UI.card,
          border: `1px solid ${UI.border}`,
          borderRadius: 16,
          padding: 3,
          gap: 3,
          boxShadow: UI.shadow,
        }}
      >
        {DIFFICULTY_LABELS.map((d) => {
          const active = difficulty === d.key
          return (
            <button
              key={d.key}
              className="vm-pill"
              onClick={() => handleDifficultyChange(d.key)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                minWidth: 78,
                padding: '7px 14px',
                borderRadius: 13,
                border: `1.5px solid ${active ? UI.coral : 'transparent'}`,
                background: active ? UI.coralSoft : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 16.5, fontWeight: 700, color: active ? UI.coralInk : UI.ink, letterSpacing: -0.2 }}>
                {d.label}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: active ? UI.coral : UI.muted }}>
                {d.size}
              </span>
            </button>
          )
        })}
      </div>

      {/* Theme — selected pill takes a blue outline */}
      <div style={{ display: 'flex', gap: 8 }}>
        {THEME_LIST.map((t) => {
          const active = themeName === t.key
          const { Icon } = t
          return (
            <button
              key={t.key}
              className="vm-pill"
              onClick={() => handleThemeChange(t.key)}
              style={pill(active, UI.blue, UI.blueSoft)}
            >
              <Icon size={15} strokeWidth={2.2} color={active ? UI.blue : t.tint} />
              <span style={{ color: active ? UI.blue : UI.ink }}>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Timer toggle (+ limit chips once enabled) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="vm-pill"
          onClick={() => {
            const next = !timerMode
            setTimerMode(next)
            writeToFirestore({ 'moduleState.vmTimerMode': next })
          }}
          style={pill(timerMode, UI.blue, UI.blueSoft)}
        >
          <Timer size={15} strokeWidth={2.2} color={timerMode ? UI.blue : UI.inkSoft} />
          Timer {timerMode ? 'On' : 'Off'}
        </button>
        {timerMode && TIME_LIMITS.map((t) => (
          <button
            key={t}
            className="vm-pill"
            onClick={() => {
              setTimeLimit(t)
              writeToFirestore({ 'moduleState.vmTimeLimit': t })
              setTimeRemaining(t)
            }}
            style={{ ...pill(timeLimit === t, UI.blue, UI.blueSoft), padding: '9px 12px' }}
          >
            {t}s
          </button>
        ))}
      </div>

      {/* New maze */}
      <button className="vm-pill" onClick={handleNewMaze} style={pill(false, UI.blue, UI.blueSoft)}>
        <Box size={15} strokeWidth={2.2} color={UI.inkSoft} />
        New Maze
      </button>
    </div>
  )

  /* ---- Compact stats line ---- */
  const statItem = (icon: React.ReactNode, text: string, tone: string = UI.inkSoft) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: tone, fontSize: 16, fontWeight: 600 }}>
      {icon}
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{text}</span>
    </span>
  )

  const divider = <span style={{ width: 1, height: 12, background: UI.border, display: 'inline-block' }} />

  const statsRow = (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: '2px 0 10px',
      }}
    >
      {statItem(<Timer size={14} strokeWidth={2.2} color={UI.muted} />, formatTime(elapsed))}
      {divider}
      {statItem(<Ban size={14} strokeWidth={2.2} color={UI.muted} />, `${wrongMoves} wrong`)}
      {divider}
      {statItem(<Footprints size={14} strokeWidth={2.2} color={UI.muted} />, `${visited.length} cells`)}
      {timerMode && !completed && !timeUp && (
        <>
          {divider}
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 11px',
              borderRadius: 999,
              border: `1px solid ${timeRemaining <= 10 ? UI.coral : UI.border}`,
              background: timeRemaining <= 10 ? UI.coralSoft : UI.card,
              color: timeRemaining <= 10 ? UI.coralInk : UI.ink,
              fontSize: 16,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              animation: timeRemaining <= 10 ? 'vmTimerPulse 1s ease infinite' : 'none',
            }}
          >
            <Timer size={13} strokeWidth={2.4} color={timeRemaining <= 10 ? UI.coralInk : UI.inkSoft} />
            {formatTime(timeRemaining)}
          </span>
        </>
      )}
    </div>
  )

  /* ---- The board, drawn as one SVG so it always scales to fit its box ----
     viewBox is gridSize×gridSize user units (1 unit = 1 cell) and
     preserveAspectRatio="xMidYMid meet" guarantees it letterboxes rather than
     overflowing, whatever shape the remaining canvas ends up. */
  const trailPoints = [...visited, `${playerPos.row}-${playerPos.col}`].map((k) => {
    const [r, c] = k.split('-').map(Number)
    return { r, c }
  }).filter((p) => Number.isFinite(p.r) && Number.isFinite(p.c))

  const trailPath = trailPoints.length > 1
    ? trailPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.c + 0.5} ${p.r + 0.5}`).join(' ')
    : ''

  const isBumping = bumpCell === `${playerPos.row}-${playerPos.col}`
  const playerOnGoal = playerPos.row === goalPos.row && playerPos.col === goalPos.col

  const board = (
    <svg
      viewBox={`0 0 ${gridSize} ${gridSize}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
    >
      <defs>
        <radialGradient id="vmGoalGlow">
          <stop offset="0%" stopColor={UI.green} stopOpacity="0.45" />
          <stop offset="55%" stopColor={UI.green} stopOpacity="0.16" />
          <stop offset="100%" stopColor={UI.green} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="vmStartGlow">
          <stop offset="0%" stopColor={UI.coral} stopOpacity="0.40" />
          <stop offset="55%" stopColor={UI.coral} stopOpacity="0.14" />
          <stop offset="100%" stopColor={UI.coral} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Corridor surface */}
      <rect x={0} y={0} width={gridSize} height={gridSize} rx={0.34} fill={theme.corridor} />

      {/* Walls — each cell its own rounded navy block, leaving hairline seams */}
      {maze.map((cell, idx) => {
        if (cell !== 1) return null
        const r = Math.floor(idx / gridSize)
        const c = idx % gridSize
        return (
          <rect
            key={idx}
            x={c + 0.03}
            y={r + 0.03}
            width={0.94}
            height={0.94}
            rx={0.2}
            fill={theme.wall}
            stroke={theme.wallEdge}
            strokeWidth={0.015}
          />
        )
      })}

      {/* Traversed trail — soft continuous underlay + coral dots on top */}
      {trailPath && (
        <>
          <path
            d={trailPath}
            fill="none"
            stroke="rgba(255,90,95,0.20)"
            strokeWidth={0.10}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={trailPath}
            fill="none"
            stroke={UI.coral}
            strokeWidth={0.13}
            strokeLinecap="round"
            strokeDasharray="0.001 0.26"
          />
        </>
      )}

      {/* Start marker */}
      <g transform={`translate(${START.col} ${START.row})`}>
        <circle cx={0.5} cy={0.5} r={0.95} fill="url(#vmStartGlow)" />
        <rect x={0.08} y={0.08} width={0.84} height={0.84} rx={0.25} fill={UI.coral} />
        <rect x={0.35} y={0.35} width={0.3} height={0.3} rx={0.09} fill="#ffffff" />
      </g>

      {/* Goal — glowing green flag cell */}
      <g transform={`translate(${goalPos.col} ${goalPos.row})`}>
        <circle cx={0.5} cy={0.5} r={1} fill="url(#vmGoalGlow)" />
        <rect
          x={0.06}
          y={0.06}
          width={0.88}
          height={0.88}
          rx={0.25}
          fill="rgba(63,174,106,0.22)"
          stroke={UI.green}
          strokeWidth={0.045}
        />
        <path d="M0.36 0.24 L0.36 0.78" stroke={UI.greenInk} strokeWidth={0.075} strokeLinecap="round" />
        <path d="M0.4 0.27 L0.72 0.4 L0.4 0.53 Z" fill={UI.green} />
      </g>

      {/* Player — cheerful sprite; glides between cells, squashes on a wall bump */}
      <g
        style={{
          transform: `translate(${playerPos.col}px, ${playerPos.row}px)`,
          transition: 'transform 0.14s ease',
        }}
      >
        <g className={isBumping ? 'vm-bump' : undefined} style={{ transformOrigin: '0.5px 0.5px' }}>
          <rect
            x={0.14}
            y={0.14}
            width={0.72}
            height={0.72}
            rx={0.22}
            fill={playerOnGoal ? '#2f9457' : UI.green}
            stroke="#ffffff"
            strokeWidth={0.06}
          />
          <circle cx={0.38} cy={0.42} r={0.075} fill="#ffffff" />
          <circle cx={0.62} cy={0.42} r={0.075} fill="#ffffff" />
          <path
            d="M0.37 0.60 Q0.5 0.72 0.63 0.60"
            fill="none"
            stroke="#ffffff"
            strokeWidth={0.055}
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  )

  /* ---- D-pad: large white keys with soft shadows ---- */
  const KEY = 62
  const arrowFor = (d: Direction) => {
    const props = { size: 24, strokeWidth: 2.4, color: UI.ink } as const
    if (d === 'up') return <ArrowUp {...props} />
    if (d === 'down') return <ArrowDown {...props} />
    if (d === 'left') return <ArrowLeft {...props} />
    return <ArrowRight {...props} />
  }

  const dpad = (
    <div style={{ flexShrink: 0, position: 'relative' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(3, ${KEY}px)`,
          gridTemplateRows: `repeat(3, ${KEY}px)`,
          gap: 12,
        }}
      >
        {(['', 'up', '', 'left', '', 'right', '', 'down', ''] as const).map((dir, i) => {
          const d = dir as Direction | ''
          if (!d) return <div key={i} />
          return (
            <button
              key={i}
              className="vm-key"
              aria-label={d}
              disabled={!canInteract}
              onMouseDown={() => movePlayer(d)}
              onTouchStart={(e) => { e.preventDefault(); movePlayer(d) }}
              style={{
                width: KEY,
                height: KEY,
                borderRadius: 18,
                background: UI.card,
                border: `1px solid ${UI.border}`,
                boxShadow: UI.shadowKey,
                cursor: canInteract ? 'pointer' : 'not-allowed',
                opacity: canInteract ? 1 : 0.45,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                outline: 'none',
                transition: 'transform 0.1s ease, box-shadow 0.15s ease',
              }}
            >
              {arrowFor(d)}
            </button>
          )
        })}
      </div>

      {/* Light lock scrim — dark text on a light surface, never the reverse */}
      {!canInteract && mazeReady && !completed && !timeUp && (
        <div
          style={{
            position: 'absolute',
            inset: -6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 5,
            borderRadius: 20,
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 12,
              background: UI.card,
              border: `1px solid ${UI.border}`,
              boxShadow: UI.shadow,
              fontSize: 14,
              fontWeight: 700,
              color: UI.inkSoft,
              textAlign: 'center',
              maxWidth: 150,
              lineHeight: 1.3,
            }}
          >
            <Lock size={13} strokeWidth={2.4} color={UI.muted} />
            Therapist is controlling
          </span>
        </div>
      )}
    </div>
  )

  /* ---- Result overlays: a white card on a light scrim ---- */
  const overlayShell = (children: React.ReactNode) => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        padding: 20,
        borderRadius: 20,
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        style={{
          background: UI.card,
          border: `1px solid ${UI.border}`,
          borderRadius: 20,
          boxShadow: '0 14px 40px rgba(20,30,40,0.12)',
          padding: '22px 30px',
          textAlign: 'center',
          maxWidth: 340,
        }}
      >
        {children}
      </div>
    </div>
  )

  const solidBtn = (bg: string): React.CSSProperties => ({
    padding: '10px 18px',
    borderRadius: 12,
    border: 'none',
    background: bg,
    color: '#ffffff',
    fontSize: 16.5,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: UI.shadowKey,
  })

  const ghostBtn: React.CSSProperties = {
    padding: '10px 18px',
    borderRadius: 12,
    border: `1px solid ${UI.border}`,
    background: UI.card,
    color: UI.ink,
    fontSize: 16.5,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: UI.shadow,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <style>{`
        @keyframes vmBump {
          0%, 100% { transform: scale(1); }
          40% { transform: scale(0.82); }
          70% { transform: scale(1.06); }
        }
        @keyframes vmTimerPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        .vm-bump { animation: vmBump 0.25s ease; }
        .vm-pill:hover { transform: translateY(-1px); }
        .vm-key:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(20,30,40,0.14); }
        .vm-key:active:not(:disabled) { transform: translateY(1px); box-shadow: 0 3px 8px rgba(20,30,40,0.12); }
      `}</style>

      {isTherapist && settingsRow}
      {mazeReady && statsRow}

      {/* No maze yet */}
      {!mazeReady && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              background: UI.card,
              border: `1px solid ${UI.border}`,
              borderRadius: 20,
              boxShadow: UI.shadow,
              padding: '26px 32px',
              textAlign: 'center',
            }}
          >
            <div style={{ ...microLabel, marginBottom: 10 }}>Virtual Maze</div>
            {isTherapist ? (
              <>
                <div style={{ fontSize: 17.5, fontWeight: 700, color: UI.ink, marginBottom: 14 }}>
                  Pick a difficulty, then build the board.
                </div>
                <button onClick={() => handleGenerateMaze()} style={solidBtn(UI.ink)}>
                  Generate Maze
                </button>
              </>
            ) : (
              <div style={{ fontSize: 16.5, fontWeight: 600, color: UI.inkSoft }}>
                Waiting for your therapist to set up the maze…
              </div>
            )}
          </div>
        </div>
      )}

      {/* Play area: board card on the left, D-pad alongside. The canvas is wide
          and short, so keeping the controls beside the board gives the maze the
          full remaining height. */}
      {mazeReady && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 28,
          }}
        >
          <div
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            style={{
              position: 'relative',
              height: '100%',
              aspectRatio: '1',
              maxWidth: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              background: theme.board,
              border: `1px solid ${UI.border}`,
              borderRadius: 20,
              boxShadow: UI.shadow,
              padding: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {board}

            {completed && !timeUp && overlayShell(
              <>
                <div style={{ fontSize: 23.5, fontWeight: 800, color: UI.ink, letterSpacing: -0.4, marginBottom: 4 }}>
                  Maze complete
                </div>
                <div style={{ fontSize: 21, marginBottom: 8 }}>{getRating(wrongMoves).stars}</div>
                <div style={{ fontSize: 16.5, fontWeight: 700, color: UI.greenInk, marginBottom: 12 }}>
                  {getRating(wrongMoves).text}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 18 }}>
                  <div>
                    <div style={microLabel}>Time</div>
                    <div style={{ fontSize: 18.5, fontWeight: 800, color: UI.ink, fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(completionTime)}
                    </div>
                  </div>
                  <div style={{ width: 1, background: UI.border }} />
                  <div>
                    <div style={microLabel}>Wrong moves</div>
                    <div style={{ fontSize: 18.5, fontWeight: 800, color: UI.ink, fontVariantNumeric: 'tabular-nums' }}>
                      {wrongMoves}
                    </div>
                  </div>
                </div>
                {isTherapist && (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button onClick={() => { handleGenerateMaze() }} style={solidBtn(UI.green)}>
                      New Maze
                    </button>
                    {difficulty !== 'hard' && (
                      <button onClick={handleHarder} style={ghostBtn}>
                        Harder
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {timeUp && overlayShell(
              <>
                <div style={{ fontSize: 23.5, fontWeight: 800, color: UI.coralInk, letterSpacing: -0.4, marginBottom: 12 }}>
                  Time&rsquo;s up
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 18 }}>
                  <div>
                    <div style={microLabel}>Wrong moves</div>
                    <div style={{ fontSize: 18.5, fontWeight: 800, color: UI.ink, fontVariantNumeric: 'tabular-nums' }}>
                      {wrongMoves}
                    </div>
                  </div>
                  <div style={{ width: 1, background: UI.border }} />
                  <div>
                    <div style={microLabel}>Cells visited</div>
                    <div style={{ fontSize: 18.5, fontWeight: 800, color: UI.ink, fontVariantNumeric: 'tabular-nums' }}>
                      {visited.length}
                    </div>
                  </div>
                </div>
                {isTherapist && (
                  <button onClick={() => { handleGenerateMaze() }} style={solidBtn(UI.ink)}>
                    Try Again
                  </button>
                )}
              </>
            )}
          </div>

          {dpad}
        </div>
      )}
    </div>
  )
}
