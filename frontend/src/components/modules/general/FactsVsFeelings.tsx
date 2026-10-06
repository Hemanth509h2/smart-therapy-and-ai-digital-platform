'use client'

import { useState, useEffect, useCallback } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { Brain, FileText, Heart, MessageCircle, SquarePen } from 'lucide-react'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'

interface FactsVsFeelingsProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type Bin = 'pool' | 'facts' | 'feelings' | 'stories'
interface Card { id: string; text: string; bin: Bin }

/* ---- Palette ----------------------------------------------------------
   This module renders on ModuleStage's WHITE canvas, so every colour here
   is dark-on-light and stated literally. The shared `--ink-*` CSS vars are
   authored for the dark sidebar panel and are NOT used here. */
const INK = '#16233A'          // headings — dark navy
const INK_BODY = '#334155'     // card copy
const INK_MUTED = '#475569'    // helper copy (7:1 on white)
const INK_FAINT = '#64748B'    // micro-labels (4.9:1 on white)
const LINE = '#e7eaef'
const GREEN = '#1F7A44'        // primary action — white text only on this fill
const GREEN_LINE = 'rgba(31,122,68,0.35)'

const BINS: {
  id: Exclude<Bin, 'pool'>
  label: string
  desc: string
  accent: string
  tint: string
  ring: string
  Icon: typeof FileText
}[] = [
  { id: 'facts', label: 'Facts', desc: 'Things that are true and can be proven.', accent: '#2563EB', tint: '#EFF6FF', ring: 'rgba(37,99,235,0.18)', Icon: FileText },
  { id: 'feelings', label: 'Feelings', desc: 'Emotions and reactions I experience.', accent: '#EA580C', tint: '#FFF7ED', ring: 'rgba(234,88,12,0.18)', Icon: Heart },
  { id: 'stories', label: 'Stories', desc: 'Thoughts or assumptions I tell myself.', accent: '#7C3AED', tint: '#F5F3FF', ring: 'rgba(124,58,237,0.18)', Icon: MessageCircle },
]

const MAX_CHARS = 120

const FEELING_WORDS = ['scared', 'worried', 'sad', 'happy', 'anxious', 'upset', 'frustrated', 'angry', 'hopeless', 'excited', 'hurt']
const ABSOLUTE_WORDS = ['definitely', 'always', 'never', 'everyone', 'nobody', 'everything', 'nothing']

