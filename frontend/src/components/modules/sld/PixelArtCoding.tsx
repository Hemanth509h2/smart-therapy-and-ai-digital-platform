'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { ChevronLeft, ChevronRight, Target, Wand2 } from 'lucide-react'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { staadPraise, staadCancel } from '@/lib/voice/staadVoice'
import { useVoiceLanguage } from '@/lib/voice/useVoiceLanguage'

/* ---------------------------------------------------------------------------
   Art assets. The delivered folder name contains a space, so every path
   segment is encoded individually (encodeURI would leave the raw space in).
   Plain <img>/background-image only — next/image chokes on these paths.
--------------------------------------------------------------------------- */
const A = (f: string) =>
  `/assets/modules/SLD/${encodeURIComponent('Pixel art assets')}/${encodeURIComponent(f)}`

/* Pale-mint games ground with faint line-art motifs (controller, sword,
   castle, trophy, trees) — painted cover so the motifs always reach the
   canvas edges however wide the stage gets. */
const PAC_SCENE = `/assets/modules/Background/${encodeURIComponent('pixel art coding.png')}`

const TOOL_ICON = {
  paint: A('tool-paint.svg'),
  undo: A('tool-undo.svg'),
  clear: A('tool-clear.svg'),
  reset: A('tool-reset.svg'),
}

/* ---------------------------------------------------------------------------
   Palette — dark ink on every pale surface. The stage canvas is WHITE, so
   nothing here is ever light-on-light; white text appears only on the solid
   saturated green / coral fills.
--------------------------------------------------------------------------- */
const INK = '#1f3b2c'
const INK_DEEP = '#16281e'
const MUTED = '#63736b'
const GREEN = '#16A34A'
const GREEN_DEEP = '#15803D'
const MINT = '#F0FDF4'
const MINT_2 = '#DCFCE7'
const BORDER = '#e7eaef'
const CELL_BORDER = '#E6E9EE'
const CORAL = '#EF4444'
const FONT = '"DM Sans", sans-serif'

const CARD: React.CSSProperties = {
  background: '#ffffff',
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  boxShadow: '0 4px 16px rgba(31,59,44,0.07)',
}

interface PixelArtCodingProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type PacMode = 'paint' | 'code'
type GridSize = 6 | 8 | 10

const GRID_SIZES: { key: GridSize; size: string; label: string }[] = [
  { key: 6, size: '6×6', label: 'Easy' },
  { key: 8, size: '8×8', label: 'Normal' },
  { key: 10, size: '10×10', label: 'Hard' },
]

/* The delivered colour_palette_svg swatch set, as paint values.

   Blue and purple used to share one chip: the swatch was drawn as a split
   blue/violet fill but painted only the blue half, so purple was visible in the
   palette yet impossible to use. They are now two separate swatches painting
   two separate values. */
const COLORS = [
  '#E53935', '#F7931E', '#FFC627',
  '#1F9D68', '#2F80ED', '#9B51E0', '#25272B',
]

const COMMANDS = [
  { key: 'up', label: '⬆', name: 'Up' },
  { key: 'down', label: '⬇', name: 'Down' },
  { key: 'left', label: '⬅', name: 'Left' },
  { key: 'right', label: '➡', name: 'Right' },
  { key: 'paint', label: '🎨', name: 'Paint' },
]

/* ---------------------------------------------------------------------------
   Fixed pixel templates - one hand-authored grid per target PER GRID SIZE.

   These used to be authored 8x8 only and resampled to 6 and 10 by nearest
   neighbour. Downsampling 8 -> 6 drops two rows and two columns outright, which
   is what turned the letters into half-formed or merged shapes on the 6x6 board
   (A lost its crossbar, B its waist, C its opening) and left several of the
   pictures as meaningless blocks. Upsampling 8 -> 10 was no better: it doubled
   an arbitrary two rows and columns, skewing every shape.

   Each size is now drawn deliberately, so the child is shown a proper letter or
   picture at every difficulty. '#' is a cell that must be painted, '.' one that
   must be left empty; both halves are graded.
--------------------------------------------------------------------------- */
const P = (rows: string[]): number[][] =>
  rows.map((r) => Array.from(r, (ch) => (ch === '#' ? 1 : 0)))

