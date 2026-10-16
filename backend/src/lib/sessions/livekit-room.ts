import { RoomServiceClient } from 'livekit-server-sdk'

// Server-side LiveKit room control (needs LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).

function roomService(): RoomServiceClient | null {
  const url = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL
  if (!url) return null
  return new RoomServiceClient(
    url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:'),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )
}

/**
 * Disconnect the participant(s) whose token carries attribute `uid` (set by
 * /api/livekit-token). Returns how many were removed. Identity is the display
 * name, so the uid attribute is what identifies the person.
 *
 * Tokens minted before the uid attribute existed lack it; for those, fall back
 * to `fallbackName` (the guest's display name, which is their identity), and
 * never touch the therapist.
 */
export async function removeParticipantByUid(room: string, uid: string, fallbackName?: string): Promise<number> {
  const svc = roomService()
  if (!svc) {
    console.warn('[livekit-room] LIVEKIT_URL not set — cannot remove participant from the call')
    return 0
  }
  const people = await svc.listParticipants(room)
  let matches = people.filter((p) => p.attributes?.uid === uid)
  if (matches.length === 0 && fallbackName) {
    matches = people.filter((p) => !p.attributes?.uid && p.identity === fallbackName && p.attributes?.role !== 'therapist')
  }
  await Promise.all(matches.map((p) => svc.removeParticipant(room, p.identity)))
  return matches.length
}
