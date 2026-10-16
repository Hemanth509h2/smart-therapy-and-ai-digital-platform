'use client'

// Waiting room for guests who join through an invite link. The room page (and
// everything in it: Firestore listeners, the LiveKit token) only mounts once the
// therapist has admitted this guest; until then the guest's uid has no access to
// the session at all. Admission is decided server-side (POST
// /api/sessions/[id]/lobby), so this component only reflects it.

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import WaitingLobby from './WaitingLobby'

type GateStatus = 'checking' | 'waiting' | 'admitted' | 'denied' | 'invalid'

const POLL_MS = 3000

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
    let timer: ReturnType<typeof setTimeout> | undefined

    const knock = async () => {
      if (stopped || inFlight) return
      inFlight = true
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
        if (data.status === 'admitted' || data.status === 'denied') {
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
        if (!stopped) timer = setTimeout(knock, POLL_MS)
      }
    }

    // Background tabs throttle timers, so knock right away when the guest comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') knock()
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
