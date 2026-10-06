'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'

interface FloatingEmoji {
  id: number
  emoji: string
  x: number
}

interface ReactionOverlayProps {
  sessionId: string
}

const EMOJIS = ['👏', '⭐', '💪', '😊', '🎉']

export default function ReactionOverlay({ sessionId }: ReactionOverlayProps) {
  const [barOpen, setBarOpen] = useState(false)
  const [floaters, setFloaters] = useState<FloatingEmoji[]>([])
  const idRef = useRef(0)

  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      if (data.lastReaction?.emoji && data.lastReaction?.timestamp) {
        const elapsed = Date.now() - new Date(data.lastReaction.timestamp).getTime()
        if (elapsed < 2000) {
          const id = ++idRef.current
          const floater: FloatingEmoji = {
            id,
            emoji: data.lastReaction.emoji,
            x: Math.random() * 60 + 20,
          }
          setFloaters((prev) => [...prev, floater])
          setTimeout(() => {
            setFloaters((prev) => prev.filter((f) => f.id !== id))
          }, 1800)
        }
      }
    })
    return () => unsub()
  }, [sessionId])

  const sendReaction = useCallback(
    async (emoji: string) => {
      setBarOpen(false)
      const id = ++idRef.current
      const floater: FloatingEmoji = { id, emoji, x: Math.random() * 60 + 20 }
      setFloaters((prev) => [...prev, floater])
      setTimeout(() => {
        setFloaters((prev) => prev.filter((f) => f.id !== id))
      }, 1800)

      try {
        await updateDoc(doc(db, 'liveSessions', sessionId), {
          lastReaction: { emoji, timestamp: new Date().toISOString() },
          'timestamps.updatedAt': new Date().toISOString(),
        })
      } catch {}
    },
    [sessionId]
  )

  return (
    <>
      {/* Reaction Bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 72,
          left: '50%',
          transform: barOpen ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(20px)',
          background: 'rgba(255, 255, 255, 0.16)',
          backdropFilter: 'blur(18px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.3)',
          border: '1px solid rgba(255, 255, 255, 0.22)',
          borderRadius: 30,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
          padding: '6px 12px',
          opacity: barOpen ? 1 : 0,
          pointerEvents: barOpen ? 'all' : 'none',
          transition: 'all 0.22s ease',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 9, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: 0.8, marginRight: 4 }}>
          Send
        </span>
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => sendReaction(emoji)}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              padding: 2,
              transition: 'transform 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.3)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Floating Reactions */}
      {floaters.map((f) => (
        <div
          key={f.id}
          className="animate-float-up"
          style={{
            position: 'absolute',
            bottom: 64,
            left: `${f.x}%`,
            fontSize: 32,
            zIndex: 50,
            pointerEvents: 'none',
          }}
        >
          {f.emoji}
        </div>
      ))}
    </>
  )
}