const TEMPLATES: Record<string, Record<GridSize, number[][]>> = {
  heart: {
    6: P([
      '##..##',
      '######',
      '######',
      '.####.',
      '..##..',
      '......',
    ]),
    8: P([
      '.##..##.',
      '########',
      '########',
      '.######.',
      '..####..',
      '...##...',
      '........',
      '........',
    ]),
    10: P([
      '.##....##.',
      '##########',
      '##########',
      '##########',
      '.########.',
      '.########.',
      '..######..',
      '...####...',
      '....##....',
      '..........',
    ]),
  },
  star: {
    6: P([
      '..##..',
      '..##..',
      '######',
      '.####.',
      '.####.',
      '##..##',
    ]),
    8: P([
      '...##...',
      '...##...',
      '########',
      '.######.',
      '..####..',
      '..####..',
      '.##..##.',
      '........',
    ]),
    10: P([
      '....##....',
      '....##....',
      '...####...',
      '##########',
      '.########.',
      '..######..',
      '..######..',
      '.###..###.',
      '.##....##.',
      '..........',
    ]),
  },
  tree: {
    6: P([
      '..##..',
      '.####.',
      '######',
      '.####.',
      '..##..',
      '..##..',
    ]),
    8: P([
      '...##...',
      '..####..',
      '.######.',
      '########',
      '.######.',
      '...##...',
      '...##...',
      '...##...',
    ]),
    10: P([
      '....##....',
      '...####...',
      '..######..',
      '.########.',
      '##########',
      '..######..',
      '....##....',
      '....##....',
      '....##....',
      '...####...',
    ]),
  },
  fish: {
    6: P([
      '.....#',
      '.###.#',
      '#####.',
      '#####.',
      '.###.#',
      '.....#',
    ]),
    8: P([
      '........',
      '......##',
      '.####.##',
      '########',
      '########',
      '.####.##',
      '......##',
      '........',
    ]),
    10: P([
      '..........',
      '.......###',
      '..####..##',
      '.######.##',
      '##########',
      '##########',
      '.######.##',
      '..####..##',
      '.......###',
      '..........',
    ]),
  },
  smiley: {
    6: P([
      '.####.',
      '#....#',
      '##..##',
      '#....#',
      '#.##.#',
      '.####.',
    ]),
    8: P([
      '..####..',
      '.######.',
      '##.##.##',
      '########',
      '########',
      '.##..##.',
      '..####..',
      '........',
    ]),
    10: P([
      '...####...',
      '.########.',
      '##########',
      '##..##..##',
      '##########',
      '##########',
      '##......##',
      '###....###',
      '.########.',
      '...####...',
    ]),
  },
  arrow: {
    6: P([
      '..##..',
      '.####.',
      '######',
      '..##..',
      '..##..',
      '..##..',
    ]),
    8: P([
      '...##...',
      '..####..',
      '.######.',
      '########',
      '...##...',
      '...##...',
      '...##...',
      '...##...',
    ]),
    10: P([
      '....##....',
      '...####...',
      '..######..',
      '.########.',
      '##########',
      '....##....',
      '....##....',
      '....##....',
      '....##....',
      '....##....',
    ]),
  },
  house: {
    6: P([
      '..##..',
      '.####.',
      '######',
      '######',
      '##..##',
      '##..##',
    ]),
    8: P([
      '...##...',
      '..####..',
      '.######.',
      '########',
      '########',
      '.##..##.',
      '.##..##.',
      '.##..##.',
    ]),
    10: P([
      '....##....',
      '...####...',
      '..######..',
      '.########.',
      '##########',
      '##########',
      '###....###',
      '###....###',
      '###....###',
      '###....###',
    ]),
  },
  'letter-a': {
    6: P([
      '..##..',
      '.#..#.',
      '#....#',
      '######',
      '#....#',
      '#....#',
    ]),
    8: P([
      '..####..',
      '.##..##.',
      '##....##',
      '##....##',
      '########',
      '##....##',
      '##....##',
      '##....##',
    ]),
    10: P([
      '...####...',
      '..##..##..',
      '.##....##.',
      '##......##',
      '##......##',
      '##########',
      '##......##',
      '##......##',
      '##......##',
      '##......##',
    ]),
  },
  'letter-b': {
    6: P([
      '#####.',
      '#....#',
      '#####.',
      '#....#',
      '#....#',
      '#####.',
    ]),
    8: P([
      '######..',
      '##...##.',
      '##...##.',
      '######..',
      '##...##.',
      '##...##.',
      '######..',
      '........',
    ]),
    10: P([
      '########..',
      '##.....##.',
      '##.....##.',
      '##.....##.',
      '########..',
      '##.....##.',
      '##.....##.',
      '##.....##.',
      '########..',
      '..........',
    ]),
  },
  'letter-c': {
    6: P([
      '.####.',
      '#....#',
      '#.....',
      '#.....',
      '#....#',
      '.####.',
    ]),
    8: P([
      '..####..',
      '.##..##.',
      '##....##',
      '##......',
      '##......',
      '##....##',
      '.##..##.',
      '..####..',
    ]),
    10: P([
      '...####...',
      '..##..##..',
      '.##....##.',
      '##........',
      '##........',
      '##........',
      '##........',
      '.##....##.',
      '..##..##..',
      '...####...',
    ]),
  },
}

/** The template for a target at the board's current size. */
function patternFor(key: string, size: number): number[][] | null {
  const t = TEMPLATES[key]
  if (!t) return null
  return t[size as GridSize] ?? t[8]
}

/* Carousel cards. `art` is the delivered pixel-art SVG for the shape and
   `tint` is that artwork's own fill, reused for the Your Target preview so the
   card and the goal read as the same object. The art is decoration only — the
   grid is still graded against PATTERNS above.
   (The mockup also shows Butterfly and Car cards; both ship art but no pattern
   data, and inventing pattern data is out of scope for a visual pass.) */
const SHAPE_CARDS: { key: string; label: string; tint: string }[] = [
  { key: 'heart', label: 'Heart', tint: '#E24C4C' },
  { key: 'star', label: 'Star', tint: '#F2B138' },
  { key: 'tree', label: 'Tree', tint: '#3F9142' },
  { key: 'fish', label: 'Fish', tint: '#4C9DE2' },
  { key: 'smiley', label: 'Smiley', tint: '#F2C338' },
  { key: 'arrow', label: 'Arrow', tint: '#8A6FD1' },
  { key: 'house', label: 'House', tint: '#E28C3F' },
]
const LETTER_CARDS: { key: string; label: string }[] = [
  { key: 'letter-a', label: 'A' },
  { key: 'letter-b', label: 'B' },
  { key: 'letter-c', label: 'C' },
]
const TINT_BY_KEY: Record<string, string> = Object.fromEntries(
  SHAPE_CARDS.map((s) => [s.key, s.tint])
)

/**
 * Cells that already agree with the target — the numerator of the match score,
 * and the "N / M cells completed" readout under the progress bar. Grades the
 * whole visible board: required cells come from the target template, and
 * anything painted outside it still counts against the match.
 */
function countMatchedCells(cells: Record<string, string>, target: number[][], gridSize: number): number {
  let matched = 0
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const key = `${r}-${c}`
      const isFilled = key in cells
      const shouldBeFilled = target[r][c] === 1
      if (isFilled === shouldBeFilled) matched++
    }
  }
  return matched
}

function calcMatchPercent(cells: Record<string, string>, target: number[][], gridSize: number): number {
  return Math.round((countMatchedCells(cells, target, gridSize) / (gridSize * gridSize)) * 100)
}

