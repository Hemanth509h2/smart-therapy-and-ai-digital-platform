'use client'

import { useEffect } from 'react'
import { useConnectionState, useRemoteParticipants } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'

// Reports the Firebase uids of everyone else connected to the LiveKit room
// (each token carries the uid as the `uid` attribute, see /api/livekit-token).
// This is the reliable "who is in the call" signal: LiveKit notices a leave
// within seconds, even a closed tab, while the Firestore `isOnline` flag is
// only cleared by a write the leaving browser often never finishes.
// Reports null while this browser itself isn't connected, so callers can fall
// back to Firestore instead of showing everyone as gone.
export default function LivePresence({ onChange }: { onChange: (uids: Set<string> | null) => void }) {
  const connected = useConnectionState() === ConnectionState.Connected
  const remotes = useRemoteParticipants()
  const key = remotes
    .map((p) => p.attributes?.uid)
    .filter((uid): uid is string => !!uid)
    .sort()
    .join('\n')

  useEffect(() => {
    onChange(connected ? new Set(key ? key.split('\n') : []) : null)
  }, [connected, key, onChange])

  useEffect(() => () => onChange(null), [onChange])

  return null
}
