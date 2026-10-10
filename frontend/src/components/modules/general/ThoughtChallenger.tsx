'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { Plus, Search, Shield, Scale, ArrowDown, Lightbulb, Pencil, Check, ArrowRight } from 'lucide-react'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { apiFetch } from '@/lib/api';

interface ThoughtChallengerProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type Bin = 'pool' | 'for' | 'against' | 'unclear'
interface Card {
  id: string
  text: string
  bin: Bin
}

/* ---------------------------------------------------------------------------
   Palette. This module renders on ModuleStage's WHITE canvas, so every colour
   below is chosen for dark-on-light contrast: saturated zone accents on their
   own pale tints, white text ONLY on the two solid saturated buttons.
--------------------------------------------------------------------------- */
const INK = '#1B2559'
const INK_SOFT = '#475569'
const INK_FAINT = '#94A3B8'
const HAIRLINE = '#e7eaef'

const VIOLET = '#6D28D9'
const VIOLET_BRIGHT = '#7C3AED'
const VIOLET_DEEP = '#5B21B6'
const BLUE = '#2563EB'
const GREEN = '#16A34A'

interface BinSpec {
  id: Exclude<Bin, 'pool'>
  label: string
  sub: string
  accent: string
  tint: string
  border: string
  dash: string
  cardBorder: string
}

const BINS: BinSpec[] = [
  { id: 'for', label: 'Evidence For', sub: 'Supports the thought', accent: GREEN, tint: '#F2FCF5', border: '#CBEFD8', dash: '#8FDCAA', cardBorder: '#D9F2E2' },
  { id: 'against', label: 'Evidence Against', sub: 'Challenges the thought', accent: BLUE, tint: '#F1F6FE', border: '#CFE0FB', dash: '#9CBFF7', cardBorder: '#DBE8FD' },
  { id: 'unclear', label: 'Assumption / Unclear', sub: 'Not certain yet', accent: VIOLET_BRIGHT, tint: '#F7F3FE', border: '#DFD3FB', dash: '#C0A8F6', cardBorder: '#E8DEFC' },
]

/* The takeaway shown under the completed summary. Picks its tone from what the
   work actually showed — a drop in belief, no change, or a rise — so it never
   congratulates a shift that didn't happen. */
function closingComment(
  thought: string,
  againstCount: number,
  before: number | null,
  after: number | null,
): string {
  const quoted = thought ? `“${thought}”` : 'that thought'
  const found = againstCount > 0
    ? `You found ${againstCount} piece${againstCount === 1 ? '' : 's'} of evidence that ${quoted} isn’t the whole story. `
    : ''
  if (before != null && after != null) {
    if (after < before) {
      return `${found}Great detective work — your belief in it dropped from ${before} to ${after}. Thoughts can feel like facts, but when you check them, they often loosen their grip. Keep your balanced thought handy for next time.`
    }
    if (after === before) {
      return `${found}Your belief stayed at ${before}, and that’s okay — just stopping to look at the evidence is a skill. Each time you practise, the balanced thought gets a little easier to reach.`
    }
    return `${found}This thought still feels strong right now, and that’s worth talking through together. Noticing it and testing it is the first brave step.`
  }
  return `${found}You slowed down and looked at ${quoted} from more than one side. That’s exactly how we stop a thought from running the show.`
}

const STEPS = [
  'Click “Add Thought” to write your thought.',
  'Click “Add Evidence” to add evidence cards.',
  'Drag and drop each evidence card into the right category.',
]

