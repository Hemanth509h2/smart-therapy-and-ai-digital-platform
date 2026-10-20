'use client'

// Therapist side of the waiting room: a "Clients" button (in the top bar, or
// floating where there is no top bar) that opens a panel listing
//   - guests who opened the invite link and are waiting — Admit / Deny
//   - admitted guests in the call — Remove
// The badge shows how many are waiting, and the panel opens by itself when
// someone new starts waiting. Polls the backend: the lobby lives in a
// server-only Firestore path, so it can't be subscribed to from the browser.
// The therapist can stop the polling from the panel (and resume it); while
// stopped, new knocks go unseen.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, UserCheck, UserX, Users, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { RC } from './roomTheme'

interface Person {
  uid: string
  name: string
  requestedAt: string
}

type Action = 'admit' | 'deny' | 'remove'

// Fast while someone is waiting or the panel is open (the therapist is acting
// on it); otherwise only watching for a new knock, which can wait a few seconds.
const POLL_MS = 3000
const IDLE_POLL_MS = 8000
// Stop checking by itself after this long with no one waiting. Never while
// someone is waiting, so no client is left knocking unseen by it.
const AUTO_STOP_MS = 2 * 60 * 1000

// Why checking is stopped. 'joined': sessions are one client, so once a client
// is in the call there is no one else to look for.
type StopReason = 'manual' | 'idle' | 'joined'

const STOP_MESSAGES: Record<StopReason, string> = {
  manual: 'Stopped checking.',
  idle: 'Stopped checking automatically after 2 minutes with no one waiting.',
  joined: 'Your client has joined, so checking for others has stopped.',
}

