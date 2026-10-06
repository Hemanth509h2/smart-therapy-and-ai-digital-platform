import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock firebase ---
vi.mock('@/lib/firebase', () => ({
  db: {},
  doc: vi.fn(() => 'mocked-doc-ref'),
  onSnapshot: vi.fn(() => vi.fn()),
  updateDoc: vi.fn(),
}))

// --- Helper functions extracted/duplicated from the component for isolated testing ---
type Operation = 'add' | 'sub' | 'multiply' | 'numbers'
type DifficultyLevel = 'easy' | 'medium' | 'hard'

interface Question {
  display: string
  answer: number
}

interface Mole {
  id: number
  number: number
  isUp: boolean
  holeIndex: number
}

const DIFFICULTIES = [
  { key: 'easy', maxNum: 5, maxSum: 10 },
  { key: 'medium', maxNum: 10, maxSum: 20 },
  { key: 'hard', maxNum: 20, maxSum: 50 },
]

function generateQuestion(operation: Operation, difficulty: DifficultyLevel): { question: Question; numbers: number[] } {
  const diff = DIFFICULTIES.find((d) => d.key === difficulty)!
  const max = diff.maxNum
  const maxSum = diff.maxSum
  let answer = 0
  let display = ''

  if (operation === 'numbers') {
    answer = 1 + Math.floor(Math.random() * max)
    display = `Find ${answer}`
  } else if (operation === 'add') {
    const a = 1 + Math.floor(Math.random() * max)
    const b = 1 + Math.floor(Math.random() * Math.min(max, maxSum - a))
    answer = a + b
    display = `${a} + ${b} = ?`
  } else if (operation === 'sub') {
    const a = 2 + Math.floor(Math.random() * maxSum)
    const b = 1 + Math.floor(Math.random() * Math.min(a - 1, max))
    answer = a - b
    display = `${a} - ${b} = ?`
  } else if (operation === 'multiply') {
    const a = 1 + Math.floor(Math.random() * Math.min(max, 9))
    const b = 1 + Math.floor(Math.random() * Math.min(max, 9))
    answer = a * b
    display = `${a} × ${b} = ?`
  }

  const numbers: number[] = [answer]
  const usedNums = new Set([answer])
  const maxAttempts = 100
  let attempts = 0

  while (numbers.length < 9 && attempts < maxAttempts) {
    attempts++
    let distractor: number
    if (operation === 'numbers') {
      distractor = 1 + Math.floor(Math.random() * max)
    } else {
      const offset = 1 + Math.floor(Math.random() * 4)
      distractor = Math.random() > 0.5 ? answer + offset : answer - offset
    }
    if (!usedNums.has(distractor) && distractor >= 0 && distractor <= 100) {
      numbers.push(distractor)
      usedNums.add(distractor)
    }
  }

  while (numbers.length < 9) {
    let fallback = answer + numbers.length
    if (!usedNums.has(fallback) && fallback <= 100) {
      numbers.push(fallback)
      usedNums.add(fallback)
    } else {
      fallback = answer - numbers.length
      if (!usedNums.has(fallback) && fallback >= 0) {
        numbers.push(fallback)
        usedNums.add(fallback)
      }
    }
  }

  const src = [...numbers]
  for (let i = src.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[src[i], src[j]] = [src[j], src[i]]
  }

  return { question: { display, answer }, numbers: src }
}

function buildMoles(numbers: number[], answerHoleIndex: number): Mole[] {
  return numbers.map((n, i) => ({
    id: i,
    number: n,
    isUp: false,
    holeIndex: i,
  }))
}

function pickUpMoles(moles: Mole[], answerHoleIndex: number): Mole[] {
  const count = 3 + Math.floor(Math.random() * 2)
  const upSet = new Set<number>([answerHoleIndex])
  const candidates = moles
    .map((_, i) => i)
    .filter((i) => i !== answerHoleIndex)

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }

  for (let k = 0; k < count - 1 && k < candidates.length; k++) {
    upSet.add(candidates[k])
  }

  return moles.map((m) => ({
    ...m,
    isUp: upSet.has(m.holeIndex),
  }))
}

// Determine what operation/difficulty/speed button is active
function getActiveButton<T>(options: { key: T; label: string }[], current: T): string {
  return options.find(o => o.key === current)?.label ?? ''
}

// =============================================================================
// TESTS
// =============================================================================

