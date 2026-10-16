'use client'

// Therapist control: take an admitted invite-link guest out of the call
// without ending the session. The server disconnects them from LiveKit,
// revokes their session access and refuses them a new video token; opening the
// invite link again puts them back in the waiting room.

import { useState } from 'react'
import { UserX } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { RC } from './roomTheme'

export default function RemoveClientButton({
  sessionId,
  uid,
  name,
  onDone,
  style,
}: {
  sessionId: string
  uid: string
  name: string
  onDone?: (msg: string) => void
  style?: React.CSSProperties
}) {
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    if (!window.confirm(`Remove ${name} from the call? The session stays open, and they can ask to join again with their invite link.`)) return
    setBusy(true)
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/lobby`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, action: 'remove' }),
      })
      onDone?.(res.ok ? `${name} removed from the call` : 'Could not remove the client. Try again.')
    } catch {
      onDone?.('Could not remove the client. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      title={`Remove ${name} from the call`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        borderRadius: 20,
        border: 'none',
        background: 'rgba(255,255,255,0.92)',
        color: RC.red,
        fontSize: 12,
        fontWeight: 600,
        cursor: busy ? 'default' : 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        opacity: busy ? 0.6 : 1,
        ...style,
      }}
    >
      <UserX size={14} />
      {busy ? 'Removing…' : 'Remove client'}
    </button>
  )
}
