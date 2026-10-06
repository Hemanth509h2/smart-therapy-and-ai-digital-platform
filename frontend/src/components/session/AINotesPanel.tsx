'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  CheckCircle2, Bookmark, Star, Flag, MoreHorizontal,
  Bold, Italic, Underline, List, ListOrdered, Link2, Undo2, Redo2,
} from 'lucide-react'
import type { AIInsight } from '@/lib/rag/types'
import { GLASS } from './roomTheme'
import PanelShell from './PanelShell'
import { moduleName } from '@/lib/modules'

type Tab = 'notes' | 'suggested' | 'observations'

interface TranscriptEntry {
  text: string
  speaker: 'therapist' | 'client' | 'unknown'
  timestamp: number
  sessionMinute: number
}

interface SavedNote {
  content: string
  timestamp: string
}

interface ModuleEventEntry {
  module: string
  type: string
  detail: string
  timestamp: number
}

interface TimelineEntry {
  id: string
  kind: 'moment' | 'module' | 'highlight'
  offsetMs: number
  title: string
  desc: string
}

const KIND_META: Record<TimelineEntry['kind'], { dot: string; icon: React.ReactNode }> = {
  moment: { dot: '#5b8dd9', icon: <Bookmark size={11} /> },
  module: { dot: '#f2994a', icon: <Flag size={11} /> },
  highlight: { dot: '#4caf86', icon: <Star size={11} /> },
}

const fmtOffset = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = String(Math.floor(total / 3600)).padStart(2, '0')
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

