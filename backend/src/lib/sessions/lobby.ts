import { adminDb } from '@/lib/core/firebaseAdmin'

// Waiting room for guests who join through an invite link. They wait here until
// the therapist admits them; only then are they added to the session's
// allowedUids (Firestore access) and given a LiveKit token.
//
// Stored at liveSessions/{sessionId}/lobby/{uid}. No security rule matches that
// path, so browsers can neither read nor write it: only the server (Admin SDK)
// does, which is what stops a guest from admitting themselves.

export type LobbyStatus = 'waiting' | 'admitted' | 'denied'

export interface LobbyEntry {
  uid: string
  name: string
  status: LobbyStatus
  requestedAt: string
  lastSeen: string
}

// The guest's page knocks every few seconds; anyone not seen for this long has
// closed the tab and is no longer shown to the therapist.
const STALE_MS = 15_000

function entryRef(sessionId: string, uid: string) {
  return adminDb().collection('liveSessions').doc(sessionId).collection('lobby').doc(uid)
}

export async function getLobbyEntry(sessionId: string, uid: string): Promise<LobbyEntry | null> {
  const snap = await entryRef(sessionId, uid).get()
  return snap.exists ? (snap.data() as LobbyEntry) : null
}

export async function createLobbyEntry(sessionId: string, uid: string, name: string): Promise<void> {
  const now = new Date().toISOString()
  await entryRef(sessionId, uid).set({ uid, name, status: 'waiting', requestedAt: now, lastSeen: now })
}

export async function touchLobbyEntry(sessionId: string, uid: string): Promise<void> {
  await entryRef(sessionId, uid).update({ lastSeen: new Date().toISOString() })
}

export async function setLobbyStatus(sessionId: string, uid: string, status: LobbyStatus): Promise<void> {
  await entryRef(sessionId, uid).update({ status })
}

export async function listWaiting(sessionId: string): Promise<Pick<LobbyEntry, 'uid' | 'name' | 'requestedAt'>[]> {
  const snap = await adminDb()
    .collection('liveSessions')
    .doc(sessionId)
    .collection('lobby')
    .where('status', '==', 'waiting')
    .get()
  const cutoff = Date.now() - STALE_MS
  return snap.docs
    .map((d) => d.data() as LobbyEntry)
    .filter((e) => Date.parse(e.lastSeen) >= cutoff)
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
    .map(({ uid, name, requestedAt }) => ({ uid, name, requestedAt }))
}
