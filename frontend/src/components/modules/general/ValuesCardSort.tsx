'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import {
  Target, BookOpen, Lightbulb, X, Heart, Plus, RotateCcw,
  Trophy, Lock, ArrowRight, Users, Hand,
} from 'lucide-react'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'

interface ValuesCardSortProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type Bucket = 'pool' | 'important' | 'notNow' | 'final'
interface VCard { id: string; text: string; bucket: Bucket }

const DEFAULT_VALUES = [
  'family', 'honesty', 'freedom', 'health', 'success', 'kindness', 'creativity',
  'faith', 'rest', 'courage', 'learning', 'connection', 'fun', 'purpose',
  'integrity', 'adventure', 'stability', 'compassion', 'growth', 'love',
]

/* ---------------------------------------------------------------------------
   Palette. This module renders on ModuleStage's WHITE canvas, so every colour
   below is dark-on-light. White text appears ONLY on the two solid saturated
   action buttons and on the two solid pile badges. The shared `--ink-*` vars
   are authored for the dark sidebar panel and are deliberately NOT used here.
--------------------------------------------------------------------------- */
const INK = '#111C44'          // the value name — near-black navy
const INK_BODY = '#334155'     // card copy / step text
const INK_MUTED = '#475569'    // helper copy (7:1 on white)
const INK_FAINT = '#64748B'    // micro-labels (4.9:1 on white)
const HAIRLINE = '#e7eaef'

const VIOLET = '#4C3FBF'       // prompts, round-2 card
const VIOLET_BRIGHT = '#6D4AE0'
const VIOLET_TINT = '#F3F0FE'
const VIOLET_LINE = '#DED5FB'

const RED = '#DC2626'
const RED_TINT = '#FEF2F2'
const RED_LINE = '#FBBDBD'

const GREEN = '#16A34A'
const GREEN_DEEP = '#15803D'
const GREEN_TINT = '#F0FDF4'
const GREEN_LINE = '#BBF7D0'

/* Static copy for the 20 shipped values — a lookup table, not state. Nothing is
   persisted and no Firestore field is introduced; a custom value simply falls
   back to the generic line. */
const VALUE_DESC: Record<string, string> = {
  family: 'Spending meaningful time with people I love.',
  honesty: 'Saying what is true, even when it is hard.',
  freedom: 'Having room to choose my own path.',
  health: 'Caring for my body and my mind.',
  success: 'Working toward things I am proud of.',
  kindness: 'Treating people gently, including myself.',
  creativity: 'Making things and seeing them differently.',
  faith: 'Trusting in something bigger than me.',
  rest: 'Letting myself slow down and recover.',
  courage: 'Doing what matters even when I am afraid.',
  learning: 'Staying curious and growing what I know.',
  connection: 'Feeling close to the people around me.',
  fun: 'Making space for play and laughter.',
  purpose: 'Doing things that feel meaningful to me.',
  integrity: 'Acting in line with what I believe.',
  adventure: 'Trying new things and exploring.',
  stability: 'Having a life that feels steady and safe.',
  compassion: 'Caring about what others are going through.',
  growth: 'Becoming a little more myself over time.',
  love: 'Giving and receiving care openly.',
}
const describe = (t: string) => VALUE_DESC[t] ?? 'A value named in your own words.'

const STEPS: Record<number, string[]> = {
  1: ['Read the value', 'Think about whether it matters to you', 'Tap a choice or drag the card'],
  2: ['Read both values', 'Decide which one matters more', 'Tap the one you would keep'],
  3: ['Read your core values', 'Notice which feels furthest away', 'Tap it to mark it'],
}

const PROMPT: Record<number, { head: string; sub: string }> = {
  1: { head: 'Which values matter to you?', sub: 'Look at each value and decide whether it feels important to you right now.' },
  2: { head: 'Which one matters more?', sub: 'Two values at a time — keep the one that feels bigger for you today.' },
  3: { head: 'Your core values', sub: 'Which one have you been living least lately? Tap it to mark it.' },
}

/** How far the card must travel before a release counts as a sort. */
const SWIPE = 88