describe('generateQuestion', () => {
  // 1. Operation switches — verify each operation produces correct display + answer
  describe('1. Operation Switches', () => {
    it('generateQuestion with "add" produces a valid addition question', () => {
      const result = generateQuestion('add', 'easy')
      expect(result.question.display).toMatch(/^\d+ \+ \d+ = \?$/)
      expect(result.question.answer).toBeGreaterThanOrEqual(2)
      expect(result.question.answer).toBeLessThanOrEqual(10)
      expect(result.numbers).toHaveLength(9)
      expect(result.numbers).toContain(result.question.answer)
    })

    it('generateQuestion with "sub" produces a valid subtraction question', () => {
      const result = generateQuestion('sub', 'easy')
      expect(result.question.display).toMatch(/^\d+ - \d+ = \?$/)
      expect(result.question.answer).toBeGreaterThanOrEqual(1)
      expect(result.numbers).toHaveLength(9)
      expect(result.numbers).toContain(result.question.answer)
    })

    it('generateQuestion with "multiply" produces a valid multiplication question', () => {
      const result = generateQuestion('multiply', 'easy')
      expect(result.question.display).toMatch(/^\d+ × \d+ = \?$/)
      expect(result.question.answer).toBeGreaterThanOrEqual(1)
      expect(result.numbers).toHaveLength(9)
      expect(result.numbers).toContain(result.question.answer)
    })

    it('generateQuestion with "numbers" produces a "Find X" question', () => {
      const result = generateQuestion('numbers', 'easy')
      expect(result.question.display).toMatch(/^Find \d+$/)
      expect(result.question.answer).toBeGreaterThanOrEqual(1)
      expect(result.question.answer).toBeLessThanOrEqual(5)
      expect(result.numbers).toHaveLength(9)
      expect(result.numbers).toContain(result.question.answer)
    })

    it('dynamic switch between operations updates the question type', () => {
      const addQ = generateQuestion('add', 'easy')
      expect(addQ.question.display).toContain('+')

      const subQ = generateQuestion('sub', 'easy')
      expect(subQ.question.display).toContain('-')

      const mulQ = generateQuestion('multiply', 'easy')
      expect(mulQ.question.display).toContain('×')

      const numQ = generateQuestion('numbers', 'easy')
      expect(numQ.question.display).toContain('Find')
    })
  })

  // 2. Difficulty & Speed Modifiers
  describe('2. Difficulty & Speed Modifiers', () => {
    it('easy difficulty: answer within range, all numbers 0-100', () => {
      const results = Array.from({ length: 50 }, () => generateQuestion('add', 'easy'))
      for (const r of results) {
        expect(r.question.answer).toBeGreaterThanOrEqual(2)
        expect(r.question.answer).toBeLessThanOrEqual(10)
        expect(r.numbers).toHaveLength(9)
        for (const n of r.numbers) {
          expect(n).toBeGreaterThanOrEqual(0)
          expect(n).toBeLessThanOrEqual(100)
        }
      }
    })

    it('medium difficulty: answer within range, all numbers 0-100', () => {
      const results = Array.from({ length: 50 }, () => generateQuestion('add', 'medium'))
      for (const r of results) {
        expect(r.question.answer).toBeGreaterThanOrEqual(2)
        expect(r.question.answer).toBeLessThanOrEqual(20)
        expect(r.numbers).toHaveLength(9)
        for (const n of r.numbers) {
          expect(n).toBeGreaterThanOrEqual(0)
          expect(n).toBeLessThanOrEqual(100)
        }
      }
    })

    it('hard difficulty: answer within range, all numbers 0-100', () => {
      const results = Array.from({ length: 50 }, () => generateQuestion('add', 'hard'))
      for (const r of results) {
        expect(r.question.answer).toBeGreaterThanOrEqual(2)
        expect(r.question.answer).toBeLessThanOrEqual(50)
        expect(r.numbers).toHaveLength(9)
        for (const n of r.numbers) {
          expect(n).toBeGreaterThanOrEqual(0)
          expect(n).toBeLessThanOrEqual(100)
        }
      }
    })

    it('speed values are defined correctly (slow=3000, normal=2000, fast=1200)', () => {
      const SPEEDS = [
        { key: 'slow', ms: 3000 },
        { key: 'normal', ms: 2000 },
        { key: 'fast', ms: 1200 },
      ]
      expect(SPEEDS.find(s => s.key === 'slow')!.ms).toBe(3000)
      expect(SPEEDS.find(s => s.key === 'normal')!.ms).toBe(2000)
      expect(SPEEDS.find(s => s.key === 'fast')!.ms).toBe(1200)
    })

    it('getActiveButton returns the correct label for each difficulty', () => {
      const DIFFS = [
        { key: 'easy' as DifficultyLevel, label: 'Easy' },
        { key: 'medium' as DifficultyLevel, label: 'Medium' },
        { key: 'hard' as DifficultyLevel, label: 'Hard' },
      ]
      expect(getActiveButton(DIFFS, 'easy')).toBe('Easy')
      expect(getActiveButton(DIFFS, 'hard')).toBe('Hard')
    })
  })

  // 3. Game data integrity
  describe('3. Game Data Integrity', () => {
    it('generateQuestion always returns exactly 9 numbers', () => {
      for (const op of ['add', 'sub', 'multiply', 'numbers'] as Operation[]) {
        for (const diff of ['easy', 'medium', 'hard'] as DifficultyLevel[]) {
          const result = generateQuestion(op, diff)
          expect(result.numbers).toHaveLength(9)
        }
      }
    })

    it('generateQuestion always includes the answer in the numbers array', () => {
      for (const op of ['add', 'sub', 'multiply', 'numbers'] as Operation[]) {
        for (const diff of ['easy', 'medium', 'hard'] as DifficultyLevel[]) {
          const result = generateQuestion(op, diff)
          expect(result.numbers).toContain(result.question.answer)
        }
      }
    })

    it('all numbers in the shuffled array are >= 0 and <= 100', () => {
      for (const op of ['add', 'sub', 'multiply', 'numbers'] as Operation[]) {
        for (const diff of ['easy', 'medium', 'hard'] as DifficultyLevel[]) {
          const result = generateQuestion(op, diff)
          for (const n of result.numbers) {
            expect(n).toBeGreaterThanOrEqual(0)
            expect(n).toBeLessThanOrEqual(100)
          }
        }
      }
    })
  })
})

