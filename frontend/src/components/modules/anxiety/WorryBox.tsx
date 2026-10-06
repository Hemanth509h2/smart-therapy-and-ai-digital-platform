'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { doc, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { apiFetch } from '@/lib/api';

interface WorryBoxProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

interface Worry {
  id: string
  text: string
  color: string
  timestamp: number
  kept: boolean
}

const NOTE_COLORS = [
  'rgba(255,255,200,0.08)',
  'rgba(200,255,220,0.08)',
  'rgba(200,220,255,0.08)',
  'rgba(255,210,200,0.08)',
]

const MAX_CHARS = 120
const LID_DUR = 300
const NOTE_FLY_DUR = 700
const REVEAL_INTERVAL = 120
const TEAR_DUR = 500
const TOAST_DUR = 2000

export default function WorryBox({ sessionId, role, isLocked }: WorryBoxProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [worries, setWorries] = useState<Worry[]>([])
  const [reviewMode, setReviewMode] = useState(false)
  const [guidedMode, setGuidedMode] = useState(false)
  const [anonymous, setAnonymous] = useState(false)

  const [text, setText] = useState('')
  const [showInput, setShowInput] = useState(true)
  const [lidOpen, setLidOpen] = useState(false)
  const [lidAnim, setLidAnim] = useState(false)
  const [flyingNote, setFlyingNote] = useState<{ text: string; color: string; top: number; left: number; width: number } | null>(null)
  const [revealed, setRevealed] = useState(0)
  const [tearing, setTearing] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ msg: string } | null>(null)
  const [enteringReview, setEnteringReview] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const cRef = useRef<HTMLDivElement>(null)
  const toastT = useRef<ReturnType<typeof setTimeout>>()
  const tmr = useRef<ReturnType<typeof setTimeout>>()
  const worriesRef = useRef(worries)
  worriesRef.current = worries

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (Array.isArray(s.wbWorries)) setWorries(s.wbWorries)
      if (typeof s.wbReviewMode === 'boolean') setReviewMode(s.wbReviewMode)
      if (typeof s.wbGuidedMode === 'boolean') setGuidedMode(s.wbGuidedMode)
      if (typeof s.wbAnonymous === 'boolean') setAnonymous(s.wbAnonymous)
    })
    return () => unsub()
  }, [sessionId])

  const inputVisible = isT ? guidedMode : !guidedMode

  useEffect(() => {
    if (worries.length === 0 && !reviewMode) setShowInput(true)
  }, [worries.length, reviewMode])

  useEffect(() => {
    if (!reviewMode) { setLidOpen(false); setRevealed(0); setEnteringReview(false); return }
    setEnteringReview(true)
    setLidAnim(true)
    tmr.current = setTimeout(() => setLidAnim(false), LID_DUR)
    setLidOpen(true)
    const iv = setInterval(() => {
      setRevealed(prev => { if (prev >= worries.length) { clearInterval(iv); return prev }; return prev + 1 })
    }, REVEAL_INTERVAL)
    return () => { clearInterval(iv); if (tmr.current) clearTimeout(tmr.current) }
  }, [reviewMode, worries.length])

  useEffect(() => () => { if (toastT.current) clearTimeout(toastT.current); if (tmr.current) clearTimeout(tmr.current) }, [])

  const showToast = useCallback((msg: string) => {
    setToast({ msg })
    if (toastT.current) clearTimeout(toastT.current)
    toastT.current = setTimeout(() => setToast(null), TOAST_DUR)
  }, [])

  const addWorry = useCallback(() => {
    const t = text.trim()
    if (!t || !canInteract) return
    if (!inputVisible) return

    const el = inputRef.current
    const ce = cRef.current
    if (el && ce) {
      const er = el.getBoundingClientRect()
      const cr = ce.getBoundingClientRect()
      const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]
      setFlyingNote({ text: t, color, top: er.top - cr.top, left: er.left - cr.left, width: er.width })
      setText('')

      let didFire = false
      setTimeout(() => {
        if (didFire) return; didFire = true
        setFlyingNote(null)
        const worry: Worry = { id: `w${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: t, color, timestamp: Date.now(), kept: false }
        write({ 'moduleState.wbWorries': arrayUnion(worry) })
        logModuleEvent(sessionId, {
          module: 'worry-box',
          type: 'worry_added',
          detail: anonymous ? 'Added a worry to the Worry Box' : `Added a worry: "${t}"`,
        })
        setLidAnim(true)
        setTimeout(() => setLidAnim(false), LID_DUR)
        setShowInput(false)
      }, NOTE_FLY_DUR)
    }
  }, [text, canInteract, inputVisible, write, sessionId, anonymous])

  const toggleKept = useCallback((id: string) => {
    if (!isT) return
    const updated = worries.map(w => w.id === id ? { ...w, kept: !w.kept } : w)
    write({ 'moduleState.wbWorries': updated })
  }, [worries, isT, write])

  const tearUp = useCallback((id: string, text: string) => {
    if (!isT) return
    setTearing(prev => new Set(prev).add(id))
    setTimeout(() => {
      setTearing(prev => { const n = new Set(prev); n.delete(id); return n })
      const updated = worriesRef.current.filter(w => w.id !== id)
      write({ 'moduleState.wbWorries': updated })
      logModuleEvent(sessionId, {
        module: 'worry-box',
        type: 'worry_released',
        detail: anonymous ? 'Released (let go of) a worry' : `Let go of the worry: "${text}"`,
      })
      showToast(`"${text.length > 20 ? text.slice(0, 20) + '…' : text}" released 🌬️`)
    }, TEAR_DUR)
  }, [isT, write, showToast, sessionId, anonymous])

  const clearAll = useCallback(() => {
    if (!isT) return
    if (window.confirm('Remove all worries from the box?')) {
      write({ 'moduleState.wbWorries': [] })
      setShowInput(true)
    }
  }, [isT, write])

  const closeBox = useCallback(() => {
    if (!isT) return
    setLidOpen(false)
    setLidAnim(true)
    setTimeout(() => {
      setLidAnim(false)
      write({ 'moduleState.wbReviewMode': false })
    }, LID_DUR)
  }, [isT, write])

  const openBox = useCallback(() => {
    if (!isT) return
    write({ 'moduleState.wbReviewMode': true })
  }, [isT, write])

  const saveSessionNotes = useCallback(async () => {
    if (!isT) return
    const kept = worries.filter(w => w.kept)
    try {
      await apiFetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, type: 'worry-box', worries: kept.map(w => ({ text: w.text, kept: w.kept, timestamp: w.timestamp })) }),
      })
      showToast('Saved to session notes')
    } catch { showToast('Could not save notes') }
  }, [isT, worries, sessionId, showToast])

  const goAddWorry = useCallback(() => {
    if (guidedMode && !isT) return
    setShowInput(true)
  }, [guidedMode, isT])

  const canAdd = inputVisible && text.trim().length > 0 && text.length <= MAX_CHARS && canInteract
  const displayText = (w: Worry) => anonymous && isT ? '••••••' : w.text

  const showViewA = !reviewMode && (showInput || worries.length === 0)
  const showViewB = !reviewMode && !showInput && worries.length > 0
  const showViewC = reviewMode

  return (
    <>
      <style>{`
        @keyframes ntb {
          0%{transform:translate(0,0)scale(1)rotate(0deg);opacity:1}
          60%{transform:translate(0,120px)scale(.85)rotate(-5deg);opacity:1}
          100%{transform:translate(0,160px)scale(.3)rotate(10deg);opacity:0}
        }
        @keyframes nr {
          0%{transform:translateY(-20px);opacity:0}
          100%{transform:translateY(0);opacity:1}
        }
        @keyframes tu {
          0%{transform:scale(1);opacity:1}
          30%{transform:scale(1.05)rotate(2deg)}
          60%{transform:scale(.8)rotate(-5deg);opacity:.6}
          100%{transform:scale(0)rotate(10deg);opacity:0}
        }
        @keyframes breathing {
          0%,100%{transform:scale(1);opacity:.6}
          50%{transform:scale(1.15);opacity:1}
        }
      `}</style>

      {/* Therapist controls strip */}
      {isT && (
        <div style={{ flexShrink: 0, padding: '6px 12px', borderBottom: '1px solid var(--glass-border)', display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
            <input type="checkbox" checked={guidedMode} onChange={e => write({ 'moduleState.wbGuidedMode': e.target.checked })} style={{ accentColor: '#4a7c6f' }} />
            Guided
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
            <input type="checkbox" checked={anonymous} onChange={e => write({ 'moduleState.wbAnonymous': e.target.checked })} style={{ accentColor: '#4a7c6f' }} />
            Anonymous
          </label>
          <button onClick={clearAll}
            style={{ marginLeft: 'auto', padding: '3px 8px', borderRadius: 4, border: '1px solid rgba(200,60,60,0.3)', background: 'transparent', color: 'rgba(200,80,80,0.7)', cursor: 'pointer', fontSize: 13 }}
          >Clear all</button>
        </div>
      )}

      {/* Canvas */}
      <div ref={cRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column', padding: 16 }}>

        {/* VIEW A — Input */}
        {showViewA && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 12 }}>
            <div style={{ fontSize: 19.5, fontFamily: '"DM Serif Display", serif', fontStyle: 'italic', color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: 4 }}>
              {guidedMode && isT ? 'What is your child worried about?' : "What's worrying you right now?"}
            </div>
            {inputVisible && (
              <>
                <div style={{ position: 'relative' }}>
                  <textarea ref={inputRef} value={text} onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
                    placeholder="I&apos;m worried about..."
                    maxLength={MAX_CHARS}
                    style={{
                      width: '100%', minHeight: 80, background: 'rgba(255,255,240,0.07)',
                      border: '1.5px solid rgba(255,255,200,0.2)', borderRadius: 10,
                      padding: '12px 14px', fontFamily: '"DM Sans", sans-serif', fontSize: 16.5,
                      color: 'rgba(255,255,255,0.85)', resize: 'none', outline: 'none',
                    }}
                    onFocus={e => { e.target.style.borderColor = 'rgba(255,255,200,0.4)' }}
                    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,200,0.2)' }}
                  />
                  <div style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>
                    {text.length}/{MAX_CHARS}
                  </div>
                </div>
                <button onClick={addWorry}
                  disabled={!canAdd}
                  style={{
                    padding: '10px 0', borderRadius: 8, width: '100%', fontSize: 16.5, cursor: canAdd ? 'pointer' : 'default',
                    background: canAdd ? 'rgba(74,124,111,0.3)' : 'rgba(255,255,255,0.04)',
                    border: canAdd ? '1px solid rgba(74,124,111,0.4)' : '1px solid rgba(255,255,255,0.08)',
                    color: canAdd ? '#b8d4ce' : 'rgba(255,255,255,0.25)',
                    opacity: canAdd ? 1 : 0.4,
                  }}
                >Put it in the box →</button>
              </>
            )}
            {!inputVisible && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'rgba(255,255,255,0.3)', fontSize: 16.5 }}>
                {isT ? 'Waiting for client input...' : 'Waiting for therapist...'}
              </div>
            )}

            {/* Box illustration */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 'auto', paddingBottom: 10 }}>
              <div style={{ perspective: 400 }}>
                <div style={{ position: 'relative', width: 100, height: 80, background: 'linear-gradient(135deg,rgba(200,96,42,0.4) 0%,rgba(150,60,20,0.5) 100%)', border: '2px solid rgba(200,96,42,0.6)', borderRadius: '8px 8px 12px 12px' }}>
                  <div style={{
                    width: 110, height: 28,
                    background: 'linear-gradient(135deg,rgba(220,110,50,0.5) 0%,rgba(170,70,30,0.6) 100%)',
                    border: '2px solid rgba(200,96,42,0.7)', borderRadius: 6,
                    position: 'absolute', top: -28, left: -5,
                    transformOrigin: 'bottom center',
                    transformStyle: 'preserve-3d',
                    transition: 'transform 0.3s ease',
                    transform: lidAnim ? 'rotateX(-60deg)' : 'rotateX(0deg)',
                  }} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19.5 }}>
                    {worries.length > 0 ? '🔒' : '🗃️'}
                  </div>
                  {worries.length > 0 && (
                    <div style={{
                      position: 'absolute', top: -8, right: -8,
                      background: '#c8602a', color: '#fff', fontSize: 13, fontWeight: 700,
                      minWidth: 18, height: 18, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                    }}>
                      {worries.length}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Worry Box</div>
            </div>
          </div>
        )}

        {/* VIEW B — Locked */}
        {showViewB && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12 }}>
            <div style={{ perspective: 400 }}>
              <div style={{ position: 'relative', width: 140, height: 110, background: 'linear-gradient(135deg,rgba(200,96,42,0.4) 0%,rgba(150,60,20,0.5) 100%)', border: '2px solid rgba(200,96,42,0.6)', borderRadius: '8px 8px 12px 12px' }}>
                <div style={{
                  width: 152, height: 34,
                  background: 'linear-gradient(135deg,rgba(220,110,50,0.5) 0%,rgba(170,70,30,0.6) 100%)',
                  border: '2px solid rgba(200,96,42,0.7)', borderRadius: 6,
                  position: 'absolute', top: -34, left: -6,
                  transformOrigin: 'bottom center',
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.3s ease',
                  transform: lidOpen ? 'rotateX(-60deg)' : 'rotateX(0deg)',
                }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🔒</div>
                <div style={{
                  position: 'absolute', top: -10, right: -10,
                  background: '#c8602a', color: '#fff', fontSize: 16.5, fontWeight: 700,
                  minWidth: 24, height: 24, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px',
                }}>
                  {worries.length}
                </div>
              </div>
            </div>
            <div style={{ fontStyle: 'italic', fontSize: 16.5, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
              Your worries are safely locked away
            </div>
            <button onClick={goAddWorry}
              style={{ padding: '8px 24px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 16 }}
            >Add another worry</button>
            {isT && (
              <button onClick={openBox}
                style={{ padding: '8px 24px', borderRadius: 8, border: '1px solid rgba(74,124,111,0.3)', background: 'rgba(74,124,111,0.2)', color: '#b8d4ce', cursor: 'pointer', fontSize: 16 }}
              >Open box</button>
            )}
          </div>
        )}

        {/* VIEW C — Review */}
        {showViewC && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8, overflow: 'hidden' }}>
            <div style={{ fontSize: 18.5, fontFamily: '"DM Serif Display", serif', color: 'rgba(255,255,255,0.85)', textAlign: 'center' }}>
              📬 Opening the Worry Box together
            </div>

            {/* Box open animation */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
              <div style={{ perspective: 400 }}>
                <div style={{ position: 'relative', width: 100, height: 80, background: 'linear-gradient(135deg,rgba(200,96,42,0.4) 0%,rgba(150,60,20,0.5) 100%)', border: '2px solid rgba(200,96,42,0.6)', borderRadius: '8px 8px 12px 12px' }}>
                  <div style={{
                    width: 110, height: 28,
                    background: 'linear-gradient(135deg,rgba(220,110,50,0.5) 0%,rgba(170,70,30,0.6) 100%)',
                    border: '2px solid rgba(200,96,42,0.7)', borderRadius: 6,
                    position: 'absolute', top: -28, left: -5,
                    transformOrigin: 'bottom center', transformStyle: 'preserve-3d',
                    transition: 'transform 0.3s ease',
                    transform: lidOpen ? 'rotateX(-60deg)' : 'rotateX(0deg)',
                  }} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19.5 }}>📬</div>
                </div>
              </div>
            </div>

            {/* Worry list */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
              {worries.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
                  <div style={{ fontSize: 19.5, fontFamily: '"DM Serif Display", serif', color: 'rgba(255,255,255,0.8)' }}>✨ All worries released!</div>
                  <div style={{ width: 60, height: 60, borderRadius: '50%', border: '2px solid rgba(74,124,111,0.4)', animation: 'breathing 4s ease-in-out infinite' }} />
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>Well done for facing your worries today</div>
                </div>
              )}
              {worries.map((w, i) => {
                const isTearing = tearing.has(w.id)
                return (
                  <div key={w.id}
                    style={{
                      background: w.color, border: '1px solid rgba(255,255,200,0.15)', borderRadius: 8,
                      padding: '10px 14px', marginBottom: 8, fontSize: 16, color: 'rgba(255,255,255,0.8)',
                      position: 'relative',
                      animation: enteringReview ? `nr 0.3s ease forwards ${i * REVEAL_INTERVAL}ms` : 'none',
                      opacity: enteringReview ? 0 : 1,
                      transform: isTearing ? undefined : 'none',
                      transition: isTearing ? 'none' : undefined,
                      ...(isTearing ? { animation: `tu ${TEAR_DUR}ms ease forwards` } : {}),
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, wordBreak: 'break-word' }}>
                        {w.kept && <span style={{ marginRight: 4 }}>📌</span>}
                        {displayText(w)}
                      </div>
                      {isT && (
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <button onClick={() => toggleKept(w.id)}
                            style={{
                              padding: '4px 8px', borderRadius: 4, fontSize: 13, cursor: 'pointer',
                              background: 'rgba(74,124,111,0.2)', border: '1px solid rgba(74,124,111,0.3)', color: '#b8d4ce',
                            }}
                          >{w.kept ? '📌 Kept' : 'Keep 📌'}</button>
                          <button onClick={() => tearUp(w.id, w.text)}
                            style={{
                              padding: '4px 8px', borderRadius: 4, fontSize: 13, cursor: 'pointer',
                              background: 'rgba(200,60,60,0.15)', border: '1px solid rgba(200,60,60,0.25)', color: 'rgba(200,80,80,0.8)',
                            }}
                          >Let go 🌬️</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, paddingTop: 8, borderTop: '1px solid var(--glass-border)' }}>
              {isT && (
                <>
                  <button onClick={closeBox}
                    style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 14 }}
                  >Close box</button>
                  <button onClick={saveSessionNotes}
                    style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid rgba(74,124,111,0.3)', background: 'rgba(74,124,111,0.15)', color: '#b8d4ce', cursor: 'pointer', fontSize: 14 }}
                  >End session summary</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Flying note */}
        {flyingNote && (
          <div style={{
            position: 'absolute', top: flyingNote.top, left: flyingNote.left, width: flyingNote.width,
            background: flyingNote.color, border: '1px solid rgba(255,255,200,0.25)', borderRadius: 8,
            padding: '10px 12px', fontSize: 16, color: 'rgba(255,255,255,0.8)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 30, pointerEvents: 'none',
            animation: 'ntb 0.7s ease-in forwards',
          }}>
            {flyingNote.text}
          </div>
        )}
      </div>

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