export default function ValuesCardSort({ sessionId, role, isLocked }: ValuesCardSortProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [cards, setCards] = useState<VCard[]>([])
  const [round, setRound] = useState(1)
  const [highlighted, setHighlighted] = useState('')
  const [customValue, setCustomValue] = useState('')

  /* Purely local presentation state. The mockup shows a single "Add Custom
     Value" button, so the therapist's input stays folded until asked for; the
     drag offset drives the card tilt and is never persisted. */
  const [customOpen, setCustomOpen] = useState(false)
  const [dragDX, setDragDX] = useState(0)
  const dragFrom = useRef<number | null>(null)

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (Array.isArray(s.vsCards)) setCards(s.vsCards)
      if (typeof s.vsRound === 'number') setRound(s.vsRound)
      if (typeof s.vsHighlighted === 'string') setHighlighted(s.vsHighlighted)
    })
    return () => unsub()
  }, [sessionId])

  const startRound1 = useCallback(() => {
    if (!isT) return
    const fresh: VCard[] = DEFAULT_VALUES.map((v, i) => ({ id: `vs${i}`, text: v, bucket: 'pool' }))
    write({ 'moduleState.vsCards': fresh, 'moduleState.vsRound': 1, 'moduleState.vsHighlighted': '' })
  }, [isT, write])

  const reset = startRound1

  const advanceRound = useCallback(() => {
    if (!isT) return
    if (round === 1) {
      // keep only important cards for round 2
      write({ 'moduleState.vsRound': 2 })
    } else if (round === 2) {
      // promote remaining important to final
      const updated = cards.map(c => c.bucket === 'important' ? { ...c, bucket: 'final' as Bucket } : c)
      write({ 'moduleState.vsCards': updated, 'moduleState.vsRound': 3 })
      const coreValues = updated.filter(c => c.bucket === 'final').map(c => c.text)
      if (coreValues.length) {
        logModuleEvent(sessionId, {
          module: 'values-card-sort',
          type: 'core_values',
          detail: `Identified core values: ${coreValues.join(', ')}`,
        })
      }
    }
  }, [isT, round, cards, write, sessionId])

  const sortCard = useCallback((id: string, bucket: Bucket) => {
    if (!canInteract) return
    const updated = cards.map(c => c.id === id ? { ...c, bucket } : c)
    write({ 'moduleState.vsCards': updated })
  }, [cards, canInteract, write])

  /* Round 2: keep one of a pair, the other drops to notNow.
   *
   * The kept card is also moved to the BACK of the list. Round 2 always compares
   * the first two "important" cards, so without the rotation the winner stayed at
   * index 0 and was re-shown in every single comparison — one value sat there
   * while every other value filed past it, which is the repetition being
   * reported. Rotating it means the next comparison is two values that have not
   * just been on screen, and every value gets its turn.
   *
   * Applied locally as well as written: `cards` only updates when the Firestore
   * snapshot lands, and until then the pair is derived from stale buckets, so the
   * card you just eliminated stays on screen and the click looks ignored.
   */
  const eliminate = useCallback((keepId: string, dropId: string) => {
    if (!canInteract) return
    const kept = cards.find(c => c.id === keepId)
    const updated = [
      ...cards.filter(c => c.id !== keepId).map(c => (c.id === dropId ? { ...c, bucket: 'notNow' as Bucket } : c)),
      ...(kept ? [kept] : []),
    ]
    setCards(updated)
    write({ 'moduleState.vsCards': updated })
  }, [cards, canInteract, write])

  const addCustom = useCallback(() => {
    if (!isT || !customValue.trim()) return
    const card: VCard = { id: `vs${Date.now()}`, text: customValue.trim().toLowerCase(), bucket: round === 1 ? 'pool' : 'important' }
    write({ 'moduleState.vsCards': [...cards, card] })
    setCustomValue('')
  }, [isT, customValue, cards, round, write])

  const highlight = useCallback((id: string) => {
    if (!canInteract) return
    const turningOn = highlighted !== id
    write({ 'moduleState.vsHighlighted': turningOn ? id : '' })
    if (turningOn) {
      const val = cards.find(c => c.id === id)?.text
      if (val) {
        logModuleEvent(sessionId, {
          module: 'values-card-sort',
          type: 'value_reflection',
          detail: `Reflected that the value "${val}" has been lived least lately`,
        })
      }
    }
  }, [canInteract, highlighted, write, cards, sessionId])

  const pool = cards.filter(c => c.bucket === 'pool')
  const important = cards.filter(c => c.bucket === 'important')
  const notNow = cards.filter(c => c.bucket === 'notNow')
  const final = cards.filter(c => c.bucket === 'final')

  /* The round-2 pair is DERIVED, never stored.
   *
   * It used to live in state and be refilled by an effect guarded on
   * `!comparePair`. Because the write is async, that effect re-ran against the
   * pre-write buckets and re-seeded the very pair that was being resolved; the
   * guard then blocked any correction once the snapshot arrived. CompareStage
   * looks its ids up in `cards` (every bucket, not just `important`), so a card
   * already moved to notNow still rendered — the eliminated value reappeared as
   * an option. Deriving it means the pair can only ever be two cards that are
   * currently important. */
  const comparePair = useMemo<[string, string] | null>(
    () => (round === 2 && important.length > 1 ? [important[0].id, important[1].id] : null),
    [round, important],
  )

  /* ---- Derived view data ---- */
  const topCard = pool[0]
  const sortedCount = cards.length - pool.length
  const started = cards.length > 0
  const allSorted = started && pool.length === 0

  const submitCustom = () => { if (!customValue.trim()) return; addCustom(); setCustomOpen(false) }

  /* ---- Drag: one pointer path covers mouse AND touch. It only ever calls the
          existing `sortCard`, so the sort logic itself is untouched. ---- */
  const endDrag = useCallback((dx: number) => {
    dragFrom.current = null
    setDragDX(0)
    if (!topCard || !canInteract) return
    if (dx <= -SWIPE) sortCard(topCard.id, 'notNow')
    else if (dx >= SWIPE) sortCard(topCard.id, 'important')
  }, [topCard, canInteract, sortCard])

  const swipeSide = dragDX <= -SWIPE ? 'notNow' : dragDX >= SWIPE ? 'important' : null

  return (
    /* Root fills the stage and never scrolls itself — ModuleStage's body is
       overflow:hidden and hands every module a height:100% box. Only the two
       pile lists scroll inside their own dashed areas; the card stack and the
       action bar always stay inside the canvas. */
    <div style={{
      height: '100%', minHeight: 0, maxWidth: '100%',
      display: 'flex', flexDirection: 'column', gap: 10,
      fontFamily: '"DM Sans", sans-serif', color: INK,
    }}>
      <style>{`
        @keyframes vs-glow { 0%,100%{box-shadow:0 0 0 0 rgba(109,74,224,0.35)} 50%{box-shadow:0 0 0 7px rgba(109,74,224,0.10)} }
        @keyframes vs-pop { 0%{transform:scale(.94);opacity:0} 100%{transform:scale(1);opacity:1} }
        .vs-input::placeholder { color: #97A0B0; }
        .vs-input:focus { border-color: ${VIOLET_BRIGHT}; box-shadow: 0 0 0 3px rgba(109,74,224,0.14); }
        .vs-scroll { scrollbar-width: thin; scrollbar-color: rgba(27,37,89,0.20) transparent; }
        .vs-scroll::-webkit-scrollbar { width: 6px; }
        .vs-scroll::-webkit-scrollbar-thumb { background: rgba(27,37,89,0.20); border-radius: 8px; }
      `}</style>

      {/* ---- Body copy only. The module TITLE is deliberately absent: ModuleStage
              already renders "Values Card Sort" and the category line above. ---- */}
      <div style={{ flexShrink: 0, textAlign: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 9,
          fontSize: 22.5, fontWeight: 800, letterSpacing: -0.3, color: VIOLET,
        }}>
          <Target size={20} color={VIOLET_BRIGHT} strokeWidth={2.4} />
          {PROMPT[round]?.head ?? PROMPT[1].head}
        </div>
        <div style={{ marginTop: 3, fontSize: 16.5, fontWeight: 500, color: INK_MUTED }}>
          {PROMPT[round]?.sub ?? PROMPT[1].sub}
        </div>
      </div>

      {/* ============ MAIN ROW ============ */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, alignItems: 'stretch' }}>

        {/* ---- LEFT: How it works ---- */}
        <aside style={{
          width: 216, flexShrink: 0, minHeight: 0,
          display: 'flex', flexDirection: 'column', gap: 10,
          padding: '12px 13px 13px', borderRadius: 18,
          background: '#ffffff', border: `1px solid ${HAIRLINE}`,
          boxShadow: '0 3px 12px rgba(20,30,40,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <BookOpen size={17} color={VIOLET_BRIGHT} strokeWidth={2.2} />
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.2, color: VIOLET }}>How it works</span>
          </div>

          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            {(STEPS[round] ?? STEPS[1]).map((s, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{
                  width: 19, height: 19, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: VIOLET, color: '#ffffff', fontSize: 13.5, fontWeight: 700, lineHeight: 1,
                }}>{i + 1}</span>
                <span style={{ fontSize: 16.5, lineHeight: 1.4, fontWeight: 500, color: INK_BODY }}>{s}</span>
              </li>
            ))}
          </ol>

          <div style={{ height: 1, background: HAIRLINE, flexShrink: 0 }} />

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, flexShrink: 0 }}>
            <Lightbulb size={16} color="#D97706" fill="#FCD34D" strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 16, lineHeight: 1.4, fontWeight: 500, color: INK_MUTED }}>
              Take your time. There are no right or wrong answers.
            </span>
          </div>
        </aside>

        {/* ---- Discard pile ---- */}
        <Pile
          tone="red"
          label="Not Right Now"
          count={notNow.length}
          cards={notNow}
          active={swipeSide === 'notNow'}
        />

        {/* ---- CENTRE ---- */}
        <div style={{
          flex: 1, minWidth: 0, minHeight: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          {!started ? (
            <EmptyStage isT={isT} onStart={startRound1} />
          ) : round === 1 ? (
            <>
              <div style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: 470, position: 'relative', display: 'flex' }}>
                {/* Sibling cards peeking out behind the top card */}
                {pool.slice(1, 3).map((c, i) => (
                  <div key={c.id} aria-hidden style={{
                    position: 'absolute', inset: 0, borderRadius: 22,
                    background: '#ffffff', border: `1.5px solid ${VIOLET_LINE}`,
                    transform: `translate(${(i + 1) * 11}px, ${(i + 1) * 9}px)`,
                    zIndex: 1 - i, pointerEvents: 'none',
                  }} />
                ))}

                {topCard ? (
                  <ValueCard
                    key={topCard.id}
                    card={topCard}
                    index={sortedCount + 1}
                    total={cards.length}
                    dx={dragDX}
                    side={swipeSide}
                    canInteract={canInteract}
                    onPointerDown={(x) => { if (canInteract) dragFrom.current = x }}
                    onPointerMove={(x) => { if (dragFrom.current !== null) setDragDX(x - dragFrom.current) }}
                    onPointerUp={(x) => { if (dragFrom.current !== null) endDrag(x - dragFrom.current) }}
                  />
                ) : (
                  <DoneCard sorted={cards.length} />
                )}
              </div>

              <DragHint dim={!topCard || !canInteract} />
            </>
          ) : round === 2 ? (
            <CompareStage
              cards={cards}
              comparePair={comparePair}
              remaining={important.length}
              canInteract={canInteract}
              onPick={eliminate}
            />
          ) : (
            <FinalStage final={final} highlighted={highlighted} canInteract={canInteract} onPick={highlight} />
          )}
        </div>

        {/* ---- Keep pile ---- */}
        <Pile
          tone="green"
          label={round === 3 ? 'Core Values' : 'Important to Me'}
          count={round === 3 ? final.length : important.length}
          cards={round === 3 ? final : important}
          active={swipeSide === 'important'}
        />
      </div>

      {/* ============ ACTION BAR ============ */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>

        {/* Therapist tools. `addCustom` and `reset` have always been isT-gated. */}
        <div style={{ width: 216, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {isT && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setCustomOpen(o => !o)} style={ghostBtn}>
                <Plus size={15} strokeWidth={2.6} color={VIOLET} />
                Add Custom Value
              </button>
              <button onClick={reset} style={{ ...ghostBtn, color: INK_MUTED, borderColor: HAIRLINE }} title="Restart at Round 1">
                <RotateCcw size={15} strokeWidth={2.4} color={INK_MUTED} />
                Reset
              </button>
            </div>
          )}
          {isT && customOpen && (
            <div style={{ display: 'flex', gap: 6 }}>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input
                autoFocus
                className="vs-input"
                value={customValue}
                onChange={e => setCustomValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitCustom()}
                placeholder="Name a value"
                style={inputStyle}
              />
              <button onClick={submitCustom} style={chipBtn}>Add</button>
            </div>
          )}
        </div>

        {/* The two big choices — round 1 only, where a single card is in hand. */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', gap: 14 }}>
          {started && round === 1 && (
            <>
              <button
                onClick={() => topCard && sortCard(topCard.id, 'notNow')}
                disabled={!topCard || !canInteract}
                style={bigBtn(RED, 'rgba(220,38,38,0.28)', !topCard || !canInteract)}
              >
                <X size={21} strokeWidth={3} color="#ffffff" />
                Not Right Now
              </button>
              <button
                onClick={() => topCard && sortCard(topCard.id, 'important')}
                disabled={!topCard || !canInteract}
                style={bigBtn(GREEN_DEEP, 'rgba(21,128,61,0.28)', !topCard || !canInteract)}
              >
                <Heart size={20} fill="#ffffff" color="#ffffff" />
                Important to Me
              </button>
            </>
          )}
        </div>

        {/* Progress + next-round pair */}
        {started && (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'stretch', gap: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '9px 13px', borderRadius: 14,
              background: '#ffffff', border: `1px solid ${HAIRLINE}`,
            }}>
              <Trophy size={19} color={allSorted ? '#D97706' : INK_FAINT} strokeWidth={2.1} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: -0.2, color: allSorted ? GREEN_DEEP : VIOLET }}>
                  {allSorted ? 'All sorted!' : 'Keep going!'}
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, color: INK_FAINT }}>
                  {allSorted
                    ? `${sortedCount} of ${cards.length} values placed.`
                    : `Sort all values to continue.`}
                </div>
              </div>
            </div>

            {round < 3 && (
              <button
                onClick={advanceRound}
                disabled={!isT}
                title={isT
                  ? (allSorted ? `Continue to Round ${round + 1}` : 'Values are still unsorted — you can continue anyway')
                  : 'Your therapist moves the rounds along'}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                  padding: '9px 13px', borderRadius: 14, textAlign: 'left',
                  background: VIOLET_TINT, border: `1px solid ${VIOLET_LINE}`,
                  fontFamily: '"DM Sans", sans-serif',
                  cursor: isT ? 'pointer' : 'default',
                  opacity: allSorted || !isT ? 1 : 0.72,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 17, fontWeight: 800, letterSpacing: -0.2, color: VIOLET }}>
                  Continue to Round {round + 1}
                  <ArrowRight size={15} strokeWidth={2.6} color={VIOLET} />
                  {!allSorted && <Lock size={13} strokeWidth={2.4} color={VIOLET_BRIGHT} />}
                </span>
                <span style={{ fontSize: 14, fontWeight: 500, color: '#6B6394' }}>
                  {round === 1 ? 'Find your most important values right now.' : 'Lock in your core values.'}
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ===========================================================================
   Pieces
