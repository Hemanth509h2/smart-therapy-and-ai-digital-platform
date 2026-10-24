'use client'

// Therapist-only. Pushes the caption languages to everyone in the room as
// participant attributes, via the backend, whenever the settings change or
// someone (re)joins — so changing captions never reconnects the call.
//
// Must render inside StaadVideo (needs the room).

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

  const push = useRef(() => {
    const { enabled, therapist, client } = latest.current
    apiFetch(`/api/sessions/${sessionId}/translation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, therapist, client }),
    })
      .then(async (res) => {
        if (!res.ok) toast(await apiErrorMessage(res, 'update the translation settings'), 'warning')
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
