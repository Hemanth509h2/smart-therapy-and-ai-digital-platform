'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import {
  ChartColumnIncreasing, CalendarDays, Plus, Leaf, Flag, Rocket, Pointer,
  EllipsisVertical, Check, Trash2, Target, GlassWater, FileText, Phone,
  BookOpen, ListChecks, Footprints, Sparkles,
} from 'lucide-react'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'

interface MicroQuestBoardProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type Effort = 'Easy' | 'Medium' | 'Hard'
interface Quest {
  id: string
  text: string
  effort: Effort
  completed: boolean
  completedAt: number | null
  therapistNote: string
}

/* ---------------------------------------------------------------------------
   Palette. This module renders on ModuleStage's WHITE canvas, so every colour
   below is stated literally and chosen for dark-on-light contrast. The shared
   `--ink-*` CSS vars are authored for the dark sidebar panel and are NOT used
   here. White text appears on exactly one surface: the solid green button.
--------------------------------------------------------------------------- */
const INK = '#16233A'        // headings
const INK_BODY = '#1E293B'   // quest copy
const INK_MUTED = '#475569'  // helper copy (7:1 on white)
const INK_FAINT = '#64748B'  // micro-labels (4.9:1 on white)
const LINE = '#e7eaef'
const GREEN_SOLID = '#1F7A44' // primary action fill — white text only here
const GREEN_ACCENT = '#16A34A'

interface EffortSpec {
  accent: string
  tint: string
  border: string
  dash: string
  ring: string
  sub: string
  Icon: typeof Leaf
}

/* Difficulty language. The accents are the saturated trio the design calls
   for — each sits on its own pale tint, never white-on-light. */
const EFFORTS: Effort[] = ['Easy', 'Medium', 'Hard']
const EFFORT_SPEC: Record<Effort, EffortSpec> = {
  Easy: {
    accent: '#16A34A', tint: '#F0FDF4', border: '#CFEEDA', dash: 'rgba(22,163,74,0.38)',
    ring: 'rgba(22,163,74,0.16)', sub: 'Small & simple wins', Icon: Leaf,
  },
  Medium: {
    accent: '#2563EB', tint: '#EFF6FF', border: '#D5E4FB', dash: 'rgba(37,99,235,0.34)',
    ring: 'rgba(37,99,235,0.16)', sub: 'Balanced challenge', Icon: Flag,
  },
  Hard: {
    accent: '#DC2626', tint: '#FDF4FF', border: '#EFDCF6', dash: 'rgba(220,38,38,0.30)',
    ring: 'rgba(220,38,38,0.14)', sub: 'Big challenge ahead', Icon: Rocket,
  },
}

/* Each quest gets a pastel badge from this pool, picked deterministically from
   its id. Purely decorative — the difficulty is carried by the coloured label
   under the quest text, never by the badge alone. */
const BADGES: { tint: string; accent: string; Icon: typeof Target }[] = [
  { tint: '#ECFDF5', accent: '#059669', Icon: Target },
  { tint: '#EFF6FF', accent: '#2563EB', Icon: GlassWater },
  { tint: '#F5F3FF', accent: '#7C3AED', Icon: FileText },
  { tint: '#F0FDF4', accent: '#16A34A', Icon: Phone },
  { tint: '#FDF4FF', accent: '#A21CAF', Icon: BookOpen },
  { tint: '#EEF2FF', accent: '#4F46E5', Icon: ListChecks },
  { tint: '#FFF7ED', accent: '#C2410C', Icon: Footprints },
  { tint: '#F0FDFA', accent: '#0D9488', Icon: Sparkles },
]
const badgeFor = (id: string) => {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return BADGES[sum % BADGES.length]
}

