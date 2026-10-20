'use client'

// Waiting room for guests who join through an invite link. The room page (and
// everything in it: Firestore listeners, the LiveKit token) only mounts once the
// therapist has admitted this guest; until then the guest's uid has no access to
// the session at all. Admission is decided server-side (POST
// /api/sessions/[id]/lobby), so this component only reflects it.
//
// It keeps checking after admission too: if the therapist removes the guest,
// the room unmounts (the server has already cut their video and access).

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import WaitingLobby from './WaitingLobby'

type GateStatus = 'checking' | 'waiting' | 'admitted' | 'denied' | 'removed' | 'invalid'

const POLL_MS = 3000
// Much slower once in the call: this is only a heartbeat (keeps the guest under
// "In the call", well inside the backend's 75s STALE_MS) and a check for being
// removed. Removal itself doesn't wait for it: the server cuts video and access
// right away, this only swaps the room for the "removed" notice.
const ADMITTED_POLL_MS = 15000
// Focus and visibilitychange often fire together; one knock covers both.
const MIN_REKNOCK_MS = 2000

export default function GuestAdmissionGate({
  sessionId,
  selfName,
  children,
}: {
  sessionId: string
  selfName: string
  children: React.ReactNode
}) {
  const [status, setStatus] = useState<GateStatus>('checking')
  const [therapistName, setTherapistName] = useState<string | undefined>()

  useEffect(() => {
    let stopped = false
    let inFlight = false
    let admitted = false
    let lastKnockAt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const knock = async () => {
      if (stopped || inFlight) return
      inFlight = true
      lastKnockAt = Date.now()
      clearTimeout(timer)
      try {
        const res = await apiFetch(`/api/sessions/${sessionId}/lobby`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (stopped) return
        if (res.status === 403 || res.status === 404) {
          stopped = true
          setStatus('invalid')
          return
        }
        if (data.therapistName) setTherapistName(data.therapistName)
        if (data.status === 'admitted') {
          admitted = true
          setStatus('admitted')
          return
        }
        if (data.status === 'denied' || data.status === 'removed') {
          stopped = true
          setStatus(data.status)
          return
        }
        if (data.status === 'ended') {
          stopped = true
          window.location.replace('/session-ended')
          return
        }
        setStatus('waiting')
      } catch {
        // Network blip: keep knocking.
      } finally {
        inFlight = false
        if (!stopped) timer = setTimeout(knock, admitted ? ADMITTED_POLL_MS : POLL_MS)
      }
    }

    // Background tabs throttle timers, so knock right away when the guest comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastKnockAt >= MIN_REKNOCK_MS) knock()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    knock()
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [sessionId])

  if (status === 'admitted') return <>{children}</>

  // Removed from the call: show why for a moment, then the session-ended page
  // (which also signs the throwaway guest out).
  if (status === 'removed') return <RemovedThenEnded />

  if (status === 'denied' || status === 'invalid') {
    // Same look as the site's ErrorScreen, minus its "Go to home" button:
    // guests have no account, so home would only show them a login page.
    return (
      <main className="staad-ui" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
        <section className="card" role="alert" style={{ transform: 'none', width: '100%', maxWidth: 480, display: 'grid', gap: 20, padding: 32 }}>
          <img src="/assests/staad-emblem.svg" alt="STAAD" width={36} height={36} />
          <div>
            <h1 className="empty__h">
              {status === 'denied' ? "You weren't let into this session" : 'This link is not valid for this session'}
            </h1>
            <p className="empty__p" style={{ maxWidth: 'none' }}>
              {status === 'denied'
                ? 'Your therapist did not admit you right now. Please contact them, or open your invite link again.'
                : 'Please open the invite link your therapist sent you.'}
            </p>
          </div>
        </section>
      </main>
    )
  }

  const who = therapistName || 'your therapist'
  return (
    <WaitingLobby
      therapistName={therapistName}
      selfName={selfName}
      title={`Waiting for ${who} to let you in`}
      message="Your therapist has been told you're here. You'll join the call as soon as they let you in. Please keep this page open."
    />
  )
}

const REMOVED_NOTICE_MS = 3000

function RemovedThenEnded() {
  useEffect(() => {
    const t = setTimeout(() => window.location.replace('/session-ended?removed=1'), REMOVED_NOTICE_MS)
    return () => clearTimeout(t)
  }, [])
  return (
    <main className="staad-ui" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
      <section className="card" role="alert" style={{ transform: 'none', width: '100%', maxWidth: 480, display: 'grid', gap: 20, padding: 32 }}>
        <img src="/assests/staad-emblem.svg" alt="STAAD" width={36} height={36} />
        <div>
          <h1 className="empty__h">You were removed from this session</h1>
          <p className="empty__p" style={{ maxWidth: 'none' }}>
            Your therapist ended your part of the call. To join again, open your invite link and wait to be let in.
          </p>
        </div>
      </section>
    </main>
  )
}
