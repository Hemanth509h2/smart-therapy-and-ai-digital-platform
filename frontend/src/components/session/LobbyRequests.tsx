'use client'

// Therapist side of the waiting room: lists guests who opened the invite link
// and are waiting, with Admit / Deny. Polls the backend (the lobby lives in a
// server-only Firestore path, so it can't be subscribed to from the browser).
// Styled with the website's STAAD design system (.staad-ui tokens), so it
// follows the site's light/dark theme even inside the call screen.

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface Waiting {
  uid: string
  name: string
  requestedAt: string
}

const POLL_MS = 3000

export default function LobbyRequests({ sessionId, onDecided }: { sessionId: string; onDecided?: (msg: string) => void }) {
  const [waiting, setWaiting] = useState<Waiting[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/lobby`)
      if (!res.ok) return
      const data = await res.json()
      setWaiting(Array.isArray(data.waiting) ? data.waiting : [])
    } catch {
      // Keep the last list on a network blip.
    }
  }, [sessionId])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  const decide = async (person: Waiting, action: 'admit' | 'deny') => {
    setBusy(person.uid)
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/lobby`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: person.uid, action }),
      })
      if (res.ok) {
        setWaiting((w) => w.filter((p) => p.uid !== person.uid))
        onDecided?.(action === 'admit' ? `${person.name} admitted` : `${person.name} was not admitted`)
      } else {
        onDecided?.('Could not update the waiting room. Try again.')
      }
    } catch {
      onDecided?.('Could not update the waiting room. Try again.')
    } finally {
      setBusy(null)
    }
  }

  if (waiting.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Waiting room"
      className="staad-ui"
      style={{
        // .staad-ui is a page shell (full height, page background); here it
        // only supplies the theme tokens and fonts.
        minHeight: 0,
        background: 'transparent',
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 70,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: 'min(420px, calc(100vw - 32px))',
      }}
    >
      {waiting.map((p) => (
        <div
          key={p.uid}
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 24,
            padding: '12px 12px 12px 18px',
            boxShadow: '0 14px 34px rgba(0,0,0,0.16)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--muted)' }}>is waiting to join</div>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy === p.uid}
            onClick={() => decide(p, 'deny')}
            style={{ padding: '0 16px' }}
          >
            Deny
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={busy === p.uid}
            onClick={() => decide(p, 'admit')}
            style={{ padding: '0 18px' }}
          >
            Admit
          </button>
        </div>
      ))}
    </div>
  )
}