export default function LobbyRequests({
  sessionId,
  onDecided,
  floating,
}: {
  sessionId: string
  onDecided?: (msg: string) => void
  /** Pin the button above the bottom-right corner (layouts without the top bar);
   *  the panel then opens upwards. */
  floating?: boolean
}) {
  const [waiting, setWaiting] = useState<Person[]>([])
  const [inCall, setInCall] = useState<Person[]>([])
  const [loadError, setLoadError] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // Client the therapist clicked Remove on, awaiting confirmation.
  const [confirmRemove, setConfirmRemove] = useState<Person | null>(null)
  // Set while checking the waiting room is stopped (see StopReason).
  const [stopReason, setStopReason] = useState<StopReason | null>(null)
  const paused = stopReason !== null
  const pausedRef = useRef(false)
  pausedRef.current = paused
  // Last time checking started or someone was waiting; the auto-stop clock.
  const lastActiveAt = useRef(Date.now())
  const seenWaiting = useRef<Set<string>>(new Set())
  // Clients already seen in the call: only a newly joined one stops checking,
  // so Resume isn't undone by the client who is still there.
  const seenInCall = useRef<Set<string>>(new Set())

  const stop = (reason: StopReason) => {
    pausedRef.current = true
    setStopReason(reason)
  }

  // Resolves true when the lists were refreshed.
  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/lobby`)
      if (!res.ok) {
        setLoadError(true)
        return false
      }
      const data = await res.json()
      const w: Person[] = Array.isArray(data.waiting) ? data.waiting : []
      const c: Person[] = Array.isArray(data.inCall) ? data.inCall : []
      setWaiting(w)
      setInCall(c)
      setLoadError(false)
      if (w.length) lastActiveAt.current = Date.now()
      // Someone new is knocking: open the panel so the therapist notices.
      if (w.some((p) => !seenWaiting.current.has(p.uid))) setOpen(true)
      seenWaiting.current = new Set(w.map((p) => p.uid))
      if (c.some((p) => !seenInCall.current.has(p.uid))) stop('joined')
      seenInCall.current = new Set(c.map((p) => p.uid))
      return true
    } catch {
      // Keep the last list on a network blip.
      return false
    }
  }, [sessionId])

  const fast = useRef(false)
  fast.current = open || waiting.length > 0

  // Chained timeouts rather than setInterval, so a slow response never
  // overlaps the next poll. Nothing is fetched while the tab is hidden; coming
  // back fetches right away.
  useEffect(() => {
    let stopped = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (stopped || inFlight) return
      inFlight = true
      clearTimeout(timer)
      try {
        if (document.visibilityState === 'visible' && !pausedRef.current) {
          // Only on a fresh list: a failed check can't tell that no one is waiting.
          const fresh = await load()
          if (fresh && !pausedRef.current && Date.now() - lastActiveAt.current >= AUTO_STOP_MS) stop('idle')
        }
      } finally {
        inFlight = false
        if (!stopped) timer = setTimeout(tick, fast.current ? POLL_MS : IDLE_POLL_MS)
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    tick()
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  useEffect(() => {
    if (!confirmRemove) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmRemove(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmRemove])

  const decide = async (person: Person, action: Action) => {
    setConfirmRemove(null)
    setBusy(person.uid)
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/lobby`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: person.uid, action }),
      })
      if (res.ok) {
        setWaiting((w) => w.filter((p) => p.uid !== person.uid))
        setInCall((c) => {
          const rest = c.filter((p) => p.uid !== person.uid)
          return action === 'admit' ? [...rest, person] : rest
        })
        // Client let in: nothing more to look for (see StopReason).
        if (action === 'admit') {
          seenInCall.current.add(person.uid)
          stop('joined')
        }
        onDecided?.(
          action === 'admit' ? `${person.name} admitted`
          : action === 'deny' ? `${person.name} was not admitted`
          : `${person.name} removed from the call`,
        )
      } else {
        onDecided?.('Could not update the waiting room. Try again.')
      }
    } catch {
      onDecided?.('Could not update the waiting room. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: RC.inkMuted,
    padding: '8px 4px 4px',
  }

  const row = (p: Person, status: string, actions: React.ReactNode) => (
    <div key={p.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: RC.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 11.5, color: RC.inkMuted }}>{status}</div>
      </div>
      {actions}
    </div>
  )

  const actionBtn = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled: boolean,
    tone: 'primary' | 'ghost' | 'danger',
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 30,
        padding: '0 12px',
        borderRadius: 8,
        border: `1px solid ${tone === 'primary' ? RC.green : tone === 'danger' ? RC.red : RC.border}`,
        background: tone === 'primary' ? RC.green : tone === 'danger' ? RC.redSoft : RC.tile,
        color: tone === 'primary' ? '#fff' : tone === 'danger' ? RC.red : RC.ink,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      {icon}
      {label}
    </button>
  )

  const highlighted = open || waiting.length > 0

  return (
    <div style={floating ? { position: 'fixed', bottom: 80, right: 16, zIndex: 70 } : { position: 'relative' }}>
      <button
        type="button"
        onClick={() => {
          // Opening: show fresh lists now rather than at the next idle poll.
          if (!open && !paused) load()
          setOpen(!open)
        }}
        title={open ? 'Hide clients' : 'Waiting room and clients in the call'}
        aria-expanded={open}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          height: 32,
          borderRadius: 8,
          border: `1px solid ${highlighted ? RC.green : RC.border}`,
          background: highlighted ? RC.greenSoft : floating ? RC.panel : RC.tile,
          color: highlighted ? RC.greenDark : RC.ink,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: floating ? '0 4px 14px rgba(0,0,0,0.12)' : undefined,
        }}
      >
        <Users size={14} />
        <span style={{ whiteSpace: 'nowrap' }}>
          {waiting.length ? `${waiting.length} waiting` : 'Clients'}
          {paused && <span style={{ fontWeight: 500, color: RC.inkMuted }}> · stopped</span>}
        </span>
        {waiting.length > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, width: 10, height: 10, borderRadius: '50%', background: RC.red, border: `2px solid ${RC.panel}` }} />
        )}
      </button>

      {open && (
        <div
          role="region"
          aria-label="Waiting room"
          style={{
            position: 'absolute',
            ...(floating ? { bottom: 40 } : { top: 40 }),
            right: 0,
            zIndex: 70,
            width: 'min(360px, calc(100vw - 32px))',
            padding: '6px 10px 10px',
            borderRadius: 12,
            background: RC.panel,
            border: `1px solid ${RC.border}`,
            boxShadow: '0 16px 40px rgba(20,30,40,0.16), 0 0 0 1px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 0' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: RC.ink }}>Clients</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  if (paused) {
                    lastActiveAt.current = Date.now()
                    pausedRef.current = false
                    setStopReason(null)
                    load()
                  } else {
                    stop('manual')
                  }
                }}
                title={paused ? 'Start checking for clients again' : 'Stop checking for new clients'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  height: 24,
                  padding: '0 8px',
                  borderRadius: 6,
                  border: `1px solid ${paused ? RC.green : RC.border}`,
                  background: paused ? RC.greenSoft : RC.tile,
                  color: paused ? RC.greenDark : RC.ink,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {paused ? <Play size={12} /> : <Pause size={12} />}
                {paused ? 'Resume' : 'Stop'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Close"
                style={{ border: 'none', background: 'transparent', color: RC.inkMuted, cursor: 'pointer', display: 'flex', padding: 2 }}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {stopReason && (
            <div style={{ fontSize: 12, color: RC.inkMuted, padding: '8px 4px 0' }}>
              {STOP_MESSAGES[stopReason]}{' '}
              New clients who open your invite link won&apos;t appear until you press Resume.
            </div>
          )}

          {!paused && loadError && (
            <div style={{ fontSize: 12, color: RC.red, padding: '8px 4px 0' }}>Could not load the waiting room. Retrying…</div>
          )}

          <div style={sectionLabel}>Waiting to join ({waiting.length})</div>
          {waiting.length === 0 ? (
            <div style={{ fontSize: 12.5, color: RC.inkMuted, padding: '4px 4px 8px' }}>
              No one is waiting. Clients who open your invite link appear here.
            </div>
          ) : (
            waiting.map((p) =>
              row(p, 'is waiting to join', (
                <>
                  {actionBtn('Reject', <UserX size={13} />, () => decide(p, 'deny'), busy === p.uid, 'ghost')}
                  {actionBtn('Allow', <UserCheck size={13} />, () => decide(p, 'admit'), busy === p.uid, 'primary')}
                </>
              )),
            )
          )}

          <div style={{ height: 1, background: RC.border, margin: '6px 0' }} />

          <div style={sectionLabel}>In the call ({inCall.length})</div>
          {inCall.length === 0 ? (
            <div style={{ fontSize: 12.5, color: RC.inkMuted, padding: '4px' }}>No client in the call.</div>
          ) : (
            inCall.map((p) =>
              row(p, 'in the call', actionBtn('Remove', <UserX size={13} />, () => setConfirmRemove(p), busy === p.uid, 'danger')),
            )
          )}
        </div>
      )}

      {/* Portalled to <body> so no ancestor's stacking or clipping affects it. */}
      {confirmRemove && createPortal(
        <div
          onClick={() => setConfirmRemove(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(20,30,40,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-client-title"
            aria-describedby="remove-client-desc"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(380px, 100%)',
              padding: '22px 22px 18px',
              borderRadius: 16,
              background: RC.panel,
              border: `1px solid ${RC.border}`,
              boxShadow: '0 24px 60px rgba(20,30,40,0.28)',
            }}
          >
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: RC.redSoft, color: RC.red, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <UserX size={20} />
            </div>
            <div id="remove-client-title" style={{ fontSize: 16, fontWeight: 600, color: RC.ink, marginBottom: 6, overflowWrap: 'anywhere' }}>
              Remove {confirmRemove.name} from the call?
            </div>
            <div id="remove-client-desc" style={{ fontSize: 13, lineHeight: 1.5, color: RC.inkMuted, marginBottom: 20 }}>
              The session stays open, and they can ask to join again with their invite link.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmRemove(null)}
                style={{ height: 36, padding: '0 16px', borderRadius: 8, border: `1px solid ${RC.border}`, background: RC.tile, color: RC.ink, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => decide(confirmRemove, 'remove')}
                style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: RC.red, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <UserX size={14} />
                Remove
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
