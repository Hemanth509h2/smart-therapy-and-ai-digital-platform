'use client'

// Therapist-only. Pushes the caption languages to everyone in the room as
// participant attributes, via the backend, whenever the settings change or
// someone (re)joins — so changing captions never reconnects the call.
//
// Must render inside StaadVideo (needs the room).
//
// `settings.enabled` only turns true once both participants have consented to
// AI features (see the session page), so the change effect below pushes the
// languages as soon as consent completes. The backend re-checks consent and
// answers 403 AI_CONSENT_REQUIRED until it sees both consents in Firestore;
// that is "waiting for consent", not an error, so it gets one quiet retry.

import { useEffect, useRef } from 'react'
import { RoomEvent } from 'livekit-client'
import { useSessionRoom } from '@/components/StaadVideo'
import { apiFetch } from '@/lib/api'
import { apiErrorMessage, networkErrorMessage } from '@/lib/apiError'
import { toast } from '@/components/practice/ui'
import type { TranslationSettings } from '@/lib/translation'

export default function TranslationSync({
  sessionId,
  settings,
}: {
  sessionId: string
  settings: TranslationSettings
}) {
  const { room } = useSessionRoom()
  const latest = useRef(settings)
  latest.current = settings

  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(retryTimer.current), [])

  const push = useRef((isRetry = false) => {
    const { enabled, therapist, client } = latest.current
    apiFetch(`/api/sessions/${sessionId}/translation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, therapist, client }),
    })
      .then(async (res) => {
        if (res.ok) return
        if (res.status === 403) {
          const body = await res.clone().json().catch(() => null)
          if (body?.code === 'AI_CONSENT_REQUIRED') {
            // Consent may have just completed and not reached the server yet.
            if (!isRetry && latest.current.enabled) {
              clearTimeout(retryTimer.current)
              retryTimer.current = setTimeout(() => push.current(true), 3000)
            }
            return
          }
        }
        toast(await apiErrorMessage(res, 'update the translation settings'), 'warning')
      })
      .catch(() => {
        // Non-fatal: the next change or join retries.
        toast(networkErrorMessage('update the translation settings'), 'warning')
      })
  })

  // Settings changed — skip the mount, the join token already carries them.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    push.current()
  }, [settings.enabled, settings.therapist, settings.client])

  // A late joiner's token may predate the current settings.
  useEffect(() => {
    if (!room) return
    const onJoin = () => push.current()
    room.on(RoomEvent.ParticipantConnected, onJoin)
    room.on(RoomEvent.Reconnected, onJoin)
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin)
      room.off(RoomEvent.Reconnected, onJoin)
    }
  }, [room])

  return null
}