export default function ThoughtChallenger({ sessionId, role, isLocked }: ThoughtChallengerProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [thought, setThought] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [reframe, setReframe] = useState('')

  const [thoughtInput, setThoughtInput] = useState('')
  const [cardInput, setCardInput] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverBin, setDragOverBin] = useState<Bin | null>(null)
  const [shakeId, setShakeId] = useState<string | null>(null)
  const [bounceId, setBounceId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  /* Belief ratings and completion. The reframe used to be the end of the road:
     it appeared and nothing followed it, so the activity had no close. The
     "before" rating is attached to the thought rather than added as a step —
     the four-step flow is unchanged — and it is what makes the summary able to
     report a CHANGE rather than a bare number. */
  const [beliefBefore, setBeliefBefore] = useState<number | null>(null)
  const [beliefAfter, setBeliefAfter] = useState<number | null>(null)
  const [completed, setCompleted] = useState(false)

  /* Local-only reframe editing. The draft is held here and only written on
     save, so a half-typed edit never reaches the other screen. */
  const [editingReframe, setEditingReframe] = useState(false)
  const [reframeDraft, setReframeDraft] = useState('')

  /* Purely local disclosure state for the two composer rows — the mockup shows
     the buttons alone, so the inputs stay folded away until asked for. Nothing
     here is persisted; no new Firestore field is introduced. */
  const [thoughtOpen, setThoughtOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (typeof s.tcThought === 'string') setThought(s.tcThought)
      if (Array.isArray(s.tcCards)) setCards(s.tcCards)
      if (typeof s.tcReframe === 'string') setReframe(s.tcReframe)
      setBeliefBefore(typeof s.tcBeliefBefore === 'number' ? s.tcBeliefBefore : null)
      setBeliefAfter(typeof s.tcBeliefAfter === 'number' ? s.tcBeliefAfter : null)
      if (typeof s.tcCompleted === 'boolean') setCompleted(s.tcCompleted)
    })
    return () => unsub()
  }, [sessionId])

  const setThoughtFs = useCallback(() => {
    const t = thoughtInput.trim()
    if (!t || !isT) return
    write({ 'moduleState.tcThought': t })
    logModuleEvent(sessionId, {
      module: 'thought-challenger',
      type: 'thought_set',
      detail: `Examined the automatic thought: "${t}"`,
    })
    setThoughtInput('')
  }, [thoughtInput, isT, write, sessionId])

  const addCard = useCallback(() => {
    const t = cardInput.trim()
    if (!t || !isT) return
    const card: Card = { id: `tc${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: t, bin: 'pool' }
    write({ 'moduleState.tcCards': [...cards, card] })
    setCardInput('')
  }, [cardInput, isT, cards, write])

  const moveCard = useCallback((id: string, bin: Bin) => {
    if (!canInteract) return
    const updated = cards.map(c => c.id === id ? { ...c, bin } : c)
    write({ 'moduleState.tcCards': updated })
    setBounceId(id)
    setTimeout(() => setBounceId(null), 400)
  }, [cards, canInteract, write])

  // Therapist flags a card as wrongly placed: shake + return to pool
  const flagCard = useCallback((id: string) => {
    if (!isT) return
    setShakeId(id)
    setTimeout(() => {
      setShakeId(null)
      const updated = cards.map(c => c.id === id ? { ...c, bin: 'pool' as Bin } : c)
      write({ 'moduleState.tcCards': updated })
    }, 450)
  }, [isT, cards, write])

  const generateReframe = useCallback(() => {
    if (!isT) return
    const fors = cards.filter(c => c.bin === 'for').map(c => c.text)
    const against = cards.filter(c => c.bin === 'against').map(c => c.text)
    const forStr = fors.length ? fors.join(', ') : 'some evidence'
    const againstStr = against.length ? against.join(', ') : 'other evidence'
    const text = `Some ${forStr} may be true, but ${againstStr} shows it's not absolute.`
    write({ 'moduleState.tcReframe': text })
    logModuleEvent(sessionId, {
      module: 'thought-challenger',
      type: 'reframe_generated',
      detail: `Generated a balanced reframe: "${text}"`,
    })
  }, [isT, cards, write, sessionId])

  const setBelief = useCallback((which: 'before' | 'after', n: number) => {
    if (!canInteract || completed) return
    const key = which === 'before' ? 'moduleState.tcBeliefBefore' : 'moduleState.tcBeliefAfter'
    if (which === 'before') setBeliefBefore(n); else setBeliefAfter(n)
    write({ [key]: n })
  }, [canInteract, completed, write])

  const startEditReframe = useCallback(() => {
    if (!isT) return
    setReframeDraft(reframe)
    setEditingReframe(true)
  }, [isT, reframe])

  const saveReframeEdit = useCallback(() => {
    const t = reframeDraft.trim()
    if (!isT || !t) return
    setReframe(t)
    setEditingReframe(false)
    write({ 'moduleState.tcReframe': t })
    logModuleEvent(sessionId, {
      module: 'thought-challenger',
      type: 'reframe_edited',
      detail: `Edited the balanced reframe to: "${t}"`,
    })
  }, [isT, reframeDraft, write, sessionId])

  const completeActivity = useCallback(() => {
    if (!isT || !reframe) return
    setCompleted(true)
    write({ 'moduleState.tcCompleted': true })
    const shift = beliefBefore != null && beliefAfter != null
      ? `belief in the thought moved ${beliefBefore} -> ${beliefAfter} out of 10`
      : 'belief rating not recorded'
    logModuleEvent(sessionId, {
      module: 'thought-challenger',
      type: 'activity_completed',
      detail: `Completed the thought record for "${thought}" — ${shift}`,
    })
  }, [isT, reframe, beliefBefore, beliefAfter, thought, write, sessionId])

  const reopenActivity = useCallback(() => {
    if (!isT) return
    setCompleted(false)
    write({ 'moduleState.tcCompleted': false })
  }, [isT, write])

  const saveNotes = useCallback(async () => {
    if (!isT) return
    try {
      await apiFetch('/api/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, type: 'thought-challenger', thought, reframe }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch {}
  }, [isT, sessionId, thought, reframe])

  const pool = cards.filter(c => c.bin === 'pool')
  const forCount = cards.filter(c => c.bin === 'for').length
  const againstCount = cards.filter(c => c.bin === 'against').length
  const unclearCount = cards.filter(c => c.bin === 'unclear').length
  const readyToComplete = !!reframe && beliefBefore != null && beliefAfter != null

  /* Submit wrappers: they only fold the composer away, the write path itself is
     the untouched callback above. */
  const submitThought = () => { if (!thoughtInput.trim()) return; setThoughtFs(); setThoughtOpen(false) }

  return (
    /* Root fills the stage and never scrolls itself — ModuleStage's body is
       overflow:hidden and hands us a fixed box. The evidence strip scrolls
       horizontally inside itself; each drop zone scrolls inside its own dashed
       area. Nothing escapes this column. */
    <div style={{
      height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10,
      fontFamily: '"DM Sans", sans-serif', color: INK,
    }}>
      <style>{`
        @keyframes tc-bounce { 0%{transform:scale(1)} 40%{transform:scale(1.12)} 70%{transform:scale(0.96)} 100%{transform:scale(1)} }
        @keyframes tc-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-5px)} 40%{transform:translateX(5px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
        .tc-input::placeholder { color: #A6AEBC; }
        .tc-input:focus { border-color: ${VIOLET_BRIGHT}; box-shadow: 0 0 0 3px rgba(124,58,237,0.14); }
        .tc-scroll-x { scrollbar-width: thin; scrollbar-color: rgba(109,40,217,0.28) transparent; }
        .tc-scroll-x::-webkit-scrollbar { height: 7px; }
        .tc-scroll-x::-webkit-scrollbar-thumb { background: rgba(109,40,217,0.28); border-radius: 8px; }
        .tc-scroll-y { scrollbar-width: thin; scrollbar-color: rgba(27,37,89,0.20) transparent; }
        .tc-scroll-y::-webkit-scrollbar { width: 6px; }
        .tc-scroll-y::-webkit-scrollbar-thumb { background: rgba(27,37,89,0.20); border-radius: 8px; }
      `}</style>

      {/* ============ TOP ROW: thought column · How to Play ============ */}
      {/* maxHeight + an internally scrolling left column: the reframe, ratings
          and summary can grow without ever squeezing the evidence bins below.
          The module's overall footprint is unchanged. */}
      <div style={{ flexShrink: 0, minHeight: 0, maxHeight: '62%', display: 'flex', alignItems: 'flex-start', gap: 16 }}>

        {/* ---- LEFT: identity mark, actions, current thought ---- */}
        <div className="tc-scroll-y" style={{
          flex: 1, minWidth: 0, maxHeight: '100%', overflowY: 'auto', paddingRight: 2,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>

          {/* The module title itself lives in ModuleStage's header — this is the
              subtitle only, paired with the brain-in-a-speech-bubble mark. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BrainBubble />
            <div style={{ fontSize: 18.5, fontWeight: 500, lineHeight: 1.35, color: INK_SOFT, minWidth: 0 }}>
              Explore your thought and discover the evidence.
            </div>
          </div>

          {/* Setup actions retire once the activity is finished — a completed
              record should not still be offering to change its own thought. */}
          {isT && !completed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <button
                onClick={() => setThoughtOpen(o => !o)}
                style={solidBtn(VIOLET, 'rgba(109,40,217,0.28)')}
              >
                <Plus size={17} strokeWidth={2.8} color="#ffffff" />
                Add Thought
              </button>
              {/* Generating from an unsorted pile produced "Some some evidence
                  may be true, but other evidence shows..." — the sentence needs
                  at least one card on one side to say anything. */}
              <button
                onClick={generateReframe}
                disabled={forCount + againstCount === 0}
                title={forCount + againstCount === 0 ? 'Sort at least one evidence card first' : undefined}
                style={{
                  ...ghostBtn,
                  opacity: forCount + againstCount === 0 ? 0.45 : 1,
                  cursor: forCount + againstCount === 0 ? 'default' : 'pointer',
                }}
              >
                {reframe ? 'Regenerate reframe' : 'Generate reframe'}
              </button>
            </div>
          )}

          {isT && thoughtOpen && (
            <div style={{ display: 'flex', gap: 8 }}>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input
                autoFocus
                className="tc-input"
                value={thoughtInput}
                onChange={e => setThoughtInput(e.target.value)}
                placeholder="Enter the automatic thought"
                onKeyDown={e => e.key === 'Enter' && submitThought()}
                style={inputStyle}
              />
              <button onClick={submitThought} style={chipBtn(VIOLET)}>Set</button>
            </div>
          )}

          {/* ---- CURRENT THOUGHT ---- */}
          <div style={{
            position: 'relative', overflow: 'hidden',
            background: '#F4F0FE', border: '1px solid #E2D8FB', borderRadius: 18,
            padding: '14px 18px 18px', minHeight: 92,
          }}>
            <Sparkle size={26} top={44} right={26} opacity={0.55} />
            <Sparkle size={14} top={20} right={64} opacity={0.45} />
            <Sparkle size={11} top={72} right={92} opacity={0.32} />
            <Sparkle size={12} top={80} right={40} opacity={0.28} />

            <div style={microLabel(VIOLET)}>Current thought</div>
            <div style={{
              position: 'relative',
              fontFamily: '"DM Serif Display", Georgia, serif', fontStyle: 'italic', fontWeight: 700,
              fontSize: 28, lineHeight: 1.3,
              color: thought ? VIOLET_DEEP : '#8B7CC0',
              wordBreak: 'break-word',
            }}>
              {thought ? `“${thought}”` : (isT ? 'Set a thought to begin…' : 'Waiting for therapist…')}
            </div>

            {/* Belief BEFORE the work. Captured here rather than as a fifth step
                so the flow is untouched, and so the closing summary can report a
                change instead of a lone number. */}
            {thought && !completed && (
              <div style={{ position: 'relative', marginTop: 16, paddingTop: 13, borderTop: '1px solid #E2D8FB' }}>
                <div style={{ ...microLabel(VIOLET), marginBottom: 7 }}>
                  How much do you believe it right now?
                </div>
                <BeliefScale
                  value={beliefBefore}
                  accent={VIOLET}
                  disabled={!canInteract}
                  onPick={n => setBelief('before', n)}
                />
              </div>
            )}
          </div>

          {/* ---- Balanced reframe (only once generated) ---- */}
          {reframe && !completed && (
            <div style={{
              background: '#F2FCF5', border: '1px solid #CBEFD8', borderRadius: 16, padding: '14px 18px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ ...microLabel(GREEN), marginBottom: 0 }}>Balanced reframe</div>
                {isT && !editingReframe && (
                  <button
                    onClick={startEditReframe}
                    style={{
                      marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '5px 12px', borderRadius: 9, border: '1px solid #BBE8CC',
                      background: '#ffffff', color: GREEN, fontSize: 14.5, fontWeight: 700,
                      fontFamily: '"DM Sans", sans-serif', cursor: 'pointer',
                    }}
                  >
                    <Pencil size={14} strokeWidth={2.6} /> Edit
                  </button>
                )}
              </div>

              {editingReframe ? (
                <>
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <textarea
                    autoFocus
                    className="tc-input"
                    value={reframeDraft}
                    onChange={e => setReframeDraft(e.target.value)}
                    rows={3}
                    style={{
                      ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.45,
                      fontFamily: '"DM Sans", sans-serif',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button onClick={saveReframeEdit} disabled={!reframeDraft.trim()}
                      style={{ ...chipBtn(GREEN), opacity: reframeDraft.trim() ? 1 : 0.45 }}>
                      Save reframe
                    </button>
                    <button onClick={() => setEditingReframe(false)}
                      style={{ ...ghostBtn, borderColor: HAIRLINE, color: INK_SOFT }}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div style={{
                  fontFamily: '"DM Serif Display", Georgia, serif', fontStyle: 'italic',
                  fontSize: 18.5, lineHeight: 1.45, color: '#14532D',
                }}>
                  {reframe}
                </div>
              )}

              {/* Belief AFTER the reframe. */}
              {!editingReframe && (
                <div style={{ marginTop: 16, paddingTop: 13, borderTop: '1px solid #CBEFD8' }}>
                  <div style={{ ...microLabel(GREEN), marginBottom: 7 }}>
                    How much do you believe the thought now?
                  </div>
                  <BeliefScale
                    value={beliefAfter}
                    accent={GREEN}
                    disabled={!canInteract}
                    onPick={n => setBelief('after', n)}
                  />
                </div>
              )}

              {/* Button hierarchy: completing is the primary act, saving notes a
                  secondary one, so they are no longer two identical ghosts. */}
              {isT && !editingReframe && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, flexWrap: 'wrap' }}>
                  <button
                    onClick={completeActivity}
                    disabled={!readyToComplete}
                    title={readyToComplete ? undefined : 'Rate your belief before and after to finish'}
                    style={{
                      ...solidBtn(GREEN, 'rgba(22,163,74,0.28)'),
                      padding: '11px 22px',
                      opacity: readyToComplete ? 1 : 0.45,
                      cursor: readyToComplete ? 'pointer' : 'default',
                    }}
                  >
                    <Check size={18} strokeWidth={3} color="#ffffff" />
                    Complete Activity
                  </button>
                  <button onClick={saveNotes} style={{ ...ghostBtn, borderColor: '#BBE8CC', color: GREEN }}>
                    {saved ? 'Saved ✓' : 'Save to session notes'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ---- Completed: the closing summary ---- */}
          {completed && (
            <div style={{
              background: '#F2FCF5', border: '1.5px solid #A7E3BE', borderRadius: 16,
              padding: '16px 18px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', background: GREEN,
                }}>
                  <Check size={17} strokeWidth={3.2} color="#ffffff" />
                </span>
                <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.2, color: '#14532D' }}>
                  Activity complete
                </span>
                {isT && (
                  <button onClick={reopenActivity}
                    style={{
                      marginLeft: 'auto', padding: '5px 12px', borderRadius: 9,
                      border: `1px solid ${HAIRLINE}`, background: '#ffffff', color: INK_SOFT,
                      fontSize: 14, fontWeight: 700, fontFamily: '"DM Sans", sans-serif', cursor: 'pointer',
                    }}
                  >Reopen</button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div>
                  <div style={{ ...microLabel(INK_FAINT), marginBottom: 5 }}>Original thought</div>
                  <div style={{
                    fontFamily: '"DM Serif Display", Georgia, serif', fontStyle: 'italic',
                    fontSize: 17.5, lineHeight: 1.4, color: VIOLET_DEEP, wordBreak: 'break-word',
                  }}>{thought ? `“${thought}”` : '—'}</div>
                </div>

                <div>
                  <div style={{ ...microLabel(INK_FAINT), marginBottom: 6 }}>Evidence gathered</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      { n: forCount, label: 'For', accent: GREEN, tint: '#F2FCF5', border: '#CBEFD8' },
                      { n: againstCount, label: 'Against', accent: BLUE, tint: '#F1F6FE', border: '#CFE0FB' },
                      { n: unclearCount, label: 'Unclear', accent: VIOLET_BRIGHT, tint: '#F7F3FE', border: '#DFD3FB' },
                    ].map(b => (
                      <span key={b.label} style={{
                        display: 'inline-flex', alignItems: 'baseline', gap: 6,
                        padding: '6px 13px', borderRadius: 999,
                        background: b.tint, border: `1px solid ${b.border}`,
                      }}>
                        <span style={{ fontSize: 19, fontWeight: 800, color: b.accent, fontVariantNumeric: 'tabular-nums' }}>{b.n}</span>
                        <span style={{ fontSize: 15, fontWeight: 600, color: INK_SOFT }}>{b.label}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ ...microLabel(INK_FAINT), marginBottom: 5 }}>Balanced reframe</div>
                  <div style={{
                    fontFamily: '"DM Serif Display", Georgia, serif', fontStyle: 'italic',
                    fontSize: 17.5, lineHeight: 1.45, color: '#14532D',
                  }}>{reframe || '—'}</div>
                </div>

                <div>
                  <div style={{ ...microLabel(INK_FAINT), marginBottom: 6 }}>Belief in the thought</div>
                  {beliefBefore != null && beliefAfter != null ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 26, fontWeight: 800, color: VIOLET, fontVariantNumeric: 'tabular-nums' }}>
                        {beliefBefore}
                      </span>
                      <ArrowRight size={19} strokeWidth={2.6} color={INK_FAINT} />
                      <span style={{ fontSize: 26, fontWeight: 800, color: GREEN, fontVariantNumeric: 'tabular-nums' }}>
                        {beliefAfter}
                      </span>
                      <span style={{ fontSize: 15.5, fontWeight: 600, color: INK_SOFT }}>out of 10</span>
                      {/* The delta is the point of the exercise, so it is stated
                          rather than left for the reader to subtract. */}
                      {beliefAfter !== beliefBefore && (
                        <span style={{
                          padding: '4px 11px', borderRadius: 999,
                          background: beliefAfter < beliefBefore ? '#F2FCF5' : '#FEF6DF',
                          border: `1px solid ${beliefAfter < beliefBefore ? '#CBEFD8' : '#FBE3A6'}`,
                          color: beliefAfter < beliefBefore ? GREEN : '#B45309',
                          fontSize: 14.5, fontWeight: 800,
                        }}>
                          {beliefAfter < beliefBefore ? '↓' : '↑'} {Math.abs(beliefBefore - beliefAfter)} point{Math.abs(beliefBefore - beliefAfter) === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 15.5, fontWeight: 500, color: INK_FAINT }}>Not rated</div>
                  )}
                </div>

                {/* The closing word. The summary above is the record; this is
                    what the child takes away from it. Derived from synced state,
                    so both screens show the same sentence. */}
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 11,
                  padding: '13px 15px', borderRadius: 14,
                  background: '#ffffff', border: '1px solid #CBEFD8',
                  boxShadow: '0 2px 8px rgba(22,163,74,0.08)',
                }}>
                  <Lightbulb size={20} color="#D97706" fill="#FCD34D" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ ...microLabel(GREEN), marginBottom: 4 }}>What you discovered</div>
                    <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.5, color: '#14532D' }}>
                      {closingComment(thought, againstCount, beliefBefore, beliefAfter)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ---- RIGHT: How to Play ---- */}
        <div style={{
          width: 340, flexShrink: 0,
          background: '#ffffff', border: `1px solid ${HAIRLINE}`, borderRadius: 18,
          padding: '14px 16px 16px', boxShadow: '0 4px 14px rgba(20,30,40,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{
              width: 30, height: 30, borderRadius: 10, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#FEF6DF', border: '1px solid #FBE3A6',
            }}>
              <Lightbulb size={16} color="#D97706" fill="#FCD34D" />
            </span>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.2, color: INK }}>How to Play</span>
          </div>

          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {STEPS.map((s, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{
                  width: 21, height: 21, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: VIOLET, color: '#ffffff', fontSize: 14, fontWeight: 700,
                }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 16.5, lineHeight: 1.45, fontWeight: 500, color: '#334155' }}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* ============ EVIDENCE STRIP ============ */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOverBin('pool') }}
        onDrop={() => { if (dragId) moveCard(dragId, 'pool'); setDragId(null); setDragOverBin(null) }}
        style={{
          flexShrink: 0,
          background: '#ffffff',
          border: `1px solid ${dragOverBin === 'pool' ? '#C4B5FD' : HAIRLINE}`,
          borderRadius: 18, padding: '12px 14px 10px',
          boxShadow: dragOverBin === 'pool' ? '0 0 0 3px rgba(124,58,237,0.10)' : '0 3px 12px rgba(20,30,40,0.04)',
          transition: 'box-shadow .15s, border-color .15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          {isT ? (
            <button onClick={() => setEvidenceOpen(o => !o)} style={solidBtn(BLUE, 'rgba(37,99,235,0.26)')}>
              <Plus size={17} strokeWidth={2.8} color="#ffffff" />
              Add Evidence
            </button>
          ) : (
            <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: 1.3, textTransform: 'uppercase', color: INK_FAINT }}>
              Evidence cards
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#64748B' }}>
              Add as many evidence cards as you can!
            </span>
            <CurlyArrow />
          </div>
        </div>

        {isT && evidenceOpen && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              className="tc-input"
              value={cardInput}
              onChange={e => setCardInput(e.target.value)}
              placeholder="Add evidence card"
              onKeyDown={e => e.key === 'Enter' && addCard()}
              style={inputStyle}
            />
            <button onClick={addCard} style={chipBtn(BLUE)}>Add</button>
          </div>
        )}

        <div className="tc-scroll-x" style={{
          display: 'flex', gap: 10, alignItems: 'stretch',
          overflowX: 'auto', overflowY: 'hidden', paddingBottom: 6, minHeight: 62,
        }}>
          {pool.length === 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', fontSize: 16, fontWeight: 500, color: INK_FAINT, paddingLeft: 2,
            }}>
              {isT ? 'No evidence cards yet — add one to get started.' : 'No evidence cards yet.'}
            </div>
          )}
          {pool.map(c => (
            <EvidenceCard
              key={c.id}
              card={c}
              canInteract={canInteract}
              isT={isT}
              shake={shakeId === c.id}
              bounce={bounceId === c.id}
              onDragStart={() => setDragId(c.id)}
              onFlag={() => flagCard(c.id)}
            />
          ))}
        </div>
      </div>

      {/* ============ THREE DROP ZONES ============ */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12 }}>
        {BINS.map(bin => {
          const binCards = cards.filter(c => c.bin === bin.id)
          const active = dragOverBin === bin.id
          return (
            <div
              key={bin.id}
              onDragOver={e => { e.preventDefault(); setDragOverBin(bin.id) }}
              onDragLeave={() => setDragOverBin(null)}
              onDrop={() => { if (dragId) moveCard(dragId, bin.id); setDragId(null); setDragOverBin(null) }}
              style={{
                flex: 1, minWidth: 0, minHeight: 0,
                display: 'flex', flexDirection: 'column', gap: 10,
                padding: '12px 13px 13px', borderRadius: 18,
                background: bin.tint,
                border: `1px solid ${active ? bin.accent : bin.border}`,
                boxShadow: active ? `0 0 0 3px ${bin.tint}, 0 6px 18px rgba(20,30,40,0.08)` : '0 2px 10px rgba(20,30,40,0.03)',
                transition: 'border-color .15s, box-shadow .15s',
              }}
            >
              {/* Zone header: badge · label + sub · count pill */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: bin.accent, boxShadow: `0 3px 8px ${bin.accent}33`,
                }}>
                  <BinIcon id={bin.id} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 18, fontWeight: 800, letterSpacing: -0.2, lineHeight: 1.2,
                    color: bin.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {bin.label}
                  </div>
                  <div style={{
                    fontSize: 15.5, fontWeight: 500, color: '#64748B', marginTop: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {bin.sub}
                  </div>
                </div>
                <span style={{
                  minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: bin.accent, color: '#ffffff', fontSize: 15.5, fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {binCards.length}
                </span>
              </div>

              {/* Dashed drop area — the only scrolling surface in the zone */}
              <div className="tc-scroll-y" style={{
                flex: 1, minHeight: 64, overflowY: 'auto', overflowX: 'hidden',
                border: `2px dashed ${active ? bin.accent : bin.dash}`,
                borderRadius: 14, padding: 10,
                background: active ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)',
                display: 'flex', flexDirection: 'column',
                gap: 7,
                alignItems: binCards.length ? 'stretch' : 'center',
                justifyContent: binCards.length ? 'flex-start' : 'center',
                transition: 'border-color .15s, background .15s',
              }}>
                {binCards.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, pointerEvents: 'none' }}>
                    <ArrowDown size={19} strokeWidth={2.4} color={bin.accent} />
                    <span style={{ fontSize: 17, fontWeight: 700, color: bin.accent }}>Drag and Drop</span>
                  </div>
                ) : (
                  binCards.map(c => (
                    <EvidenceCard
                      key={c.id}
                      card={c}
                      canInteract={canInteract}
                      isT={isT}
                      shake={shakeId === c.id}
                      bounce={bounceId === c.id}
                      onDragStart={() => setDragId(c.id)}
                      onFlag={() => flagCard(c.id)}
                      borderColor={bin.cardBorder}
                      compact
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ===========================================================================
   Pieces
=========================================================================== */

/** Violet brain-in-a-speech-bubble mark from the mockup. Pure inline SVG. */
function BrainBubble() {
  return (
    <svg width={46} height={46} viewBox="0 0 48 48" fill="none" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      <path
        d="M11 5.5h26a6.5 6.5 0 0 1 6.5 6.5v15a6.5 6.5 0 0 1-6.5 6.5H20.5l-8.5 8v-8H11A6.5 6.5 0 0 1 4.5 27V12A6.5 6.5 0 0 1 11 5.5Z"
        fill="#F4F0FE" stroke={VIOLET_BRIGHT} strokeWidth={2.1} strokeLinejoin="round"
      />
      <path d="M24 13.6v14.2" stroke={VIOLET_BRIGHT} strokeWidth={1.7} strokeLinecap="round" />
      <path
        d="M24 14.4c-1.5-2.3-5.9-2.1-7.1.6-2.5.2-3.5 2.9-2.1 4.5-1.3 1.9.1 4.5 2.3 4.7.5 2.5 4 3.3 5.8 1.5"
        stroke={VIOLET_BRIGHT} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
      <path
        d="M24 14.4c1.5-2.3 5.9-2.1 7.1.6 2.5.2 3.5 2.9 2.1 4.5 1.3 1.9-.1 4.5-2.3 4.7-.5 2.5-4 3.3-5.8 1.5"
        stroke={VIOLET_BRIGHT} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
      <path d="M19.4 19.6h2.7M25.9 19.6h2.7" stroke={VIOLET_BRIGHT} strokeWidth={1.4} strokeLinecap="round" opacity={0.65} />
    </svg>
  )
}

/** Four-point sparkle motif for the current-thought card. */
function Sparkle({ size, top, right, opacity }: { size: number; top: number; right: number; opacity: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden
      style={{ position: 'absolute', top, right, pointerEvents: 'none' }}
    >
      <path
        d="M12 1.4c1.05 6.35 3.2 8.5 9.55 9.55-6.35 1.05-8.5 3.2-9.55 9.55-1.05-6.35-3.2-8.5-9.55-9.55C8.8 9.9 10.95 7.75 12 1.4Z"
        fill="#A78BFA" opacity={opacity}
      />
    </svg>
  )
}

/** The little hand-drawn arrow that points at the evidence hint in the mockup. */
function CurlyArrow() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      <path d="M4 4c7.5-.5 13 3 14.5 10" stroke="#94A3B8" strokeWidth={1.6} strokeLinecap="round" fill="none" />
      <path d="M14.5 12.2 18.8 14.6 20 9.9" stroke="#94A3B8" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function BinIcon({ id }: { id: Exclude<Bin, 'pool'> }) {
  if (id === 'for') return <Shield size={17} color="#ffffff" fill="#ffffff" />
  if (id === 'against') return <Scale size={18} color="#ffffff" strokeWidth={2.1} />
  return (
    <span style={{
      width: 19, height: 19, borderRadius: '50%', border: '1.8px solid #ffffff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#ffffff', fontSize: 16, fontWeight: 800, lineHeight: 1,
    }}>
      ?
    </span>
  )
}

/** Six-dot grab handle. */
function DragDots() {
  return (
    <svg width={10} height={16} viewBox="0 0 10 16" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      {[3, 8, 13].map(y => (
        <g key={y}>
          <circle cx={2.5} cy={y} r={1.4} fill="#B7BECC" />
          <circle cx={7.5} cy={y} r={1.4} fill="#B7BECC" />
        </g>
      ))}
    </svg>
  )
}

function EvidenceCard({ card, canInteract, isT, shake, bounce, onDragStart, onFlag, borderColor, compact }: {
  card: Card
  canInteract: boolean
  isT: boolean
  shake: boolean
  bounce: boolean
  onDragStart: () => void
  onFlag: () => void
  borderColor?: string
  compact?: boolean
}) {
  // The magnifier is the mockup's "examine" affordance. For a therapist looking
  // at an already-categorised card it triggers the existing flag-back-to-pool
  // action (the same one double-click has always fired); elsewhere it is a
  // decorative mark that surfaces the full text on hover.
  const isFlagButton = isT && card.bin !== 'pool'

  return (
    <div
      draggable={canInteract}
      onDragStart={onDragStart}
      onDoubleClick={() => { if (isFlagButton) onFlag() }}
      title={isFlagButton ? 'Double-click to flag (returns to pool)' : card.text}
      style={{
        flex: compact ? '0 0 auto' : '0 0 auto',
        width: compact ? 'auto' : 202,
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#ffffff',
        border: `1px solid ${borderColor ?? HAIRLINE}`,
        borderRadius: 12,
        padding: compact ? '8px 9px' : '10px 11px',
        boxShadow: '0 2px 6px rgba(20,30,40,0.05)',
        cursor: canInteract ? 'grab' : 'default',
        userSelect: 'none',
        animation: shake ? 'tc-shake 0.45s ease' : bounce ? 'tc-bounce 0.4s ease' : 'none',
      }}
    >
      <DragDots />
      <div style={{
        flex: 1, minWidth: 0,
        fontSize: compact ? 11.5 : 12.5, fontWeight: 600, lineHeight: 1.35, color: '#1E293B',
        wordBreak: 'break-word',
      }}>
        {card.text}
      </div>
      {isFlagButton ? (
        <button
          onClick={onFlag}
          title="Return this card to the evidence strip"
          style={magnifierStyle}
        >
          <Search size={13} color={BLUE} strokeWidth={2.4} />
        </button>
      ) : (
        <span aria-hidden style={magnifierStyle}>
          <Search size={13} color={BLUE} strokeWidth={2.4} />
        </span>
      )}
    </div>
  )
}

/* ===========================================================================
   Shared styles
=========================================================================== */

const magnifierStyle: CSSProperties = {
  width: 26, height: 26, flexShrink: 0, borderRadius: 8,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#F1F6FE', border: '1px solid #DBE8FD',
  padding: 0, cursor: 'pointer',
}

const solidBtn = (bg: string, glow: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '10px 20px 10px 16px', borderRadius: 12, border: 'none',
  background: bg, color: '#ffffff', fontSize: 17.5, fontWeight: 700,
  fontFamily: '"DM Sans", sans-serif', cursor: 'pointer', whiteSpace: 'nowrap',
  boxShadow: `0 5px 14px ${glow}`,
})

const chipBtn = (bg: string): CSSProperties => ({
  padding: '9px 16px', borderRadius: 10, border: 'none',
  background: bg, color: '#ffffff', fontSize: 16.5, fontWeight: 700,
  fontFamily: '"DM Sans", sans-serif', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
})

const ghostBtn: CSSProperties = {
  padding: '9px 14px', borderRadius: 12, border: '1px solid #DDD6FE',
  background: '#ffffff', color: VIOLET, fontSize: 16.5, fontWeight: 700,
  fontFamily: '"DM Sans", sans-serif', cursor: 'pointer', whiteSpace: 'nowrap',
}

/* The small uppercase section label. It was repeated inline at three slightly
   different sizes and letter-spacings; stating it once keeps the new sections
   typographically identical to the old ones. */
const microLabel = (color: string): CSSProperties => ({
  fontSize: 13, fontWeight: 800, letterSpacing: 1.3, textTransform: 'uppercase',
  color, marginBottom: 8,
})

/** 1-10 belief rating. Ten taps, no slider — precise on a touch screen and
    readable at a glance from the other side of a video call. */
function BeliefScale({ value, accent, disabled, onPick }: {
  value: number | null
  accent: string
  disabled: boolean
  onPick: (n: number) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
        const on = value === n
        return (
          <button
            key={n}
            onClick={() => onPick(n)}
            disabled={disabled}
            aria-pressed={on}
            style={{
              width: 33, height: 33, borderRadius: 9, flexShrink: 0,
              border: `1.5px solid ${on ? accent : HAIRLINE}`,
              background: on ? accent : '#ffffff',
              color: on ? '#ffffff' : INK_SOFT,
              fontSize: 15, fontWeight: 800, fontFamily: '"DM Sans", sans-serif',
              cursor: disabled ? 'default' : 'pointer',
              transition: 'background .12s, border-color .12s, color .12s',
            }}
          >{n}</button>
        )
      })}
    </div>
  )
}

const inputStyle: CSSProperties = {
  flex: 1, minWidth: 0, background: '#ffffff', border: `1px solid ${HAIRLINE}`, borderRadius: 10,
  padding: '9px 12px', fontSize: 16.5, color: '#1E293B', outline: 'none',
  fontFamily: '"DM Sans", sans-serif', transition: 'border-color .15s, box-shadow .15s',
}