=========================================================================== */

/** The centre card: count pill, people mark, the value in very large caps,
    a heart divider and the description. Drag is pointer-based so one code
    path serves mouse and touch alike. */
function ValueCard({ card, index, total, dx, side, canInteract, onPointerDown, onPointerMove, onPointerUp }: {
  card: VCard
  index: number
  total: number
  dx: number
  side: 'notNow' | 'important' | null
  canInteract: boolean
  onPointerDown: (x: number) => void
  onPointerMove: (x: number) => void
  onPointerUp: (x: number) => void
}) {
  const edge = side === 'notNow' ? RED : side === 'important' ? GREEN : VIOLET_LINE
  return (
    <div
      onPointerDown={e => { if (!canInteract) return; e.currentTarget.setPointerCapture(e.pointerId); onPointerDown(e.clientX) }}
      onPointerMove={e => onPointerMove(e.clientX)}
      onPointerUp={e => onPointerUp(e.clientX)}
      onPointerCancel={e => onPointerUp(e.clientX)}
      style={{
        position: 'relative', zIndex: 3, flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '14px 22px 18px', borderRadius: 22, overflow: 'hidden',
        background: '#ffffff', border: `2px solid ${edge}`,
        boxShadow: side ? `0 10px 26px ${side === 'notNow' ? 'rgba(220,38,38,0.18)' : 'rgba(22,163,74,0.18)'}` : '0 6px 20px rgba(20,30,40,0.08)',
        transform: `translateX(${dx}px) rotate(${dx * 0.03}deg)`,
        transition: dx === 0 ? 'transform .22s ease, border-color .15s, box-shadow .15s' : 'border-color .15s, box-shadow .15s',
        cursor: canInteract ? 'grab' : 'default',
        touchAction: 'none', userSelect: 'none',
      }}
    >
      {/* Count pill */}
      <span style={{
        position: 'absolute', top: 13, left: 15,
        padding: '4px 11px', borderRadius: 999,
        background: GREEN_TINT, border: `1px solid ${GREEN_LINE}`,
        fontSize: 16.5, fontWeight: 700, color: GREEN_DEEP, fontVariantNumeric: 'tabular-nums',
      }}>
        {index} / {total}
      </span>

      {/* People mark in a pale violet circle */}
      <span aria-hidden style={{
        width: 62, height: 62, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: VIOLET_TINT, marginBottom: 6,
      }}>
        <Users size={31} color={VIOLET_BRIGHT} fill={VIOLET_BRIGHT} strokeWidth={1.6} />
      </span>

      <div style={{
        fontSize: 50.5, fontWeight: 800, letterSpacing: 0.5, lineHeight: 1.05,
        textTransform: 'uppercase', color: INK, textAlign: 'center', wordBreak: 'break-word',
      }}>
        {card.text}
      </div>

      {/* Heart divider */}
      <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 10, width: '72%', margin: '10px 0 8px' }}>
        <span style={{ flex: 1, height: 1, background: HAIRLINE }} />
        <Heart size={13} color={VIOLET_BRIGHT} fill={VIOLET_BRIGHT} />
        <span style={{ flex: 1, height: 1, background: HAIRLINE }} />
      </div>

      <div style={{
        fontSize: 19.5, fontWeight: 500, lineHeight: 1.35, color: INK_BODY,
        textAlign: 'center', maxWidth: 330,
      }}>
        {describe(card.text)}
      </div>
    </div>
  )
}