// AI Notes sidebar panel: session timeline + note editor + AI suggestions.
//
// All data comes from the `sessions/{sessionId}` doc that already backs the
// session room — `transcript` (Deepgram chunks written by the RAG pipeline),
// `moduleEvents` (module activity log) and `therapistNotes` (the existing
// in-call notes array the end-of-session report reads). Saving appends to
// `therapistNotes` exactly as the previous NotesPanel did — same field, same
// shape, so the report generator is unaffected.
export default function AINotesPanel({
  sessionId,
  sessionStartedAt,
  insight,
  onClose,
}: {
  sessionId: string
  sessionStartedAt: number
  insight: AIInsight | null
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('notes')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [moduleEvents, setModuleEvents] = useState<ModuleEventEntry[]>([])
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>([])
  const [highlights, setHighlights] = useState<TimelineEntry[]>([])
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(doc(db, 'sessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const d = snap.data()
      if (Array.isArray(d.transcript)) setTranscript(d.transcript as TranscriptEntry[])
      if (Array.isArray(d.moduleEvents)) setModuleEvents(d.moduleEvents as ModuleEventEntry[])
      if (Array.isArray(d.therapistNotes)) setSavedNotes(d.therapistNotes as SavedNote[])
    })
    return () => unsub()
  }, [sessionId])

  // Key moments, not a flat transcript: longer client utterances read as the
  // substantive turns, so they become the timeline entries alongside module
  // activity and manual highlights.
  const timeline = useMemo<TimelineEntry[]>(() => {
    const moments: TimelineEntry[] = transcript
      .filter((c) => c.text && c.text.trim().length > 60)
      .slice(-12)
      .map((c, i) => {
        const words = c.text.trim().split(/\s+/)
        return {
          id: `t-${c.timestamp}-${i}`,
          kind: 'moment' as const,
          offsetMs: Math.max(0, c.timestamp - sessionStartedAt),
          title: words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : ''),
          desc: `${c.speaker === 'unknown' ? 'Speaker' : c.speaker} · ${c.text.trim()}`,
        }
      })

    const mods: TimelineEntry[] = moduleEvents.slice(-12).map((e, i) => ({
      id: `m-${e.timestamp}-${i}`,
      kind: 'module' as const,
      offsetMs: Math.max(0, e.timestamp - sessionStartedAt),
      title: moduleName(e.module),
      desc: e.detail,
    }))

    return [...moments, ...mods, ...highlights].sort((a, b) => a.offsetMs - b.offsetMs)
  }, [transcript, moduleEvents, highlights, sessionStartedAt])

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0

  const handleSave = async () => {
    if (!text.trim() || saving) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'sessions', sessionId), {
        therapistNotes: arrayUnion({ content: text.trim(), timestamp: new Date().toISOString() }),
        therapistNotesLastUpdated: serverTimestamp(),
      })
      setSavedAt(Date.now())
      setText('')
    } catch {}
    setSaving(false)
  }

  const handleHighlight = () => {
    setHighlights((h) => [
      ...h,
      {
        id: `h-${Date.now()}`,
        kind: 'highlight',
        offsetMs: Date.now() - sessionStartedAt,
        title: 'Highlighted moment',
        desc: 'Marked by therapist during the session.',
      },
    ])
  }

  // Rich-text toolbar: wraps the current textarea selection in markdown-ish
  // markers. The stored note stays plain text (same Firestore field/shape), so
  // this is purely an editing affordance.
  const wrap = (before: string, after = before) => {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    setText((t) => t.slice(0, s) + before + t.slice(s, e) + after + t.slice(e))
    el.focus()
  }
  const prefixLines = (marker: (i: number) => string) => {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const chunk = text.slice(s, e) || ''
    const out = chunk.split('\n').map((l, i) => marker(i) + l).join('\n')
    setText((t) => t.slice(0, s) + out + t.slice(e))
    el.focus()
  }

  const toolBtn: React.CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 7,
    border: `1px solid ${GLASS.fillBorder}`,
    background: 'transparent',
    color: GLASS.inkMuted,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'notes', label: 'Session Notes' },
    { id: 'suggested', label: 'AI Suggested Notes' },
    { id: 'observations', label: 'Important Observations' },
  ]

  return (
    <PanelShell title="AI Notes" onClose={onClose}>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Tab row */}
        <div style={{ display: 'flex', gap: 5 }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                padding: '6px 4px',
                borderRadius: 10,
                border: `1px solid ${tab === t.id ? GLASS.border : 'transparent'}`,
                background: tab === t.id ? GLASS.fill : 'transparent',
                color: tab === t.id ? GLASS.ink : GLASS.inkFaint,
                fontSize: 9.5,
                fontWeight: 600,
                cursor: 'pointer',
                lineHeight: 1.25,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Auto-save status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: GLASS.inkFaint }}>
          <CheckCircle2 size={12} style={{ color: '#4caf86' }} />
          {saving
            ? 'Saving…'
            : savedAt
              ? `Auto-saved · ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Auto-saved · Just now'}
        </div>

        {tab === 'notes' && (
          <>
            {/* ---- Session Timeline ---- */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: GLASS.ink, flex: 1 }}>
                  Session Timeline
                </span>
                <button
                  onClick={handleHighlight}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 20,
                    border: `1px solid ${GLASS.border}`,
                    background: GLASS.fill,
                    color: GLASS.ink,
                    fontSize: 9.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Highlight Moment
                </button>
              </div>

              {timeline.length === 0 ? (
                <div style={{ fontSize: 10, color: GLASS.inkFaint, padding: '10px 0' }}>
                  No key moments yet — the timeline fills in as the session is transcribed.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {timeline.map((e) => {
                    const meta = KIND_META[e.kind]
                    return (
                      <div
                        key={e.id}
                        style={{
                          position: 'relative',
                          display: 'flex',
                          gap: 9,
                          padding: '9px 10px',
                          borderRadius: 12,
                          background: GLASS.fill,
                          border: `1px solid ${GLASS.fillBorder}`,
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: meta.dot,
                            flexShrink: 0,
                            marginTop: 5,
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span
                              style={{
                                fontSize: 9,
                                fontFamily: 'monospace',
                                fontVariantNumeric: 'tabular-nums',
                                color: GLASS.inkFaint,
                              }}
                            >
                              {fmtOffset(e.offsetMs)}
                            </span>
                            <span style={{ color: meta.dot, display: 'flex' }}>{meta.icon}</span>
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: GLASS.ink, lineHeight: 1.35 }}>
                            {e.title}
                          </div>
                          <div style={{ fontSize: 10, color: GLASS.inkMuted, lineHeight: 1.45, marginTop: 2 }}>
                            {e.desc}
                          </div>
                        </div>
                        <button
                          title="Entry actions"
                          style={{
                            position: 'absolute',
                            top: 7,
                            right: 7,
                            width: 18,
                            height: 18,
                            borderRadius: 5,
                            border: 'none',
                            background: 'transparent',
                            color: GLASS.inkFaint,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ---- Session Notes editor ---- */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: GLASS.ink, marginBottom: 8 }}>
                Session Notes
              </div>

              {/* Toolbar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 8px',
                  borderRadius: '12px 12px 0 0',
                  background: GLASS.fill,
                  border: `1px solid ${GLASS.fillBorder}`,
                  borderBottom: 'none',
                  flexWrap: 'wrap',
                }}
              >
                <button title="Bold" onClick={() => wrap('**')} style={toolBtn}><Bold size={13} /></button>
                <button title="Italic" onClick={() => wrap('_')} style={toolBtn}><Italic size={13} /></button>
                <button title="Underline" onClick={() => wrap('__')} style={toolBtn}><Underline size={13} /></button>
                <span style={{ width: 1, height: 16, background: GLASS.fillBorder, margin: '0 2px' }} />
                <button title="Bullet list" onClick={() => prefixLines(() => '• ')} style={toolBtn}><List size={13} /></button>
                <button title="Numbered list" onClick={() => prefixLines((i) => `${i + 1}. `)} style={toolBtn}><ListOrdered size={13} /></button>
                <button title="Link" onClick={() => wrap('[', '](url)')} style={toolBtn}><Link2 size={13} /></button>
                <span style={{ width: 1, height: 16, background: GLASS.fillBorder, margin: '0 2px' }} />
                <button title="Undo" onClick={() => textareaRef.current?.ownerDocument.execCommand('undo')} style={toolBtn}><Undo2 size={13} /></button>
                <button title="Redo" onClick={() => textareaRef.current?.ownerDocument.execCommand('redo')} style={toolBtn}><Redo2 size={13} /></button>
              </div>

              {/* Text area + word count */}
              <div style={{ position: 'relative' }}>
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type clinical observations..."
                  style={{
                    width: '100%',
                    minHeight: 130,
                    background: 'transparent',
                    border: `1px solid ${GLASS.fillBorder}`,
                    borderRadius: '0 0 12px 12px',
                    padding: '10px 10px 24px',
                    color: GLASS.ink,
                    fontSize: 11.5,
                    lineHeight: 1.55,
                    fontFamily: "'DM Sans', sans-serif",
                    resize: 'vertical',
                    outline: 'none',
                    display: 'block',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    bottom: 7,
                    right: 10,
                    fontSize: 9,
                    color: GLASS.inkFaint,
                    pointerEvents: 'none',
                  }}
                >
                  {wordCount} words
                </span>
              </div>

              <button
                onClick={handleSave}
                disabled={saving || !text.trim()}
                style={{
                  width: '100%',
                  marginTop: 8,
                  padding: '8px 0',
                  borderRadius: 10,
                  border: 'none',
                  background: GLASS.accent,
                  color: GLASS.accentInk,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: saving || !text.trim() ? 'default' : 'pointer',
                  opacity: saving || !text.trim() ? 0.5 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save note'}
              </button>

              {/* Notes already saved this session */}
              {savedNotes.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {savedNotes.map((n, i) => (
                    <div
                      key={i}
                      style={{
                        background: GLASS.fill,
                        border: `1px solid ${GLASS.fillBorder}`,
                        borderRadius: 10,
                        padding: '7px 9px',
                      }}
                    >
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}>
                        {n.content}
                      </div>
                      <div style={{ fontSize: 9, color: GLASS.inkFaint, marginTop: 3 }}>
                        {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'suggested' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insight ? (
              <>
                <div
                  style={{
                    background: GLASS.fill,
                    border: `1px solid ${GLASS.fillBorder}`,
                    borderRadius: 12,
                    padding: 12,
                    fontSize: 11,
                    color: GLASS.inkMuted,
                    lineHeight: 1.6,
                    fontStyle: 'italic',
                  }}
                >
                  {insight.summary}
                </div>
                {insight.steps?.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      background: GLASS.fill,
                      border: `1px solid ${GLASS.fillBorder}`,
                      borderRadius: 12,
                      padding: '9px 11px',
                      fontSize: 11,
                      color: GLASS.inkMuted,
                      lineHeight: 1.5,
                    }}
                  >
                    {i + 1}. {s}
                  </div>
                ))}
              </>
            ) : (
              <div style={{ fontSize: 10, color: GLASS.inkFaint }}>
                No AI suggestions yet — run an analysis from the AI Assistant panel.
              </div>
            )}
          </div>
        )}

        {tab === 'observations' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insight?.riskFlag && (
              <div
                style={{
                  background: 'rgba(232,137,122,0.18)',
                  border: '1px solid rgba(232,137,122,0.4)',
                  borderRadius: 12,
                  padding: '9px 11px',
                  fontSize: 11,
                  color: '#E8897A',
                  lineHeight: 1.5,
                }}
              >
                {insight.riskDetail || 'Risk indicator detected — review the transcript.'}
              </div>
            )}
            {highlights.length === 0 && !insight?.riskFlag ? (
              <div style={{ fontSize: 10, color: GLASS.inkFaint }}>
                Nothing flagged yet. Use “Highlight Moment” to mark an important point.
              </div>
            ) : (
              highlights.map((h) => (
                <div
                  key={h.id}
                  style={{
                    background: GLASS.fill,
                    border: `1px solid ${GLASS.fillBorder}`,
                    borderRadius: 12,
                    padding: '9px 11px',
                  }}
                >
                  <div style={{ fontSize: 9, fontFamily: 'monospace', color: GLASS.inkFaint }}>
                    {fmtOffset(h.offsetMs)}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: GLASS.ink }}>{h.title}</div>
                  <div style={{ fontSize: 10, color: GLASS.inkMuted, marginTop: 2 }}>{h.desc}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </PanelShell>
  )
}