export default function FactsVsFeelings({ sessionId, role, isLocked }: FactsVsFeelingsProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [cards, setCards] = useState<Card[]>([])
  const [cardInput, setCardInput] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverBin, setDragOverBin] = useState<Bin | null>(null)
  const [bounceMsg, setBounceMsg] = useState<{ id: string; msg: string } | null>(null)
  const [overrideId, setOverrideId] = useState<Set<string>>(new Set())

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (Array.isArray(s.ffCards)) setCards(s.ffCards)
    })
    return () => unsub()
  }, [sessionId])

  const addCard = useCallback(() => {
    const t = cardInput.trim()
    if (!t || !isT) return
    const card: Card = { id: `ff${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: t, bin: 'pool' }
    write({ 'moduleState.ffCards': [...cards, card] })
    setCardInput('')
  }, [cardInput, isT, cards, write])

  const validateForFacts = (text: string): string | null => {
    const lower = text.toLowerCase()
    if (FEELING_WORDS.some(w => new RegExp(`\\b${w}\\b`).test(lower))) return 'Is that what a camera would see?'
    if (ABSOLUTE_WORDS.some(w => new RegExp(`\\b${w}\\b`).test(lower))) return 'Does that sound like a fact?'
    return null
  }

  const moveCard = useCallback((id: string, bin: Bin) => {
    if (!canInteract) return
    const card = cards.find(c => c.id === id)
    if (!card) return
    // Validation only applies to client drops into Facts, unless therapist overrode
    if (bin === 'facts' && !isT && !overrideId.has(id)) {
      const msg = validateForFacts(card.text)
      if (msg) {
        setBounceMsg({ id, msg })
        setTimeout(() => setBounceMsg(null), 2200)
        return // bounce back — do not move
      }
    }
    const updated = cards.map(c => c.id === id ? { ...c, bin } : c)
    write({ 'moduleState.ffCards': updated })
    if (bin !== 'pool') {
      logModuleEvent(sessionId, {
        module: 'facts-vs-feelings',
        type: 'card_sorted',
        detail: `Sorted "${card.text}" as a ${bin === 'facts' ? 'Fact' : bin === 'feelings' ? 'Feeling' : 'Story'}`,
      })
    }
  }, [cards, canInteract, isT, overrideId, write, sessionId])

  const overrideCard = useCallback((id: string) => {
    if (!isT) return
    setOverrideId(prev => new Set(prev).add(id))
    // keep the card in facts even if rule would bounce it
    const updated = cards.map(c => c.id === id ? { ...c, bin: 'facts' as Bin } : c)
    write({ 'moduleState.ffCards': updated })
  }, [isT, cards, write])

  const pool = cards.filter(c => c.bin === 'pool')
  const endDrag = () => { setDragId(null); setDragOverBin(null) }

  return (
    /* Root fills the stage and never scrolls itself: ModuleStage's body is
       overflow:hidden and hands every module a `height:100%` box with an
       internal flex:1 region. Only the pool strip and each zone's card list
       scroll, so the three drop zones always stay inside the canvas. */
    <div style={{
      height: '100%', minHeight: 0, maxWidth: '100%',
      display: 'flex', flexDirection: 'column', gap: 10,
      position: 'relative', fontFamily: '"DM Sans", sans-serif', color: INK,
    }}>
      <style>{`
        @keyframes ff-rise { from { opacity: 0; transform: translate(-50%, 8px) } to { opacity: 1; transform: translate(-50%, 0) } }
        .ff-input::placeholder { color: #7c8698; }
        .ff-input:focus { border-color: ${GREEN}; box-shadow: 0 0 0 3px rgba(31,122,68,0.12); }
        .ff-scroll { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
        .ff-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
        .ff-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; }
      `}</style>

      {/* ---- Identity mark + subtitle. The module TITLE is deliberately absent:
              ModuleStage already renders "Facts vs Feelings" and the category
              line directly above this body. ---- */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
        <div aria-hidden style={{
          width: 40, height: 40, borderRadius: '50%', background: '#ffffff',
          border: `1px solid ${LINE}`, boxShadow: '0 2px 8px rgba(20,30,45,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Brain size={21} color={GREEN} strokeWidth={1.9} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 500, color: INK_MUTED, textAlign: 'center' }}>
          Sort each thought into the right category
        </div>
      </div>

      {/* ---- Pool: the thoughts still waiting to be sorted. Also a drop target,
              so a mis-sorted card can be dragged back out of a zone. ---- */}
      <div
        className="ff-scroll"
        onDragOver={e => { e.preventDefault(); setDragOverBin('pool') }}
        onDragLeave={() => setDragOverBin(prev => (prev === 'pool' ? null : prev))}
        onDrop={() => { if (dragId) moveCard(dragId, 'pool'); endDrag() }}
        style={{
          flexShrink: 0, maxHeight: 148, overflowY: 'auto', overflowX: 'hidden',
          display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', alignItems: 'flex-start',
          padding: 8, borderRadius: 16,
          border: `1.5px dashed ${dragOverBin === 'pool' ? '#94A3B8' : 'transparent'}`,
          background: dragOverBin === 'pool' ? '#F8FAFC' : 'transparent',
          transition: 'background .15s, border-color .15s',
        }}
      >
        {pool.length === 0 && (
          <span style={{ fontSize: 16, color: INK_FAINT, padding: '14px 0' }}>
            {cards.length === 0
              ? (isT ? 'No cards yet — write one in “Create a Card”.' : 'Waiting for your therapist to add a thought…')
              : 'Every thought has been sorted.'}
          </span>
        )}
        {pool.map(c => (
          <ThoughtCard
            key={c.id}
            card={c}
            canInteract={canInteract}
            dragging={dragId === c.id}
            onDragStart={() => setDragId(c.id)}
            onDragEnd={endDrag}
          />
        ))}
      </div>

      {/* Dashed drop hint — mirrors the mockup's curved arrow, only while a card
          is in hand. Fixed height so nothing reflows when it appears. */}
      <div aria-hidden style={{
        flexShrink: 0, height: 18, display: 'flex', justifyContent: 'center',
        opacity: dragId ? 1 : 0, transition: 'opacity .15s',
      }}>
        <svg width="46" height="18" viewBox="0 0 46 22" fill="none">
          <path d="M7 3 C 7 15, 21 8, 26 17" stroke="#94A3B8" strokeWidth="1.7" strokeLinecap="round" strokeDasharray="4 4" />
          <path d="M21.5 14 L26.4 19 L31 13.5" stroke="#94A3B8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>

      {/* ---- The sorting surface: three zones, plus the therapist's card composer ---- */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 10 }}>
          {BINS.map(bin => {
            const binCards = cards.filter(c => c.bin === bin.id)
            const over = dragOverBin === bin.id
            const Icon = bin.Icon
            return (
              <div
                key={bin.id}
                onDragOver={e => { e.preventDefault(); setDragOverBin(bin.id) }}
                onDragLeave={() => setDragOverBin(prev => (prev === bin.id ? null : prev))}
                onDrop={() => { if (dragId) moveCard(dragId, bin.id); endDrag() }}
                style={{
                  flex: 1, minWidth: 0, minHeight: 0,
                  display: 'flex', flexDirection: 'column', gap: 8,
                  padding: '12px 10px', borderRadius: 18,
                  background: over ? bin.tint : '#ffffff',
                  border: `2px ${over ? 'solid' : 'dashed'} ${bin.accent}`,
                  boxShadow: over ? `0 0 0 4px ${bin.ring}` : 'none',
                  transition: 'background .15s, box-shadow .15s',
                }}
              >
                {/* Zone identity */}
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, position: 'relative' }}>
                  {binCards.length > 0 && (
                    <span style={{
                      position: 'absolute', top: -2, right: 0,
                      minWidth: 20, padding: '2px 7px', borderRadius: 999,
                      background: bin.tint, border: `1px solid ${bin.accent}`,
                      fontSize: 13.5, fontWeight: 700, color: bin.accent, lineHeight: 1.4,
                    }}>{binCards.length}</span>
                  )}
                  <div aria-hidden style={{
                    width: 38, height: 38, borderRadius: '50%', background: bin.tint,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Icon size={19} color={bin.accent} strokeWidth={2} />
                  </div>
                  <div style={{ fontSize: 20.5, fontWeight: 800, letterSpacing: -0.2, color: bin.accent, lineHeight: 1.1 }}>
                    {bin.label}
                  </div>
                  <div style={{ fontSize: 15.5, lineHeight: 1.35, color: INK_MUTED, textAlign: 'center', maxWidth: 190 }}>
                    {bin.desc}
                  </div>
                </div>

                {/* Sorted cards */}
                <div className="ff-scroll" style={{
                  flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
                  display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2,
                }}>
                  {binCards.map(c => (
                    <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <SortedCard
                        card={c}
                        accent={bin.accent}
                        tint={bin.tint}
                        canInteract={canInteract}
                        dragging={dragId === c.id}
                        onDragStart={() => setDragId(c.id)}
                        onDragEnd={endDrag}
                      />
                      {isT && bin.id === 'facts' && !overrideId.has(c.id) && (
                        <button onClick={() => overrideCard(c.id)} style={{
                          alignSelf: 'flex-start', fontSize: 13, fontWeight: 600, padding: '3px 8px',
                          borderRadius: 999, border: `1px solid ${LINE}`, background: '#ffffff',
                          color: INK_FAINT, cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
                        }}>Keep here</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* ---- Therapist-only composer. `addCard` has always been gated on isT,
                so clients simply get the full width for the three zones. ---- */}
        {isT && (
          <aside style={{
            width: 244, flexShrink: 0, minHeight: 0,
            display: 'flex', flexDirection: 'column', gap: 10,
            padding: 14, borderRadius: 18, background: '#ffffff',
            border: `1.5px solid ${GREEN_LINE}`, boxShadow: '0 2px 10px rgba(20,30,45,0.06)',
          }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <SquarePen size={19} color={GREEN} strokeWidth={2} />
              <span style={{ fontSize: 18.5, fontWeight: 800, letterSpacing: -0.2, color: INK }}>Create a Card</span>
            </div>

            <div style={{ position: 'relative', flex: 1, minHeight: 74, display: 'flex' }}>
              <textarea
                className="ff-input"
                value={cardInput}
                onChange={e => setCardInput(e.target.value.slice(0, MAX_CHARS))}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addCard() } }}
                placeholder="Type your thought here…"
                maxLength={MAX_CHARS}
                style={{
                  flex: 1, width: '100%', boxSizing: 'border-box', resize: 'none', outline: 'none',
                  padding: '11px 12px 24px', borderRadius: 14,
                  border: `1px solid ${LINE}`, background: '#ffffff',
                  fontSize: 16.5, lineHeight: 1.4, color: INK_BODY,
                  fontFamily: '"DM Sans", sans-serif',
                  transition: 'border-color .15s, box-shadow .15s',
                }}
              />
              <span style={{
                position: 'absolute', right: 11, bottom: 8, pointerEvents: 'none',
                fontSize: 14, fontWeight: 600, color: INK_FAINT,
              }}>{cardInput.length}/{MAX_CHARS}</span>
            </div>

            <button
              onClick={addCard}
              disabled={!cardInput.trim()}
              style={{
                flexShrink: 0, width: '100%', padding: '11px 14px', borderRadius: 12, border: 'none',
                background: GREEN, color: '#ffffff', fontSize: 17, fontWeight: 700,
                fontFamily: '"DM Sans", sans-serif',
                cursor: cardInput.trim() ? 'pointer' : 'default',
                opacity: cardInput.trim() ? 1 : 0.5,
                boxShadow: '0 4px 12px rgba(31,122,68,0.24)',
              }}
            >
              Create Card
            </button>
          </aside>
        )}
      </div>

      {/* Socratic nudge when a client's drop into Facts bounces back. */}
      {bounceMsg && (
        <div role="status" style={{
          position: 'absolute', left: '50%', bottom: 10, transform: 'translateX(-50%)',
          background: '#FFF7ED', border: '1.5px solid #EA580C', borderRadius: 12,
          padding: '9px 16px', fontSize: 16.5, fontWeight: 600, color: '#9A3412',
          boxShadow: '0 6px 18px rgba(20,30,45,0.12)', animation: 'ff-rise .25s ease',
          maxWidth: '80%', textAlign: 'center', zIndex: 5,
        }}>
          {bounceMsg.msg}
        </div>
      )}
    </div>
  )
}

/** An unsorted thought, as it sits in the pool row. */
function ThoughtCard({ card, canInteract, dragging, onDragStart, onDragEnd }: {
  card: Card; canInteract: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void
}) {
  return (
    <div
      draggable={canInteract}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        width: 152, minHeight: 62, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        padding: '11px 13px', borderRadius: 16,
        background: '#ffffff',
        border: `1.5px solid ${dragging ? GREEN : LINE}`,
        boxShadow: dragging ? '0 6px 18px rgba(31,122,68,0.18)' : '0 2px 8px rgba(20,30,45,0.06)',
        fontSize: 16.5, lineHeight: 1.35, fontWeight: 500, color: INK_BODY,
        cursor: canInteract ? 'grab' : 'default',
        transition: 'border-color .12s, box-shadow .12s',
        userSelect: 'none',
      }}
    >
      {card.text}
    </div>
  )
}

/** A thought already dropped into a category — compact, tinted, still draggable. */
function SortedCard({ card, accent, tint, canInteract, dragging, onDragStart, onDragEnd }: {
  card: Card; accent: string; tint: string; canInteract: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void
}) {
  return (
    <div
      draggable={canInteract}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        padding: '7px 10px', borderRadius: 11,
        background: tint,
        border: `1px solid ${dragging ? GREEN : accent}`,
        fontSize: 15.5, lineHeight: 1.35, fontWeight: 500, color: INK_BODY,
        cursor: canInteract ? 'grab' : 'default',
        userSelect: 'none',
      }}
    >
      {card.text}
    </div>
  )
}