/** Shown in the stack slot once every value has been placed. */
function DoneCard({ sorted }: { sorted: number }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 22, background: '#ffffff', border: `2px dashed ${VIOLET_LINE}`,
      padding: 20, textAlign: 'center',
    }}>
      <Trophy size={34} color="#D97706" strokeWidth={2} />
      <div style={{ fontSize: 25.5, fontWeight: 800, letterSpacing: -0.3, color: VIOLET }}>Every value is sorted</div>
      <div style={{ fontSize: 17, fontWeight: 500, color: INK_MUTED, maxWidth: 320 }}>
        All {sorted} cards are in a pile. Your therapist can move you to the next round.
      </div>
    </div>
  )
}

/** "←---- ✋ Drag the card ----→" beneath the stack. */
function DragHint({ dim }: { dim: boolean }) {
  return (
    <div aria-hidden style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
      fontSize: 16.5, fontWeight: 600, color: VIOLET, opacity: dim ? 0.3 : 1,
      transition: 'opacity .15s',
    }}>
      <DashArrow dir="left" />
      <Hand size={16} color={VIOLET_BRIGHT} strokeWidth={2.2} />
      Drag the card
      <DashArrow dir="right" />
    </div>
  )
}

function DashArrow({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width={54} height={12} viewBox="0 0 54 12" fill="none" aria-hidden
      style={{ transform: dir === 'left' ? 'scaleX(-1)' : undefined, display: 'block' }}>
      <path d="M1 6h42" stroke={VIOLET_BRIGHT} strokeWidth={1.8} strokeLinecap="round" strokeDasharray="5 5" />
      <path d="M43 1.5 49.5 6 43 10.5" stroke={VIOLET_BRIGHT} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

/** A dashed drop pile with a straddling badge, a saturated label, a count and
    a real stack of tinted cards. */
function Pile({ tone, label, count, cards, active }: {
  tone: 'red' | 'green'
  label: string
  count: number
  cards: VCard[]
  active: boolean
}) {
  const red = tone === 'red'
  const accent = red ? RED : GREEN          // the saturated pile label
  const deep = red ? '#B91C1C' : GREEN_DEEP // smaller copy + the badge fill, for contrast
  const tint = red ? RED_TINT : GREEN_TINT
  const line = red ? RED_LINE : GREEN_LINE
  const stack = cards.slice(-5)

  return (
    <div style={{
      width: 196, flexShrink: 0, minHeight: 0,
      display: 'flex', flexDirection: 'column',
      position: 'relative', marginTop: 16,
      padding: '26px 12px 12px', borderRadius: 20,
      border: `2px dashed ${accent}`,
      background: active ? tint : 'transparent',
      boxShadow: active ? `0 0 0 4px ${tint}` : 'none',
      transition: 'background .15s, box-shadow .15s',
    }}>
      {/* Badge straddles the top border */}
      <span aria-hidden style={{
        position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)',
        width: 36, height: 36, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: deep, border: '3px solid #ffffff',
        boxShadow: `0 3px 10px ${red ? 'rgba(220,38,38,0.30)' : 'rgba(22,163,74,0.30)'}`,
      }}>
        {red
          ? <X size={19} strokeWidth={3.4} color="#ffffff" />
          : <Heart size={17} fill="#ffffff" color="#ffffff" />}
      </span>

      <div style={{
        flexShrink: 0, textAlign: 'center',
        fontSize: 19, fontWeight: 800, letterSpacing: -0.2, color: accent, lineHeight: 1.15,
      }}>
        {label}
      </div>
      <div style={{
        flexShrink: 0, textAlign: 'center', marginTop: 2, marginBottom: 8,
        fontSize: 16.5, fontWeight: 600, color: deep, fontVariantNumeric: 'tabular-nums',
      }}>
        {count} {count === 1 ? 'value' : 'values'}
      </div>

      {/* The stack itself — newest on top, siblings peeking out beneath. */}
      <div className="vs-scroll" style={{
        flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
        paddingTop: 2,
      }}>
        {stack.length === 0 ? (
          <span style={{ fontSize: 15.5, fontWeight: 500, color: INK_FAINT, textAlign: 'center', paddingTop: 10 }}>
            Nothing here yet.
          </span>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stack.slice().reverse().map(c => (
              <div key={c.id} style={{
                padding: '7px 10px', borderRadius: 11,
                background: tint, border: `1px solid ${line}`,
                fontSize: 16.5, fontWeight: 700, textTransform: 'capitalize',
                color: red ? '#991B1B' : '#14532D',
                textAlign: 'center',
                animation: 'vs-pop .18s ease',
              }}>
                {c.text}
              </div>
            ))}
            {cards.length > stack.length && (
              <div style={{ fontSize: 14, fontWeight: 600, color: deep, textAlign: 'center', paddingTop: 2 }}>
                +{cards.length - stack.length} more
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Before the deck exists. */
function EmptyStage({ isT, onStart }: { isT: boolean; onStart: () => void }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, width: '100%', maxWidth: 470,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
      padding: 22, borderRadius: 22, textAlign: 'center',
      background: '#ffffff', border: `2px dashed ${VIOLET_LINE}`,
    }}>
      <span aria-hidden style={{
        width: 58, height: 58, borderRadius: '50%', background: VIOLET_TINT,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Users size={28} color={VIOLET_BRIGHT} fill={VIOLET_BRIGHT} strokeWidth={1.6} />
      </span>
      <div style={{ fontSize: 23.5, fontWeight: 800, letterSpacing: -0.3, color: VIOLET }}>
        {isT ? 'Ready when you are' : 'Waiting for your therapist…'}
      </div>
      <div style={{ fontSize: 17, fontWeight: 500, color: INK_MUTED, maxWidth: 320 }}>
        {isT
          ? 'Deal the deck of 20 values and sort them one card at a time.'
          : 'Your therapist will deal the deck of values in a moment.'}
      </div>
      {isT && (
        <button onClick={onStart} style={bigBtn(VIOLET, 'rgba(76,63,191,0.28)', false)}>
          Start Round 1
        </button>
      )}
    </div>
  )
}

/** Round 2: two values head to head. Picking one eliminates the other. */
function CompareStage({ cards, comparePair, remaining, canInteract, onPick }: {
  cards: VCard[]
  comparePair: [string, string] | null
  remaining: number
  canInteract: boolean
  onPick: (keepId: string, dropId: string) => void
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {comparePair ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14 }}>
          {comparePair.map((pid, idx) => {
            const card = cards.find(c => c.id === pid)
            const other = comparePair[idx === 0 ? 1 : 0]
            if (!card) return null
            return (
              <button
                key={pid}
                onClick={() => onPick(pid, other)}
                disabled={!canInteract}
                style={{
                  flex: 1, minWidth: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '18px 16px', borderRadius: 22,
                  background: '#ffffff', border: `2px solid ${VIOLET_LINE}`,
                  boxShadow: '0 6px 20px rgba(20,30,40,0.07)',
                  fontFamily: '"DM Sans", sans-serif',
                  cursor: canInteract ? 'pointer' : 'default',
                }}
              >
                <span aria-hidden style={{
                  width: 50, height: 50, borderRadius: '50%', background: VIOLET_TINT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Heart size={24} color={VIOLET_BRIGHT} fill={VIOLET_BRIGHT} />
                </span>
                <span style={{
                  fontSize: 37, fontWeight: 800, letterSpacing: 0.4, lineHeight: 1.05,
                  textTransform: 'uppercase', color: INK, textAlign: 'center', wordBreak: 'break-word',
                }}>
                  {card.text}
                </span>
                <span style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.35, color: INK_BODY, textAlign: 'center', maxWidth: 260 }}>
                  {describe(card.text)}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
          borderRadius: 22, border: `2px dashed ${VIOLET_LINE}`, background: '#ffffff', textAlign: 'center', padding: 20,
        }}>
          <Trophy size={32} color="#D97706" strokeWidth={2} />
          <div style={{ fontSize: 23.5, fontWeight: 800, letterSpacing: -0.3, color: VIOLET }}>
            {remaining} value{remaining === 1 ? '' : 's'} remaining
          </div>
          <div style={{ fontSize: 17, fontWeight: 500, color: INK_MUTED }}>
            There is nothing left to compare.
          </div>
        </div>
      )}
      <div style={{ flexShrink: 0, textAlign: 'center', fontSize: 16.5, fontWeight: 600, color: INK_FAINT }}>
        {remaining} remaining — keep going until 3–5 remain
      </div>
    </div>
  )
}

/** Round 3: the core values, one of which can be marked. */
function FinalStage({ final, highlighted, canInteract, onPick }: {
  final: VCard[]
  highlighted: string
  canInteract: boolean
  onPick: (id: string) => void
}) {
  return (
    <div className="vs-scroll" style={{
      flex: 1, minHeight: 0, width: '100%', overflowY: 'auto', overflowX: 'hidden',
      display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'center',
      alignContent: 'center', padding: 4,
    }}>
      {final.length === 0 && (
        <span style={{ fontSize: 16.5, fontWeight: 500, color: INK_FAINT }}>No core values were carried through.</span>
      )}
      {final.slice(0, 5).map(c => {
        const on = highlighted === c.id
        return (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            disabled={!canInteract}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              padding: '18px 22px', borderRadius: 20, minWidth: 168,
              background: on ? VIOLET_TINT : '#ffffff',
              border: `2px solid ${on ? VIOLET_BRIGHT : VIOLET_LINE}`,
              fontFamily: '"DM Sans", sans-serif',
              cursor: canInteract ? 'pointer' : 'default',
              animation: on ? 'vs-glow 2s ease-in-out infinite' : 'none',
              boxShadow: on ? 'none' : '0 4px 14px rgba(20,30,40,0.06)',
            }}
          >
            <Heart size={19} color={VIOLET_BRIGHT} fill={on ? VIOLET_BRIGHT : 'none'} />
            <span style={{
              fontSize: 30, fontWeight: 800, letterSpacing: 0.4, lineHeight: 1.1,
              textTransform: 'uppercase', color: INK,
            }}>
              {c.text}
            </span>
            <span style={{ fontSize: 16, fontWeight: 600, color: on ? VIOLET : INK_FAINT }}>
              {on ? 'Living this least lately' : 'Tap to mark'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ===========================================================================
   Shared styles
=========================================================================== */

const bigBtn = (bg: string, glow: string, disabled: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  padding: '13px 26px', borderRadius: 14, border: 'none',
  background: bg, color: '#ffffff', fontSize: 20.5, fontWeight: 700,
  fontFamily: '"DM Sans", sans-serif', whiteSpace: 'nowrap',
  boxShadow: disabled ? 'none' : `0 6px 16px ${glow}`,
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.45 : 1,
})

const ghostBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 12px', borderRadius: 12,
  border: `1px solid ${VIOLET_LINE}`, background: '#ffffff',
  color: VIOLET, fontSize: 16, fontWeight: 700,
  fontFamily: '"DM Sans", sans-serif', cursor: 'pointer', whiteSpace: 'nowrap',
}

const chipBtn: CSSProperties = {
  padding: '8px 14px', borderRadius: 10, border: 'none',
  background: VIOLET, color: '#ffffff', fontSize: 16, fontWeight: 700,
  fontFamily: '"DM Sans", sans-serif', cursor: 'pointer', flexShrink: 0,
}

const inputStyle: CSSProperties = {
  flex: 1, minWidth: 0, background: '#ffffff', border: `1px solid ${HAIRLINE}`,
  borderRadius: 10, padding: '8px 11px', fontSize: 16.5, color: '#1E293B',
  outline: 'none', fontFamily: '"DM Sans", sans-serif',
  transition: 'border-color .15s, box-shadow .15s',
}