export default function MicroQuestBoard({ sessionId, role, isLocked }: MicroQuestBoardProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [clientId, setClientId] = useState<string | null>(null)
  const [quests, setQuests] = useState<Quest[]>([])

  const [questText, setQuestText] = useState('')
  const [effort, setEffort] = useState<Effort>('Easy')
  const [reviewMode, setReviewMode] = useState(false)
  const [celebrate, setCelebrate] = useState<string | null>(null)

  /* Purely local view state — nothing below is persisted and no new Firestore
     field is introduced. `composerOpen` follows the disclosure convention the
     sibling modules use: the mockup shows the button alone, so the text field
     stays folded away until the therapist asks for it. */
  const [composerOpen, setComposerOpen] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<Effort | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const touchId = useRef<string | null>(null)
  const touchMoved = useRef(false)
  const touchStart = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const parts = snap.data().participants || {}
      const client = Object.values(parts).find((p: any) => p?.role === 'client') as any
      if (client?.uid) setClientId(client.uid)
    })
    return () => unsub()
  }, [sessionId])

  useEffect(() => {
    if (!clientId) return
    const unsub = onSnapshot(doc(db, 'patients', clientId), (snap) => {
      const data = snap.exists() ? snap.data() : {}
      if (Array.isArray(data.quests)) setQuests(data.quests)
    })
    return () => unsub()
  }, [clientId])

  const persist = useCallback(async (next: Quest[]) => {
    if (!clientId) return
    try { await setDoc(doc(db, 'patients', clientId), { quests: next }, { merge: true }) } catch {}
  }, [clientId])

  const addQuest = useCallback(() => {
    if (!isT || !questText.trim()) return
    const q: Quest = { id: `q${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, text: questText.trim(), effort, completed: false, completedAt: null, therapistNote: '' }
    const next = [...quests, q]
    setQuests(next); persist(next); setQuestText('')
    logModuleEvent(sessionId, {
      module: 'micro-quest-board',
      type: 'quest_assigned',
      detail: `Assigned a ${effort} micro-quest: "${q.text}"`,
    })
  }, [isT, questText, effort, quests, persist, sessionId])

  const removeQuest = useCallback((id: string) => {
    if (!isT) return
    const next = quests.filter(q => q.id !== id)
    setQuests(next); persist(next)
  }, [isT, quests, persist])

  const toggleComplete = useCallback((id: string) => {
    if (!canInteract) return
    const next = quests.map(q => q.id === id ? { ...q, completed: !q.completed, completedAt: !q.completed ? Date.now() : null } : q)
    setQuests(next); persist(next)
    const q = quests.find(x => x.id === id)
    if (q && !q.completed) {
      setCelebrate(id); setTimeout(() => setCelebrate(null), 1200)
      logModuleEvent(sessionId, {
        module: 'micro-quest-board',
        type: 'quest_completed',
        detail: `Completed the micro-quest: "${q.text}"`,
      })
    }
  }, [canInteract, quests, persist, sessionId])

  const setNote = useCallback((id: string, note: string) => {
    if (!isT) return
    const next = quests.map(q => q.id === id ? { ...q, therapistNote: note } : q)
    setQuests(next)
  }, [isT, quests])

  /* Dropping a quest onto a difficulty zone re-labels it. This writes the same
     `effort` value the composer has always written, through the same `persist`
     path — no new field, no new document. */
  const assignEffort = useCallback((id: string, next: Effort) => {
    if (!canInteract) return
    const q = quests.find(x => x.id === id)
    if (!q || q.effort === next) return
    const updated = quests.map(x => x.id === id ? { ...x, effort: next } : x)
    setQuests(updated); persist(updated)
  }, [canInteract, quests, persist])

  /* ---- Touch drag. Mouse drag rides on the HTML5 handlers below; touch has to
          be hand-rolled. A finger that never travels 8px is a TAP, so we never
          preventDefault on touchstart and never swallow the synthetic click —
          tapping a quest card still toggles it. ---- */
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const zoneAt = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest('[data-effort-zone]')?.getAttribute('data-effort-zone') as Effort | undefined

    const onMove = (e: TouchEvent) => {
      if (!touchId.current) return
      const t = e.touches[0]
      if (!touchMoved.current) {
        if (Math.hypot(t.clientX - touchStart.current.x, t.clientY - touchStart.current.y) < 8) return
        touchMoved.current = true
        setDragId(touchId.current)
      }
      e.preventDefault()
      setGhost({ x: t.clientX, y: t.clientY })
      setDragOver(zoneAt(t.clientX, t.clientY) ?? null)
    }
    const onEnd = (e: TouchEvent) => {
      const id = touchId.current
      if (id && touchMoved.current) {
        const t = e.changedTouches[0]
        const zone = zoneAt(t.clientX, t.clientY)
        if (zone) assignEffort(id, zone)
      }
      touchId.current = null
      touchMoved.current = false
      setDragId(null); setDragOver(null); setGhost(null)
    }

    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [assignEffort])

  const onTouchStart = (id: string) => (e: React.TouchEvent) => {
    if (!canInteract) return
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
    touchId.current = id
    touchMoved.current = false
  }

  /* Quests still open per difficulty. Derived straight from `quests`, so it
     re-counts on every add, delete, completion and drag-to-re-label without any
     bookkeeping of its own. Completed quests are excluded: they are no longer
     available to pick up. */
  const availableByEffort = useMemo(() => {
    const acc: Record<Effort, number> = { Easy: 0, Medium: 0, Hard: 0 }
    for (const q of quests) if (!q.completed) acc[q.effort] += 1
    return acc
  }, [quests])

  const completedCount = quests.filter(q => q.completed).length
  const momentum = quests.length ? Math.round((completedCount / quests.length) * 100) : 0
  const dragQuest = dragId ? quests.find(q => q.id === dragId) : undefined

  const submitQuest = () => { if (!questText.trim()) return; addQuest(); setComposerOpen(false) }

  return (
    /* Root fills the stage and never scrolls itself: ModuleStage's body is
       overflow:hidden and hands every module a `height:100%` box. Only the
       "Your quests" grid scrolls, inside its own region. */
    <div
      ref={rootRef}
      style={{
        height: '100%', minHeight: 0, maxWidth: '100%',
        display: 'flex', flexDirection: 'column', gap: 14,
        position: 'relative', fontFamily: '"DM Sans", sans-serif', color: INK,
      }}
    >
      <style>{`
        @keyframes mq-pop { 0%{transform:scale(1)} 45%{transform:scale(1.05)} 100%{transform:scale(1)} }
        .mq-input::placeholder { color: #98A2B3; }
        .mq-input:focus { border-color: ${GREEN_ACCENT}; box-shadow: 0 0 0 3px rgba(22,163,74,0.12); }
        .mq-scroll { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
        .mq-scroll::-webkit-scrollbar { width: 7px; }
        .mq-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; }
      `}</style>

      {/* ============ TOP: momentum sidebar · quest composer + difficulty zones ============ */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 16 }}>

        {/* ---- LEFT: the two standing facts about this board ---- */}
        <aside style={{
          width: 300, flexShrink: 0,
          background: '#ffffff', border: `1px solid ${LINE}`, borderRadius: 18,
          boxShadow: '0 2px 10px rgba(20,30,45,0.05)', overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px 15px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={badgeSquare('#F0FDF4', '#D5EFDF')}>
              <ChartColumnIncreasing size={20} color={GREEN_ACCENT} strokeWidth={2.2} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={rowTitle}>Momentum</div>
              <div style={rowSub}>Keep the streak going!</div>
              {/* The meter this module has always shown, now a hairline under
                  its own row rather than a separate block. */}
              <div style={{ marginTop: 9, height: 6, borderRadius: 4, background: '#EDF1F4', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${momentum}%`, borderRadius: 4,
                  background: `linear-gradient(90deg, ${GREEN_SOLID}, ${GREEN_ACCENT})`,
                  transition: 'width .4s ease',
                }} />
              </div>
            </div>
          </div>

          <div style={{ padding: '14px 16px 15px', borderTop: `1px solid ${LINE}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={badgeSquare('#F0FDF4', '#D5EFDF')}>
              <CalendarDays size={20} color={GREEN_ACCENT} strokeWidth={2.1} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={rowTitle}>Resets each Monday</div>
              <div style={rowSub}>Fresh start. New week. New wins.</div>
            </div>
          </div>

          {!clientId && (
            <div style={{
              padding: '10px 16px 12px', borderTop: `1px solid ${LINE}`,
              fontSize: 16, fontWeight: 600, color: INK_FAINT,
            }}>
              Waiting for the client to join…
            </div>
          )}
        </aside>

        {/* ---- RIGHT: composer + the three difficulty zones ---- */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={accentBar} />
            <span style={sectionTitle}>{isT ? 'New quest / micro-task' : 'Quest difficulty'}</span>
            <div style={{ flex: 1 }} />
            <span style={{
              padding: '4px 12px', borderRadius: 999,
              background: '#EEF4FF', border: '1px solid #DBE6FB',
              color: '#2563EB', fontSize: 16.5, fontWeight: 800,
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            }}>
              {completedCount}/{quests.length}
            </span>
          </div>

          {isT && (
            <>
              <button
                onClick={() => setComposerOpen(o => !o)}
                style={{
                  width: '100%', padding: '13px 16px', borderRadius: 12, border: 'none',
                  background: GREEN_SOLID, color: '#ffffff',
                  fontSize: 18, fontWeight: 700, fontFamily: '"DM Sans", sans-serif',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                  cursor: 'pointer', boxShadow: '0 5px 14px rgba(31,122,68,0.22)',
                }}
              >
                <Plus size={18} strokeWidth={2.8} color="#ffffff" />
                Add quest
              </button>

              {composerOpen && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <input
                    autoFocus
                    className="mq-input"
                    value={questText}
                    onChange={e => setQuestText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitQuest()}
                    placeholder={`New ${effort.toLowerCase()} quest / micro-task`}
                    style={inputStyle}
                  />
                  <button onClick={submitQuest} style={chipBtn}>Add</button>
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', gap: 14 }}>
            {EFFORTS.map(key => {
              const spec = EFFORT_SPEC[key]
              const count = availableByEffort[key]
              const over = dragOver === key
              const selected = isT && effort === key && !dragOver
              const active = over || selected
              const Icon = spec.Icon
              return (
                <div
                  key={key}
                  data-effort-zone={key}
                  role={isT ? 'button' : undefined}
                  tabIndex={isT ? 0 : undefined}
                  onClick={() => { if (isT) setEffort(key) }}
                  onKeyDown={e => { if (isT && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEffort(key) } }}
                  onDragOver={e => { e.preventDefault(); setDragOver(key) }}
                  onDragLeave={() => setDragOver(prev => (prev === key ? null : prev))}
                  onDrop={() => { if (dragId) assignEffort(dragId, key); setDragId(null); setDragOver(null) }}
                  title={isT ? `New quests default to ${key} — or drop a quest here to re-label it` : `Drop a quest here to make it ${key}`}
                  style={{
                    position: 'relative', flex: 1, minWidth: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    padding: '14px 12px 13px', borderRadius: 18,
                    background: spec.tint,
                    border: `1.5px solid ${active ? spec.accent : spec.border}`,
                    boxShadow: active ? `0 0 0 3px ${spec.ring}` : '0 2px 10px rgba(20,30,45,0.03)',
                    cursor: isT ? 'pointer' : 'default',
                    transition: 'border-color .15s, box-shadow .15s',
                  }}
                >
                  {count > 0 && (
                    <span style={{
                      position: 'absolute', top: 10, right: 10,
                      minWidth: 22, padding: '2px 7px', borderRadius: 999,
                      background: '#ffffff', border: `1px solid ${spec.accent}`,
                      color: spec.accent, fontSize: 14, fontWeight: 800, lineHeight: 1.5,
                      fontVariantNumeric: 'tabular-nums',
                    }}>{count}</span>
                  )}

                  <span aria-hidden style={{
                    width: 44, height: 44, borderRadius: '50%', background: '#ffffff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 7px rgba(20,30,45,0.07)',
                  }}>
                    <Icon size={21} color={spec.accent} strokeWidth={2.1} />
                  </span>
                  <div style={{ fontSize: 22.5, fontWeight: 800, letterSpacing: -0.3, color: spec.accent, lineHeight: 1.2 }}>
                    {key}
                  </div>
                  <div style={{ fontSize: 15.5, fontWeight: 500, color: INK_MUTED, textAlign: 'center' }}>
                    {spec.sub}
                  </div>
                  {/* The corner badge is a bare number with nothing saying what
                      it counts, so the same figure is spelled out here. */}
                  <div style={{
                    fontSize: 15, fontWeight: 700, color: spec.accent, textAlign: 'center',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {count} Quest{count === 1 ? '' : 's'} Available
                  </div>

                  <div style={{
                    width: '100%', marginTop: 7, minHeight: 60,
                    borderRadius: 12, border: `2px dashed ${over ? spec.accent : spec.dash}`,
                    background: over ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
                    padding: '10px 8px', transition: 'border-color .15s, background .15s',
                    pointerEvents: 'none',
                  }}>
                    <Pointer size={17} color={over ? spec.accent : INK_FAINT} strokeWidth={2} />
                    <span style={{
                      fontSize: 15.5, fontWeight: over ? 700 : 500,
                      color: over ? spec.accent : INK_MUTED, textAlign: 'center',
                    }}>
                      {over ? `Drop to make it ${key}` : 'Drag & drop quests here'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ============ YOUR QUESTS ============ */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={accentBar} />
          <span style={sectionTitle}>Your quests</span>
          <span style={{ flex: 1, height: 1, background: LINE }} />
          {isT && (
            <button onClick={() => setReviewMode(r => !r)} style={{
              ...ghostBtn,
              borderColor: reviewMode ? GREEN_ACCENT : LINE,
              color: reviewMode ? GREEN_SOLID : INK_MUTED,
            }}>
              {reviewMode ? 'Exit review' : 'Review mode'}
            </button>
          )}
        </div>

        <div className="mq-scroll" style={{
          flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(236px, 1fr))',
          gap: 12, alignContent: 'start', paddingRight: 4, paddingBottom: 4,
        }}>
          {quests.length === 0 && (
            <div style={{
              gridColumn: '1 / -1', padding: '26px 0', textAlign: 'center',
              fontSize: 16.5, fontWeight: 500, color: INK_FAINT,
            }}>
              {isT ? 'No quests yet — add one above to start the board.' : 'No quests yet — your therapist will add one.'}
            </div>
          )}

          {quests.map(q => {
            const spec = EFFORT_SPEC[q.effort]
            const badge = badgeFor(q.id)
            const BadgeIcon = badge.Icon
            const open = menuId === q.id
            const dragging = dragId === q.id
            return (
              <div
                key={q.id}
                draggable={canInteract}
                onDragStart={() => setDragId(q.id)}
                onDragEnd={() => { setDragId(null); setDragOver(null) }}
                onTouchStart={onTouchStart(q.id)}
                onClick={() => { if (canInteract) toggleComplete(q.id) }}
                title={canInteract ? 'Click to mark complete · drag onto a difficulty to re-label' : undefined}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 9,
                  padding: '12px 12px 12px 13px', borderRadius: 16,
                  background: q.completed ? '#F6FDF8' : '#ffffff',
                  border: `1px solid ${dragging ? GREEN_ACCENT : q.completed ? '#CFEEDA' : LINE}`,
                  boxShadow: dragging ? '0 8px 20px rgba(31,122,68,0.16)' : '0 2px 8px rgba(20,30,45,0.05)',
                  cursor: canInteract ? 'grab' : 'default',
                  opacity: dragging ? 0.55 : 1,
                  userSelect: 'none', touchAction: canInteract ? 'none' : 'auto',
                  animation: celebrate === q.id ? 'mq-pop 1.2s ease' : 'none',
                  transition: 'border-color .15s, box-shadow .15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span aria-hidden style={{
                    width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: q.completed ? '#DCFCE7' : badge.tint,
                  }}>
                    {q.completed
                      ? <Check size={21} color={GREEN_SOLID} strokeWidth={3} />
                      : <BadgeIcon size={20} color={badge.accent} strokeWidth={2.1} />}
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 16.5, fontWeight: 600, lineHeight: 1.35,
                      color: q.completed ? INK_FAINT : INK_BODY,
                      textDecoration: q.completed ? 'line-through' : 'none',
                      wordBreak: 'break-word',
                    }}>
                      {q.text}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 14, fontWeight: 800, color: spec.accent, letterSpacing: 0.1 }}>
                      {q.effort}
                    </div>
                  </div>

                  <button
                    onClick={e => { e.stopPropagation(); setMenuId(open ? null : q.id) }}
                    aria-label="Quest actions"
                    aria-expanded={open}
                    style={{
                      width: 26, height: 26, flexShrink: 0, borderRadius: 8, padding: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: open ? '#F1F5F9' : 'transparent',
                      border: `1px solid ${open ? LINE : 'transparent'}`,
                      color: INK_FAINT, cursor: 'pointer',
                    }}
                  >
                    <EllipsisVertical size={16} color={INK_FAINT} strokeWidth={2.2} />
                  </button>
                </div>

                {open && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 9, borderTop: `1px solid ${LINE}` }}
                  >
                    <button
                      onClick={() => { toggleComplete(q.id); setMenuId(null) }}
                      disabled={!canInteract}
                      style={{
                        ...menuBtn,
                        borderColor: '#CFEEDA', color: GREEN_SOLID,
                        cursor: canInteract ? 'pointer' : 'default',
                        opacity: canInteract ? 1 : 0.5,
                      }}
                    >
                      <Check size={13} color={GREEN_SOLID} strokeWidth={2.6} />
                      {q.completed ? 'Mark not done' : 'Mark complete'}
                    </button>
                    {isT && (
                      <button
                        onClick={() => { removeQuest(q.id); setMenuId(null) }}
                        style={{ ...menuBtn, borderColor: '#F5D6D6', color: '#B91C1C' }}
                      >
                        <Trash2 size={13} color="#B91C1C" strokeWidth={2.3} />
                        Remove
                      </button>
                    )}
                  </div>
                )}

                {isT && reviewMode && q.completed && (
                  <input
                    onClick={e => e.stopPropagation()}
                    className="mq-input"
                    placeholder="Which felt hardest and why?"
                    value={q.therapistNote}
                    onChange={e => setNote(q.id, e.target.value)}
                    onBlur={() => persist(quests)}
                    style={{ ...inputStyle, fontSize: 15.5, padding: '8px 10px' }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Finger-follow ghost for the touch drag path. */}
      {ghost && dragQuest && (
        <div aria-hidden style={{
          position: 'fixed', left: ghost.x, top: ghost.y, transform: 'translate(-50%, -50%)',
          zIndex: 60, pointerEvents: 'none',
          maxWidth: 200, padding: '9px 12px', borderRadius: 12,
          background: '#ffffff', border: `1.5px solid ${GREEN_ACCENT}`,
          boxShadow: '0 10px 24px rgba(20,30,45,0.18)',
          fontSize: 16, fontWeight: 600, color: INK_BODY,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {dragQuest.text}
        </div>
      )}
    </div>
  )
}

/* ===========================================================================
   Shared styles
=========================================================================== */

const badgeSquare = (bg: string, border: string): CSSProperties => ({
  width: 40, height: 40, borderRadius: 12, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: bg, border: `1px solid ${border}`,
})

const rowTitle: CSSProperties = {
  fontSize: 18, fontWeight: 800, letterSpacing: -0.2, lineHeight: 1.25, color: INK,
}

const rowSub: CSSProperties = {
  fontSize: 16.5, fontWeight: 500, lineHeight: 1.35, color: INK_MUTED, marginTop: 3,
}

const accentBar: CSSProperties = {
  width: 4, height: 20, borderRadius: 3, flexShrink: 0, background: GREEN_ACCENT,
}

const sectionTitle: CSSProperties = {
  fontSize: 19.5, fontWeight: 800, letterSpacing: -0.3, color: INK, whiteSpace: 'nowrap',
}

const inputStyle: CSSProperties = {
  flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box',
  background: '#ffffff', border: `1px solid ${LINE}`, borderRadius: 10,
  padding: '10px 12px', fontSize: 16.5, color: INK_BODY, outline: 'none',
  fontFamily: '"DM Sans", sans-serif', transition: 'border-color .15s, box-shadow .15s',
}

const chipBtn: CSSProperties = {
  padding: '10px 18px', borderRadius: 10, border: 'none', flexShrink: 0,
  background: GREEN_SOLID, color: '#ffffff', fontSize: 16.5, fontWeight: 700,
  fontFamily: '"DM Sans", sans-serif', cursor: 'pointer', whiteSpace: 'nowrap',
}

const ghostBtn: CSSProperties = {
  padding: '7px 13px', borderRadius: 999, border: `1px solid ${LINE}`,
  background: '#ffffff', fontSize: 16, fontWeight: 700,
  fontFamily: '"DM Sans", sans-serif', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
}

const menuBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 11px', borderRadius: 999, border: `1px solid ${LINE}`,
  background: '#ffffff', fontSize: 15.5, fontWeight: 700,
  fontFamily: '"DM Sans", sans-serif', cursor: 'pointer', whiteSpace: 'nowrap',
}