export default function PixelArtCoding({ sessionId, role, isLocked }: PixelArtCodingProps) {
  const isT = role === 'therapist'
  const isTherapist = isT
  const canInteract = isT || !isLocked

  const voiceLanguage = useVoiceLanguage(sessionId)
  const voiceLangRef = useRef(voiceLanguage)
  voiceLangRef.current = voiceLanguage

  const [mode, setMode] = useState<PacMode>('paint')
  const [gridSize, setGridSize] = useState<GridSize>(8)
  const [targetPattern, setTargetPattern] = useState('heart')
  const [activeColor, setActiveColor] = useState('#E53935')
  const [cells, setCells] = useState<Record<string, string>>({})
  const [cursorPos, setCursorPos] = useState({ row: 0, col: 0 })
  const [program, setProgram] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [programStatus, setProgramStatus] = useState<'idle' | 'running' | 'complete' | 'out-of-bounds'>('idle')
  const [score, setScore] = useState(0)
  const [matched, setMatched] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const [celebEmojis, setCelebEmojis] = useState<{ id: number; x: number; emoji: string }[]>([])
  const [perfectCells, setPerfectCells] = useState<Set<string>>(new Set())
  const [showCodeHelp, setShowCodeHelp] = useState(true)
  /* Local stroke history behind the tool card's Undo entry. Snapshots of the
     same `cells` map, nothing new in Firestore — an undo republishes
     moduleState.pacCells exactly like a stroke does. */
  const [history, setHistory] = useState<Record<string, string>[]>([])

  const isDragging = useRef(false)
  const celebIdRef = useRef(0)
  const executeRef = useRef(false)
  const runTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const cellsRef = useRef(cells)
  cellsRef.current = cells
  const cursorRef = useRef(cursorPos)
  cursorRef.current = cursorPos
  const gridSizeRef = useRef(gridSize)
  gridSizeRef.current = gridSize
  const stripRef = useRef<HTMLDivElement>(null)

  const writeToFirestore = useCallback(async (data: Record<string, unknown>) => {
    try {
      await updateDoc(doc(db, 'liveSessions', sessionId), {
        ...data,
        'timestamps.updatedAt': new Date().toISOString(),
      })
    } catch (err) {
      console.warn('[PixelArtCoding] Firestore write failed', err)
    }
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      const s = data.moduleState || {}
      if (typeof s.pacMode === 'string') setMode(s.pacMode as PacMode)
      if (typeof s.pacGridSize === 'number') setGridSize(s.pacGridSize as GridSize)
      if (typeof s.pacTargetPattern === 'string') setTargetPattern(s.pacTargetPattern)
      if (typeof s.pacActiveColor === 'string') setActiveColor(s.pacActiveColor)
      if (s.pacCells && typeof s.pacCells === 'object') setCells(s.pacCells as Record<string, string>)
      if (Array.isArray(s.pacProgram)) setProgram(s.pacProgram as string[])
      if (s.pacCursorPos && typeof s.pacCursorPos.row === 'number') setCursorPos(s.pacCursorPos)
      if (typeof s.pacIsRunning === 'boolean') setIsRunning(s.pacIsRunning)
      if (typeof s.pacScore === 'number') setScore(s.pacScore)
    })
    return () => unsub()
  }, [sessionId])

  useEffect(() => {
    return () => {
      executeRef.current = false
      if (runTimeoutRef.current) clearTimeout(runTimeoutRef.current)
      staadCancel()
    }
  }, [])

  const triggerCelebration = useCallback(() => {
    setCelebrating(true)
    setMatched(true)
    setScore((s) => {
      const next = s + 1
      writeToFirestore({ 'moduleState.pacScore': next })
      return next
    })

    const target = patternFor(targetPattern, gridSizeRef.current)
    if (target) {
      const pCells = new Set<string>()
      for (let r = 0; r < target.length; r++) {
        for (let c = 0; c < target[r].length; c++) {
          if (target[r][c] === 1) pCells.add(`${r}-${c}`)
        }
      }
      setPerfectCells(pCells)
    }

    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        const id = celebIdRef.current++
        const x = 10 + Math.random() * 80
        const emojis = ['🎉', '⭐', '✨', '🌟', '🎊', '💫']
        setCelebEmojis((prev) => [...prev, { id, x, emoji: emojis[i % emojis.length] }])
        setTimeout(() => setCelebEmojis((prev) => prev.filter((e) => e.id !== id)), 1800)
      }, i * 150)
    }

    staadCancel()
    staadPraise(voiceLangRef.current, 'Amazing! You matched the pattern!')

    setTimeout(() => {
      setCelebrating(false)
      setMatched(false)
      setPerfectCells(new Set())
      setCells({})
      setHistory([])
      writeToFirestore({ 'moduleState.pacCells': {} })
    }, 2000)
  }, [targetPattern, writeToFirestore])

  useEffect(() => {
    if (mode !== 'paint' || celebrating) return
    const target = patternFor(targetPattern, gridSizeRef.current)
    if (!target) return
    const pct = calcMatchPercent(cells, target, gridSizeRef.current)
    if (pct === 100 && !matched) {
      triggerCelebration()
    }
  }, [cells, targetPattern, mode, celebrating, matched, triggerCelebration])

  const paintCell = (row: number, col: number) => {
    const key = `${row}-${col}`
    setCells((prev) => {
      const next = { ...prev }
      if (key in next) {
        delete next[key]
      } else {
        next[key] = activeColor
      }
      return next
    })
  }

  /** Snapshot taken at stroke start, so one Undo reverts one whole drag. */
  const pushHistory = () => {
    const snapshot = cellsRef.current
    setHistory((h) => [...h.slice(-19), snapshot])
  }

  const handleCellMouseDown = (row: number, col: number) => {
    if (!canInteract || mode !== 'paint' || isRunning) return
    pushHistory()
    isDragging.current = true
    paintCell(row, col)
  }

  const handleCellMouseEnter = (row: number, col: number) => {
    if (!isDragging.current || !canInteract || mode !== 'paint' || isRunning) return
    paintCell(row, col)
  }

  const handleMouseUp = useCallback(() => {
    if (isDragging.current) {
      isDragging.current = false
      writeToFirestore({ 'moduleState.pacCells': cellsRef.current })
    }
  }, [writeToFirestore])

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseUp])

  const handleCellTouchStart = (e: React.TouchEvent, row: number, col: number) => {
    if (!canInteract || mode !== 'paint' || isRunning) return
    e.preventDefault()
    pushHistory()
    isDragging.current = true
    paintCell(row, col)
  }

  const handleGridTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current || !canInteract || mode !== 'paint' || isRunning) return
    const touch = e.touches[0]
    const el = document.elementFromPoint(touch.clientX, touch.clientY)
    if (el && el.getAttribute('data-cell')) {
      const [r, c] = el.getAttribute('data-cell')!.split(',').map(Number)
      paintCell(r, c)
    }
  }

  const handleGridTouchEnd = useCallback(() => {
    if (isDragging.current) {
      isDragging.current = false
      writeToFirestore({ 'moduleState.pacCells': cellsRef.current })
    }
  }, [writeToFirestore])

  const handleUndo = () => {
    if (!canInteract || isRunning || history.length === 0) return
    const prev = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    setCells(prev)
    writeToFirestore({ 'moduleState.pacCells': prev })
  }

  const handleColorChange = (color: string) => {
    setActiveColor(color)
    writeToFirestore({ 'moduleState.pacActiveColor': color })
  }

  const handleModeChange = (newMode: PacMode) => {
    setMode(newMode)
    setProgramStatus('idle')
    writeToFirestore({ 'moduleState.pacMode': newMode })
  }

  const handleGridSizeChange = (size: GridSize) => {
    setGridSize(size)
    setCells({})
    setHistory([])
    setCursorPos({ row: 0, col: 0 })
    setProgram([])
    setProgramStatus('idle')
    setMatched(false)
    writeToFirestore({
      'moduleState.pacGridSize': size,
      'moduleState.pacCells': {},
      'moduleState.pacProgram': [],
      'moduleState.pacCursorPos': { row: 0, col: 0 },
    })
  }

  const handlePatternChange = (name: string) => {
    setTargetPattern(name)
    setCells({})
    setHistory([])
    setMatched(false)
    writeToFirestore({
      'moduleState.pacTargetPattern': name,
      'moduleState.pacCells': {},
    })
  }

  const handleReset = () => {
    setCells({})
    setHistory([])
    setMatched(false)
    setCursorPos({ row: 0, col: 0 })
    setProgram([])
    setProgramStatus('idle')
    writeToFirestore({
      'moduleState.pacCells': {},
      'moduleState.pacProgram': [],
      'moduleState.pacCursorPos': { row: 0, col: 0 },
    })
  }

  const handleAddCommand = (cmd: string) => {
    if (!canInteract || isRunning || program.length >= 20) return
    setProgram((prev) => {
      const next = [...prev, cmd]
      writeToFirestore({ 'moduleState.pacProgram': next })
      return next
    })
  }

  const handleRemoveCommand = (idx: number) => {
    if (!canInteract || isRunning) return
    setProgram((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      writeToFirestore({ 'moduleState.pacProgram': next })
      return next
    })
  }

  const delay = (ms: number) => new Promise<void>((resolve) => {
    runTimeoutRef.current = setTimeout(resolve, ms)
  })

  const handleRun = async () => {
    if (isRunning || program.length === 0) return
    executeRef.current = true
    setIsRunning(true)
    setProgramStatus('running')
    writeToFirestore({ 'moduleState.pacIsRunning': true })

    let localRow = cursorRef.current.row
    let localCol = cursorRef.current.col

    for (let i = 0; i < program.length && executeRef.current; i++) {
      const cmd = program[i]
      let nextRow = localRow
      let nextCol = localCol

      switch (cmd) {
        case 'up': nextRow--; break
        case 'down': nextRow++; break
        case 'left': nextCol--; break
        case 'right': nextCol++; break
      }

      if (cmd !== 'paint') {
        if (nextRow < 0 || nextRow >= gridSize || nextCol < 0 || nextCol >= gridSize) {
          setProgramStatus('out-of-bounds')
          break
        }
        localRow = nextRow
        localCol = nextCol
      }

      setCursorPos({ row: localRow, col: localCol })

      if (cmd === 'paint') {
        const key = `${localRow}-${localCol}`
        setCells((prev) => {
          if (key in prev) return prev
          const next = { ...prev, [key]: activeColor }
          writeToFirestore({
            'moduleState.pacCells': next,
            'moduleState.pacCursorPos': { row: localRow, col: localCol },
          })
          return next
        })
      } else {
        writeToFirestore({ 'moduleState.pacCursorPos': { row: localRow, col: localCol } })
      }

      await delay(300)
      if (!executeRef.current) break
    }

    executeRef.current = false
    setIsRunning(false)
    writeToFirestore({ 'moduleState.pacIsRunning': false })
    if (programStatus !== 'out-of-bounds') {
      setProgramStatus('complete')
      setTimeout(() => setProgramStatus('idle'), 2000)
      if (isTherapist) {
        logModuleEvent(sessionId, {
          module: 'pixel-art-coding',
          type: 'program_completed',
          detail: 'Completed a coding sequence in Pixel Art Coding (pattern recognition / sequencing)',
        })
      }
    }
  }

  const handleStop = () => {
    executeRef.current = false
    if (runTimeoutRef.current) clearTimeout(runTimeoutRef.current)
    setIsRunning(false)
    setProgramStatus('idle')
    writeToFirestore({ 'moduleState.pacIsRunning': false })
  }

  const handleResetProgram = () => {
    handleStop()
    setCells({})
    setHistory([])
    setCursorPos({ row: 0, col: 0 })
    setProgram([])
    setProgramStatus('idle')
    writeToFirestore({
      'moduleState.pacCells': {},
      'moduleState.pacProgram': [],
      'moduleState.pacCursorPos': { row: 0, col: 0 },
    })
  }

  // Single target grid shared by the preview and the score, so what the child is
  // shown is exactly what is graded.
  const scaledTarget = patternFor(targetPattern, gridSize)

  // Dry-run the program the child has built so far and report where the robot
  // would travel and which cells it would paint. Rendered as ghost markers on the
  // grid, this turns an abstract block list into visible cause-and-effect BEFORE
  // pressing Run. Mirrors handleRun's stepping rules exactly (including the
  // out-of-bounds stop) but touches no state.
  const projection = useMemo(() => {
    if (mode !== 'code' || isRunning || program.length === 0) {
      return { path: new Set<string>(), paint: new Set<string>(), end: null as null | { row: number; col: number }, blocked: false }
    }
    let row = cursorPos.row
    let col = cursorPos.col
    const path = new Set<string>()
    const paint = new Set<string>()
    let blocked = false
    for (const cmd of program) {
      if (cmd === 'paint') {
        paint.add(`${row}-${col}`)
        continue
      }
      let nr = row
      let nc = col
      if (cmd === 'up') nr--
      else if (cmd === 'down') nr++
      else if (cmd === 'left') nc--
      else if (cmd === 'right') nc++
      if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) {
        blocked = true
        break
      }
      row = nr
      col = nc
      path.add(`${row}-${col}`)
    }
    return { path, paint, end: { row, col }, blocked }
  }, [mode, isRunning, program, cursorPos.row, cursorPos.col, gridSize])

  const matchPct = scaledTarget && mode === 'paint' && !celebrating
    ? calcMatchPercent(cells, scaledTarget, gridSize)
    : null
  const matchedCells = scaledTarget && mode === 'paint' && !celebrating
    ? countMatchedCells(cells, scaledTarget, gridSize)
    : null
  const totalCells = gridSize * gridSize

  const gridGap = gridSize >= 10 ? 3 : 4
  const targetTint = TINT_BY_KEY[targetPattern] ?? GREEN
  const shapeLabel =
    SHAPE_CARDS.find((s) => s.key === targetPattern)?.label ??
    LETTER_CARDS.find((l) => l.key === targetPattern)?.label ??
    'Shape'

  const scrollStrip = (dir: number) => stripRef.current?.scrollBy({ left: dir * 240, behavior: 'smooth' })

  /* Tool card rows. `Paint` and `Reset Grid` are therapist settings (mode +
     board reset); `Undo` and `Clear` are painting actions, so they follow
     canInteract like the grid itself does. */
  const tools: { key: string; label: string; icon: string; active: boolean; enabled: boolean; onClick: () => void }[] = [
    { key: 'paint', label: 'Paint', icon: TOOL_ICON.paint, active: mode === 'paint', enabled: isT, onClick: () => handleModeChange('paint') },
    { key: 'undo', label: 'Undo', icon: TOOL_ICON.undo, active: false, enabled: canInteract && !isRunning && history.length > 0, onClick: handleUndo },
    { key: 'clear', label: 'Clear', icon: TOOL_ICON.clear, active: false, enabled: canInteract && !isRunning, onClick: handleReset },
    { key: 'reset', label: 'Reset Grid', icon: TOOL_ICON.reset, active: false, enabled: isT && !isRunning, onClick: handleReset },
  ]

  return (
    <>
      <style>{`
        @keyframes pacFloatUp {
          0% { opacity: 1; transform: translateY(0) scale(1) }
          100% { opacity: 0; transform: translateY(-90px) scale(1.5) }
        }
        @keyframes pacPulseGreen {
          0%, 100% { box-shadow: inset 0 0 0 0 rgba(22,163,74,0) }
          50% { box-shadow: inset 0 0 12px 3px rgba(22,163,74,0.55) }
        }
        @keyframes pacFadeInOut {
          0% { opacity: 0; transform: translateY(6px) }
          15% { opacity: 1; transform: translateY(0) }
          75% { opacity: 1; transform: translateY(0) }
          100% { opacity: 0; transform: translateY(-4px) }
        }
        @keyframes pacPoint {
          0%, 100% { transform: translate(0, 0) }
          50% { transform: translate(3px, -3px) }
        }
        .pac-scroll { scrollbar-width: thin; scrollbar-color: rgba(22,163,74,0.28) transparent; }
        .pac-scroll::-webkit-scrollbar { width: 8px; }
        .pac-scroll::-webkit-scrollbar-thumb { background: rgba(22,163,74,0.28); border-radius: 8px; }
        .pac-strip { scrollbar-width: none; }
        .pac-strip::-webkit-scrollbar { height: 0; display: none; }
        .pac-chip:not(:disabled):hover { border-color: ${GREEN}; }
        .pac-shape:not(:disabled):hover { transform: translateY(-2px); }
      `}</style>

      {/*
        Root fills the stage and never scrolls itself — ModuleStage's body sets
        the 560px floor and expects height:100% with one internal flex:1 region.
        The games ground is full-bleed; every control sits on a white card over
        it, so no copy is ever light-on-light.
      */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          maxWidth: '100%',
          userSelect: 'none',
          fontFamily: FONT,
          borderRadius: 18,
          overflow: 'hidden',
          overflowX: 'clip',
          backgroundColor: MINT,
          backgroundImage: `url("${PAC_SCENE}"), linear-gradient(170deg, #F5FCF6 0%, ${MINT} 60%, #E9F7EC 100%)`,
          backgroundSize: 'cover, cover',
          backgroundPosition: 'center center, center center',
          backgroundRepeat: 'no-repeat, no-repeat',
        }}
      >
        {/* The only scrolling region: overflow stays inside the module. */}
        <div
          className="pac-scroll"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '20px 20px 24px' }}
        >
          <div style={{ width: '100%', maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* ================= Shape carousel (therapist setting) ================= */}
            {isT && mode === 'paint' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  fontSize: 17.5, fontWeight: 700, color: GREEN_DEEP, letterSpacing: 0.2,
                }}>
                  <span aria-hidden>🌱</span> Choose a Shape
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <ChevronButton dir="left" onClick={() => scrollStrip(-1)} />
                  <div
                    ref={stripRef}
                    className="pac-strip"
                    style={{
                      flex: 1, minWidth: 0, display: 'flex', gap: 12,
                      overflowX: 'auto', padding: '6px 2px', scrollBehavior: 'smooth',
                    }}
                  >
                    {SHAPE_CARDS.map((s) => {
                      const on = targetPattern === s.key
                      return (
                        <button
                          key={s.key}
                          className="pac-shape"
                          onClick={() => handlePatternChange(s.key)}
                          style={{
                            ...CARD,
                            flex: '0 0 auto', width: 96,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                            padding: '14px 10px 12px',
                            border: on ? `2px solid ${GREEN}` : `1px solid ${BORDER}`,
                            background: on ? MINT : '#ffffff',
                            cursor: 'pointer',
                            transition: 'transform .15s, border-color .15s, background .15s',
                            boxShadow: on ? '0 6px 18px rgba(22,163,74,0.18)' : CARD.boxShadow,
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={A(`shape-${s.key}.svg`)}
                            alt="" aria-hidden
                            style={{ width: 46, height: 46, objectFit: 'contain', display: 'block' }}
                          />
                          <span style={{ fontSize: 16.5, fontWeight: on ? 700 : 600, color: on ? GREEN_DEEP : INK }}>
                            {s.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <ChevronButton dir="right" onClick={() => scrollStrip(1)} />
                </div>
              </div>
            )}

            {/* ================= Toolbar row (therapist settings) ================= */}
            {isT && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexWrap: 'wrap', gap: 16, rowGap: 14,
              }}>
                {/* Mode toggle — Block Code is the module's second activity. */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {[{ key: 'paint' as PacMode, label: '🖌️ Paint' }, { key: 'code' as PacMode, label: '💻 Code' }].map((m) => {
                    const on = mode === m.key
                    return (
                      <button
                        key={m.key}
                        className="pac-chip"
                        onClick={() => handleModeChange(m.key)}
                        style={{
                          ...CARD,
                          padding: '11px 16px', borderRadius: 14, cursor: 'pointer',
                          fontSize: 16.5, fontWeight: 700, fontFamily: FONT,
                          border: on ? `2px solid ${GREEN}` : `1px solid ${BORDER}`,
                          background: on ? MINT_2 : '#ffffff',
                          color: on ? GREEN_DEEP : MUTED,
                          transition: 'all .15s',
                        }}
                      >
                        {m.label}
                      </button>
                    )
                  })}
                </div>

                {mode === 'paint' && (
                  <>
                    <Divider />

                    {/* Colour swatches — the delivered palette, active one ringed. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      {COLORS.map((c) => {
                        const on = activeColor === c
                        return (
                          <button
                            key={c}
                            onClick={() => handleColorChange(c)}
                            aria-label={`Paint colour ${c}`}
                            style={{
                              width: 46, height: 46, borderRadius: 13, padding: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: '#ffffff',
                              border: on ? `3px solid #66C98B` : `1px solid #E4E7EB`,
                              boxShadow: on ? '0 5px 14px rgba(22,163,74,0.20)' : '0 2px 8px rgba(31,59,44,0.07)',
                              cursor: 'pointer', flexShrink: 0, transition: 'all .15s',
                            }}
                          >
                            <span style={{
                              width: 30, height: 30, borderRadius: 8,
                              background: c, display: 'block',
                            }} />
                          </button>
                        )
                      })}
                    </div>

                    <Divider />

                    {/* Letter targets */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {LETTER_CARDS.map((l) => {
                        const on = targetPattern === l.key
                        return (
                          <button
                            key={l.key}
                            className="pac-chip"
                            onClick={() => handlePatternChange(l.key)}
                            style={{
                              ...CARD,
                              width: 46, height: 46, borderRadius: 13, cursor: 'pointer',
                              fontSize: 18.5, fontWeight: 700, fontFamily: FONT,
                              border: on ? `2px solid ${GREEN}` : `1px solid ${BORDER}`,
                              background: on ? MINT_2 : '#ffffff',
                              color: on ? GREEN_DEEP : INK,
                              transition: 'all .15s',
                            }}
                          >
                            {l.label}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}

                <Divider />

                {/* Grid size */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {GRID_SIZES.map((s) => {
                    const on = gridSize === s.key
                    return (
                      <button
                        key={s.key}
                        className="pac-chip"
                        onClick={() => handleGridSizeChange(s.key)}
                        style={{
                          ...CARD,
                          minWidth: 74, padding: '10px 12px', borderRadius: 14, cursor: 'pointer',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                          fontFamily: FONT,
                          border: on ? `2px solid ${GREEN}` : `1px solid ${BORDER}`,
                          background: on ? MINT_2 : '#ffffff',
                          transition: 'all .15s',
                        }}
                      >
                        <span style={{ fontSize: 17.5, fontWeight: 700, color: on ? GREEN_DEEP : INK_DEEP, lineHeight: 1.1 }}>
                          {s.size}
                        </span>
                        <span style={{ fontSize: 16, fontWeight: 600, color: on ? GREEN : MUTED, lineHeight: 1.1 }}>
                          {s.label}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <Divider />

                {/* Reset — the one coral action in the layout */}
                <button
                  onClick={handleReset}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '12px 20px', borderRadius: 999, cursor: 'pointer',
                    background: '#FFF5F4', border: `1px solid rgba(239,68,68,0.32)`,
                    color: '#D93A3A', fontSize: 17, fontWeight: 700, fontFamily: FONT,
                    boxShadow: '0 2px 10px rgba(239,68,68,0.12)',
                  }}
                >
                  <span aria-hidden style={{ fontSize: 18.5 }}>↻</span> Reset Grid
                </button>
              </div>
            )}

            {/* Client notice */}
            {!canInteract && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <span style={{
                  padding: '9px 18px', borderRadius: 999, background: '#ffffff',
                  border: `1px solid ${BORDER}`, fontSize: 16.5, fontWeight: 600, color: MUTED,
                  boxShadow: '0 2px 8px rgba(31,59,44,0.06)',
                }}>
                  Therapist is controlling
                </span>
              </div>
            )}

            {/* ================= Play row: tools | target | grid | hint ================= */}
            <div style={{
              display: 'flex', alignItems: 'stretch', justifyContent: 'center',
              flexWrap: 'wrap', gap: 18,
            }}>
              {/* Left rail — tool card over target card */}
              <div style={{ flex: '0 1 210px', minWidth: 190, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ ...CARD, padding: 14 }}>
                  {tools.map((t, i) => (
                    <button
                      key={t.key}
                      onClick={t.onClick}
                      disabled={!t.enabled}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                        padding: '13px 14px', borderRadius: 12, border: 'none',
                        background: t.active ? MINT_2 : 'transparent',
                        color: t.active ? GREEN_DEEP : INK,
                        fontSize: 18, fontWeight: t.active ? 700 : 600, fontFamily: FONT,
                        textAlign: 'left', cursor: t.enabled ? 'pointer' : 'default',
                        opacity: t.enabled || t.active ? 1 : 0.42,
                        marginTop: i === 0 ? 0 : 4,
                        borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
                        paddingTop: i === 0 ? 13 : 15,
                        transition: 'background .15s',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={t.icon} alt="" aria-hidden width={20} height={20}
                        style={{ display: 'block', flexShrink: 0, filter: t.active ? 'none' : 'grayscale(1)' }}
                      />
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Your Target — the scaled goal, so the preview and the score
                    always describe the same board. */}
                {mode === 'paint' && scaledTarget && (
                  <div style={{ ...CARD, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
                      <Target size={17} color={GREEN} strokeWidth={2.3} />
                      <span style={{ fontSize: 17.5, fontWeight: 700, color: GREEN_DEEP }}>Your Target</span>
                    </div>
                    <div
                      role="img"
                      aria-label={`Target shape: ${shapeLabel}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
                        gap: 2, width: 116, aspectRatio: '1',
                      }}
                    >
                      {Array.from({ length: gridSize }, (_, r) =>
                        Array.from({ length: gridSize }, (_, c) => (
                          <div
                            key={`preview-${r}-${c}`}
                            style={{
                              aspectRatio: '1',
                              background: scaledTarget[r][c] === 1 ? targetTint : '#F2F5F3',
                              borderRadius: 2,
                            }}
                          />
                        ))
                      )}
                    </div>
                    <div style={{ fontSize: 16.5, lineHeight: 1.5, color: MUTED, textAlign: 'center' }}>
                      Recreate the pixel art by filling the grid!
                    </div>
                  </div>
                )}
              </div>

              {/* Centre — the board */}
              <div style={{
                ...CARD, flex: '1 1 380px', minWidth: 300, borderRadius: 20, padding: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div
                  onTouchMove={handleGridTouchMove}
                  onTouchEnd={handleGridTouchEnd}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
                    gap: gridGap,
                    // Sized from the width the card leaves and locked square, so
                    // the board scales into its box and can never overflow it.
                    width: 'min(100%, 460px)',
                    aspectRatio: '1',
                    touchAction: 'none',
                  }}
                >
                  {Array.from({ length: gridSize }, (_, r) =>
                    Array.from({ length: gridSize }, (_, c) => {
                      const key = `${r}-${c}`
                      const filledColor = cells[key]
                      const isCursor = mode === 'code' && cursorPos.row === r && cursorPos.col === c
                      const isPerfectCell = perfectCells.has(key)
                      // Ghost preview of the program the child is building.
                      const willPaint = projection.paint.has(key)
                      const onPath = projection.path.has(key)
                      const isEnd = !!projection.end && projection.end.row === r && projection.end.col === c

                      return (
                        <div
                          key={key}
                          data-cell={`${r},${c}`}
                          onMouseDown={() => handleCellMouseDown(r, c)}
                          onMouseEnter={() => handleCellMouseEnter(r, c)}
                          onTouchStart={(e) => handleCellTouchStart(e, r, c)}
                          style={{
                            aspectRatio: '1',
                            boxSizing: 'border-box',
                            borderRadius: 6,
                            background: isCursor
                              ? 'rgba(22,163,74,0.20)'
                              : filledColor
                                ? filledColor
                                : willPaint
                                  ? 'rgba(255,198,39,0.40)'
                                  : onPath
                                    ? 'rgba(22,163,74,0.12)'
                                    : '#ffffff',
                            border: isCursor
                              ? `2px solid ${GREEN}`
                              : isEnd
                                ? '2px dashed #E0A93B'
                                : willPaint
                                  ? '1px dashed #E0A93B'
                                  : `1px solid ${CELL_BORDER}`,
                            cursor: canInteract && mode === 'paint' && !isRunning ? 'pointer' : 'default',
                            transition: isCursor ? 'all 0.25s ease' : 'background 0.1s',
                            animation: isPerfectCell ? 'pacPulseGreen 0.6s ease infinite' : 'none',
                            position: 'relative',
                          }}
                        />
                      )
                    })
                  )}
                </div>
              </div>

              {/* Right — how-to hint */}
              <div style={{ flex: '0 1 200px', minWidth: 180, display: 'flex', alignItems: 'center' }}>
                <div style={{ ...CARD, width: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                    <span style={{
                      width: 32, height: 32, flexShrink: 0, borderRadius: '50%', background: GREEN,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 3px 8px rgba(22,163,74,0.28)',
                    }}>
                      <Wand2 size={16} color="#ffffff" strokeWidth={2.3} />
                    </span>
                    <span style={{ fontSize: 17, lineHeight: 1.5, fontWeight: 600, color: INK }}>
                      {mode === 'paint'
                        ? 'Select a color and click or drag to fill cells'
                        : 'Stack blocks below, then press Run to watch the robot paint'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    {COLORS.slice(0, 4).map((c) => (
                      <span
                        key={c}
                        style={{
                          width: 26, height: 26, borderRadius: 7,
                          background: c,
                          border: activeColor === c ? `2px solid ${GREEN}` : `1px solid ${BORDER}`,
                          boxSizing: 'border-box',
                        }}
                      />
                    ))}
                    <span aria-hidden style={{ fontSize: 23.5, marginLeft: 2, animation: 'pacPoint 1.6s ease-in-out infinite' }}>
                      👆
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ================= Block coding panel ================= */}
            {mode === 'code' && (
              <div style={{ ...CARD, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* How Mode B works — a worked example, since a bare row of arrows
                    gives no clue what "running a program" does. Dismissible, and
                    it stays hidden once the child has started building. */}
                {showCodeHelp && program.length === 0 && (
                  <div style={{
                    padding: 14, borderRadius: 14,
                    background: MINT, border: `1px solid rgba(22,163,74,0.22)`,
                    display: 'flex', flexDirection: 'column', gap: 9,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontSize: 17.5, fontWeight: 700, color: GREEN_DEEP }}>How it works</span>
                      <button
                        onClick={() => setShowCodeHelp(false)}
                        style={{ background: 'none', border: 'none', color: MUTED, cursor: 'pointer', fontSize: 16.5, fontWeight: 600, padding: 0, fontFamily: FONT }}
                      >
                        Got it ✕
                      </button>
                    </div>
                    <div style={{ fontSize: 17, color: INK, lineHeight: 1.55 }}>
                      The green square is your robot. Tap blocks to tell it where to go, then press Run.
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {['➡', '➡', '🎨'].map((g, i) => (
                        <span key={i} style={{ padding: '5px 11px', borderRadius: 10, background: MINT_2, fontSize: 17.5 }}>
                          {g}
                        </span>
                      ))}
                      <span style={{ fontSize: 16.5, color: MUTED }}>
                        = move right, right, then colour that square
                      </span>
                    </div>
                  </div>
                )}

                {/* Plain-English readout of the program being built, plus what the
                    ghost markers on the grid mean. */}
                {program.length > 0 && !isRunning && (
                  <div style={{ fontSize: 16.5, color: MUTED, lineHeight: 1.5 }}>
                    {projection.blocked ? (
                      <span style={{ color: '#C2410C', fontWeight: 600 }}>
                        ⚠ This program walks off the grid — remove a move block.
                      </span>
                    ) : (
                      <>
                        Robot will make {program.filter((c) => c !== 'paint').length} move
                        {program.filter((c) => c !== 'paint').length === 1 ? '' : 's'} and colour{' '}
                        {projection.paint.size} square{projection.paint.size === 1 ? '' : 's'}
                        {projection.paint.size > 0 ? ' (shown in yellow)' : ''}.
                      </>
                    )}
                  </div>
                )}

                {/* Program sequence */}
                <div style={{
                  display: 'flex', gap: 8, padding: '12px 14px',
                  background: '#F7F9F8', borderRadius: 14, border: `1px solid ${BORDER}`,
                  overflowX: 'auto', minHeight: 52, alignItems: 'center', flexWrap: 'nowrap',
                }}>
                  {program.map((cmd, i) => {
                    const c = COMMANDS.find((x) => x.key === cmd)
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '8px 12px', borderRadius: 999,
                          background: MINT_2, color: GREEN_DEEP,
                          fontSize: 17.5, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                        }}
                      >
                        <span>{c?.label || cmd}</span>
                        <span style={{ fontSize: 16.5, color: GREEN }}>{c?.name}</span>
                        {canInteract && !isRunning && (
                          <button
                            onClick={() => handleRemoveCommand(i)}
                            aria-label={`Remove ${c?.name || cmd}`}
                            style={{ background: 'none', border: 'none', color: MUTED, cursor: 'pointer', padding: 0, fontSize: 16.5, lineHeight: 1, fontFamily: FONT }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {program.length === 0 && programStatus === 'idle' && (
                    <span style={{ fontSize: 16.5, color: MUTED }}>
                      Click blocks below to build your program
                    </span>
                  )}
                </div>

                {/* Command blocks tray */}
                <div style={{ display: 'flex', gap: 10 }}>
                  {COMMANDS.map((cmd) => (
                    <button
                      key={cmd.key}
                      onClick={() => handleAddCommand(cmd.key)}
                      disabled={!canInteract || isRunning}
                      style={{
                        flex: 1, padding: '12px 0', borderRadius: 14,
                        border: `1px solid ${BORDER}`, background: '#ffffff',
                        cursor: canInteract && !isRunning ? 'pointer' : 'default',
                        opacity: canInteract && !isRunning ? 1 : 0.45,
                        color: GREEN_DEEP, fontFamily: FONT,
                        boxShadow: '0 2px 8px rgba(31,59,44,0.06)',
                        transition: 'all .15s',
                      }}
                    >
                      <span style={{ display: 'block', fontSize: 21, lineHeight: 1.2 }}>{cmd.label}</span>
                      <span style={{ display: 'block', fontSize: 16, fontWeight: 600, color: MUTED, lineHeight: 1.4, marginTop: 2 }}>{cmd.name}</span>
                    </button>
                  ))}
                </div>

                {/* Program controls */}
                <div style={{ display: 'flex', gap: 12 }}>
                  {!isRunning ? (
                    <button
                      onClick={handleRun}
                      disabled={program.length === 0}
                      style={{
                        flex: 1, padding: '13px 0', borderRadius: 999, border: 'none',
                        fontSize: 17.5, fontWeight: 700, fontFamily: FONT,
                        cursor: program.length > 0 ? 'pointer' : 'default',
                        opacity: program.length > 0 ? 1 : 0.45,
                        background: GREEN, color: '#ffffff',
                        boxShadow: '0 5px 14px rgba(22,163,74,0.26)',
                      }}
                    >
                      ▶ Run
                    </button>
                  ) : (
                    <button
                      onClick={handleStop}
                      style={{
                        flex: 1, padding: '13px 0', borderRadius: 999, border: 'none',
                        fontSize: 17.5, fontWeight: 700, fontFamily: FONT, cursor: 'pointer',
                        background: CORAL, color: '#ffffff',
                        boxShadow: '0 5px 14px rgba(239,68,68,0.26)',
                      }}
                    >
                      ⏹ Stop
                    </button>
                  )}
                  <button
                    onClick={handleResetProgram}
                    style={{
                      flex: 1, padding: '13px 0', borderRadius: 999,
                      border: `1px solid ${BORDER}`, background: '#ffffff',
                      fontSize: 17.5, fontWeight: 700, fontFamily: FONT, cursor: 'pointer',
                      color: INK,
                    }}
                  >
                    🔄 Reset
                  </button>
                </div>

                {/* Program status */}
                {programStatus === 'out-of-bounds' && (
                  <div style={{ textAlign: 'center', fontSize: 17.5, fontWeight: 700, color: '#D93A3A', animation: 'pacFadeInOut 2s ease forwards' }}>
                    Out of bounds!
                  </div>
                )}
                {programStatus === 'complete' && (
                  <div style={{ textAlign: 'center', fontSize: 17.5, fontWeight: 700, color: GREEN_DEEP, animation: 'pacFadeInOut 2s ease forwards' }}>
                    Program complete!
                  </div>
                )}
              </div>
            )}

            {/* ================= Progress ================= */}
            <div style={{
              ...CARD, position: 'relative', padding: '16px 20px',
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16,
            }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: INK_DEEP, flexShrink: 0 }}>
                Progress
              </span>

              <div style={{
                flex: '1 1 200px', minWidth: 140, height: 14, borderRadius: 999,
                background: '#EEF2F0', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${celebrating ? 100 : matchPct ?? 0}%`, height: '100%', borderRadius: 999,
                  background: `linear-gradient(90deg, ${GREEN} 0%, #22C55E 100%)`,
                  transition: 'width .3s ease',
                }} />
              </div>

              <span style={{
                flexShrink: 0, padding: '7px 14px', borderRadius: 999,
                background: MINT_2, color: GREEN_DEEP, fontSize: 17.5, fontWeight: 700,
              }}>
                {celebrating ? 100 : matchPct ?? 0}%
              </span>

              <span style={{ flexShrink: 0, fontSize: 17.5, fontWeight: 600, color: MUTED }}>
                {celebrating
                  ? 'Perfect match!'
                  : matchedCells !== null
                    ? `${matchedCells} / ${totalCells} cells completed`
                    : `${program.length} block${program.length === 1 ? '' : 's'} in the program`}
              </span>

              <span style={{
                flexShrink: 0, marginLeft: 'auto', padding: '7px 14px', borderRadius: 999,
                background: MINT, border: `1px solid rgba(22,163,74,0.22)`,
                fontSize: 17, fontWeight: 700, color: GREEN_DEEP,
              }}>
                ✓ {score} completed
              </span>

              {/* Celebration emojis */}
              {celebEmojis.map((e) => (
                <div
                  key={e.id}
                  style={{
                    position: 'absolute',
                    left: `${e.x}%`,
                    bottom: 0,
                    fontSize: 28,
                    zIndex: 10,
                    pointerEvents: 'none',
                    animation: 'pacFloatUp 1.6s ease forwards',
                  }}
                >
                  {e.emoji}
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>
    </>
  )
}

/* Round carousel arrows at each end of the shape strip. */
function ChevronButton({ dir, onClick }: { dir: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === 'left' ? 'Previous shapes' : 'More shapes'}
      style={{
        flexShrink: 0, width: 40, height: 40, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#ffffff', border: `1px solid ${BORDER}`, cursor: 'pointer',
        boxShadow: '0 3px 10px rgba(31,59,44,0.10)',
      }}
    >
      {dir === 'left'
        ? <ChevronLeft size={20} color={INK} strokeWidth={2.2} />
        : <ChevronRight size={20} color={INK} strokeWidth={2.2} />}
    </button>
  )
}

/* Hairline between toolbar groups. */
function Divider() {
  return <span aria-hidden style={{ width: 1, height: 30, background: 'rgba(31,59,44,0.12)', flexShrink: 0 }} />
}
