'use client'
import { useState, useEffect } from 'react'
import { doc, updateDoc, arrayUnion, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { X } from 'lucide-react'

interface NotesPanelProps {
  open: boolean
  onClose: () => void
  sessionId: string
}

interface SessionNote {
  content: string
  timestamp: string
}

export default function NotesPanel({ open, onClose, sessionId }: NotesPanelProps) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [notes, setNotes] = useState<SessionNote[]>([])

  // Keep every note this session: append to the persistent `sessions` doc so
  // the end-of-session report can read them (optional input — therapists don't
  // always write notes).
  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(doc(db, 'sessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const arr = snap.data().therapistNotes
      if (Array.isArray(arr)) setNotes(arr as SessionNote[])
    })
    return () => unsub()
  }, [sessionId])

  const handleSave = async () => {
    if (!text.trim() || saving) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'sessions', sessionId), {
        therapistNotes: arrayUnion({
          content: text.trim(),
          timestamp: new Date().toISOString(),
        }),
        therapistNotesLastUpdated: serverTimestamp(),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setText('')
    } catch {}
    setSaving(false)
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 48,
        left: 0,
        bottom: 64,
        width: 260,
        background: 'rgba(28, 28, 28, 0.55)',
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        borderRight: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: 20,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
        zIndex: 25,
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <span style={{ fontSize: 13, fontWeight: 500, color: '#FFFFFF' }}>
          Session notes{notes.length > 0 ? ` (${notes.length})` : ''}
        </span>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Running list of notes saved this session */}
      {notes.length > 0 && (
        <div
          style={{
            maxHeight: 160,
            overflowY: 'auto',
            marginBottom: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {notes.map((n, i) => (
            <div
              key={i}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '6px 8px',
              }}
            >
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.35 }}>
                {n.content}
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type clinical observations..."
        style={{
          flex: 1,
          minHeight: 80,
          background: 'transparent',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 8,
          padding: 10,
          color: '#FFFFFF',
          fontSize: 12,
          fontFamily: "'DM Sans', sans-serif",
          resize: 'none',
          outline: 'none',
        }}
      />
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={handleSave}
          disabled={saving || !text.trim()}
          style={{
            flex: 1,
            padding: '8px 0',
            borderRadius: 8,
            border: 'none',
            background: '#A8C9BE',
            color: '#1E3530',
            fontSize: 12,
            fontWeight: 500,
            cursor: saving || !text.trim() ? 'default' : 'pointer',
            opacity: saving || !text.trim() ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save note'}
        </button>
        {saved && (
          <span style={{ fontSize: 11, color: '#A8C9BE' }}>✓ Note saved</span>
        )}
      </div>
    </div>
  )
}