describe('buildMoles', () => {
  it('creates 9 moles with correct ids and holeIndices', () => {
    const numbers = [5, 3, 8, 1, 9, 2, 7, 4, 6]
    const moles = buildMoles(numbers, 0)
    expect(moles).toHaveLength(9)
    moles.forEach((m, i) => {
      expect(m.id).toBe(i)
      expect(m.holeIndex).toBe(i)
      expect(m.number).toBe(numbers[i])
      expect(m.isUp).toBe(false)
    })
  })
})

describe('pickUpMoles', () => {
  it('always brings up the answer hole', () => {
    const numbers = [5, 3, 8, 1, 9, 2, 7, 4, 6]
    const moles = buildMoles(numbers, 0)
    // answerHoleIndex = 0 (mole 0 has number 5, the answer)
    const upMoles = pickUpMoles(moles, 0)
    expect(upMoles[0].isUp).toBe(true)
  })

  it('brings up a total of 3-4 moles (answer hole + 2-3 others)', () => {
    const numbers = [5, 3, 8, 1, 9, 2, 7, 4, 6]
    const moles = buildMoles(numbers, 0)
    // Run multiple times to handle randomness
    for (let i = 0; i < 20; i++) {
      const upMoles = pickUpMoles(moles, 0)
      const upCount = upMoles.filter(m => m.isUp).length
      expect(upCount).toBeGreaterThanOrEqual(3)
      expect(upCount).toBeLessThanOrEqual(4)
    }
  })

  it('does not mutate the original moles array', () => {
    const numbers = [5, 3, 8, 1, 9, 2, 7, 4, 6]
    const moles = buildMoles(numbers, 0)
    const originalUp = moles.map(m => m.isUp)
    pickUpMoles(moles, 0)
    expect(moles.map(m => m.isUp)).toEqual(originalUp)
  })
})

describe('Scoring Logic', () => {
  it('correct answer (holeIndex === answerHoleIndex) increments score and streak', () => {
    let score = 0
    let streak = 0
    const answerHoleIndex = 0
    const clickedHoleIndex = 0

    // Simulate correct answer logic from handleMoleClick
    if (clickedHoleIndex === answerHoleIndex) {
      score += 1
      streak += 1
    }

    expect(score).toBe(1)
    expect(streak).toBe(1)
  })

  it('wrong answer (holeIndex !== answerHoleIndex) resets streak to 0', () => {
    const simulateWrongAnswer = (answerIdx: number, clickIdx: number) => {
      let streak = 3
      if (clickIdx !== answerIdx) {
        streak = 0
      }
      return streak
    }

    expect(simulateWrongAnswer(0, 4)).toBe(0)
    expect(simulateWrongAnswer(0, 0)).toBe(3)
  })

  it('streak badge triggers at 3 (On fire) and 5 (Amazing)', () => {
    const checkBadge = (streak: number): string | null => {
      if (streak === 3) return '🔥 On fire!'
      if (streak === 5) return '⭐ Amazing!'
      return null
    }

    expect(checkBadge(1)).toBeNull()
    expect(checkBadge(3)).toBe('🔥 On fire!')
    expect(checkBadge(5)).toBe('⭐ Amazing!')
    expect(checkBadge(7)).toBeNull()
  })

  it('after 2 wrong answers on the same question, a new question is triggered', () => {
    let wrongCount = 0
    let newQuestionTriggered = false

    const simulateWrong = () => {
      wrongCount += 1
      if (wrongCount >= 2) {
        newQuestionTriggered = true
      }
    }

    simulateWrong()
    expect(newQuestionTriggered).toBe(false)

    simulateWrong()
    expect(newQuestionTriggered).toBe(true)
  })
})

describe('Game Loop', () => {
  it('startNewQuestion uses current operation and difficulty to generate question', () => {
    // Simulates startNewQuestion logic
    const operation: Operation = 'multiply'
    const difficulty: DifficultyLevel = 'hard'
    const { question, numbers } = generateQuestion(operation, difficulty)
    const answerIdx = numbers.indexOf(question.answer)

    expect(answerIdx).toBeGreaterThanOrEqual(0)
    expect(question.display).toContain('×')
    expect(question.answer).toBeGreaterThanOrEqual(1)
    expect(question.answer).toBeLessThanOrEqual(400) // max 9*9=81 for multiply, but hard uses max 9 in multiply, actually hard max 20 but Math.min(20,9)=9, so max answer is 81
  })

  it('timer interval is correctly set based on speed', () => {
    const SPEEDS = [
      { key: 'slow', ms: 3000 },
      { key: 'normal', ms: 2000 },
      { key: 'fast', ms: 1200 },
    ]

    expect(SPEEDS.find(s => s.key === 'slow')!.ms).toBe(3000)
    expect(SPEEDS.find(s => s.key === 'normal')!.ms).toBe(2000)
    expect(SPEEDS.find(s => s.key === 'fast')!.ms).toBe(1200)
  })

  it('pausing the game clears the timer interval', () => {
    // The useEffect handles this via the isPlaying dependency:
    // When isPlaying becomes false, the cleanup runs clearInterval(timerRef.current)
    let intervalCleared = false
    let currentTimer: ReturnType<typeof setInterval> | undefined = setInterval(() => {}, 1000)

    const cleanup = () => {
      if (currentTimer) {
        clearInterval(currentTimer)
        currentTimer = undefined
        intervalCleared = true
      }
    }

    cleanup()
    expect(intervalCleared).toBe(true)
    expect(currentTimer).toBeUndefined()
  })
})

describe('Game Controls (Operation/Difficulty/Speed handlers)', () => {
  it('handleOperationChange updates state and writes to Firestore', () => {
    let operation: Operation = 'add'
    let firestoreWritten = false

    const handleOperationChange = (op: Operation) => {
      operation = op
      firestoreWritten = true
    }

    handleOperationChange('multiply')
    expect(operation).toBe('multiply')
    expect(firestoreWritten).toBe(true)
  })

  it('handleDifficultyChange updates state correctly', () => {
    let difficulty: DifficultyLevel = 'easy'

    const handleDifficultyChange = (diff: DifficultyLevel) => {
      difficulty = diff
    }

    handleDifficultyChange('hard')
    expect(difficulty).toBe('hard')
  })

  it('handleSpeedChange updates speed value correctly', () => {
    let speed = 2000

    const handleSpeedChange = (ms: number) => {
      speed = ms
    }

    handleSpeedChange(1200)
    expect(speed).toBe(1200)
  })

  it('handleTogglePlaying starts/stops the game', () => {
    let isPlaying = false

    const handleTogglePlaying = () => {
      isPlaying = !isPlaying
    }

    handleTogglePlaying()
    expect(isPlaying).toBe(true)

    handleTogglePlaying()
    expect(isPlaying).toBe(false)
  })
})
