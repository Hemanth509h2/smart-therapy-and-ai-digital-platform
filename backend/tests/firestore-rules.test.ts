/**
 * Firestore security rules — emulator test suite.
 *
 * Runs against the Firestore emulator, never production:
 *   npm run test:rules
 *
 * Covers every collection the app touches (liveSessions, sessions,
 * sessions/rawSessionLog, moduleStates, patients) plus the default-deny
 * catch-all, from the perspective of each actor: the therapist and client of a
 * session, an unrelated authenticated user, and an anonymous visitor.
 *
 * The single most important assertions are the OUTSIDER cases. Under the old
 * catch-all rule (`allow read, write: if request.auth != null`) every one of
 * them PASSED, which is precisely the vulnerability being closed.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore'

const PROJECT_ID = 'staad-rules-test'

// Session ids are UUIDs in production (Prisma @default(uuid())), so they never
// contain an underscore — which is what makes the moduleStates docId split safe.
const SESSION = '11111111-2222-4333-8444-555555555555'
const THERAPIST = 'uid-therapist'
const CLIENT = 'uid-client'
const OUTSIDER = 'uid-outsider'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  // Seed as the server would (Admin SDK bypasses rules, same as production).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'liveSessions', SESSION), {
      sessionId: SESSION,
      allowedUids: [THERAPIST, CLIENT],
      activeModuleId: null,
      participants: {},
    })
    await setDoc(doc(db, 'sessions', SESSION), { sessionId: SESSION, aiConsent: {} })
    await setDoc(doc(db, 'moduleStates', `${SESSION}_worry-vault`), { state: {} })
    await setDoc(doc(db, 'patients', CLIENT), { quests: [] })
  })
})

const therapistDb = () =>
  testEnv.authenticatedContext(THERAPIST, { role: 'THERAPIST' }).firestore()
const clientDb = () =>
  testEnv.authenticatedContext(CLIENT, { role: 'CLIENT' }).firestore()
const outsiderDb = () =>
  testEnv.authenticatedContext(OUTSIDER, { role: 'CLIENT' }).firestore()
const outsiderTherapistDb = () =>
  testEnv.authenticatedContext(OUTSIDER, { role: 'THERAPIST' }).firestore()
const anonDb = () => testEnv.unauthenticatedContext().firestore()

describe('liveSessions', () => {
  it('lets an entitled therapist read the room', async () => {
    await assertSucceeds(getDoc(doc(therapistDb(), 'liveSessions', SESSION)))
  })

  it('lets an entitled client read the room', async () => {
    await assertSucceeds(getDoc(doc(clientDb(), 'liveSessions', SESSION)))
  })

  it('DENIES an unrelated authenticated user (old rules allowed this)', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'liveSessions', SESSION)))
  })

  it('DENIES an anonymous visitor', async () => {
    await assertFails(getDoc(doc(anonDb(), 'liveSessions', SESSION)))
  })

  it('lets a participant update room state', async () => {
    await assertSucceeds(
      updateDoc(doc(therapistDb(), 'liveSessions', SESSION), { activeModuleId: 'worry-vault' })
    )
  })

  it('lets a participant register themselves in participants', async () => {
    await assertSucceeds(
      updateDoc(doc(clientDb(), 'liveSessions', SESSION), {
        [`participants.${CLIENT}`]: { uid: CLIENT, role: 'client', isOnline: true },
      })
    )
  })

  it('DENIES an outsider writing room state', async () => {
    await assertFails(
      updateDoc(doc(outsiderDb(), 'liveSessions', SESSION), { activeModuleId: 'hijack' })
    )
  })

  it('DENIES a participant escalating their own entitlement', async () => {
    // The circularity guard: if this passed, allowedUids would be self-issued.
    await assertFails(
      updateDoc(doc(therapistDb(), 'liveSessions', SESSION), {
        allowedUids: [THERAPIST, CLIENT, OUTSIDER],
      })
    )
  })

  it('DENIES client-side creation of a new room', async () => {
    await assertFails(
      setDoc(doc(therapistDb(), 'liveSessions', 'invented-session'), {
        allowedUids: [THERAPIST],
      })
    )
  })

  it('DENIES deletion', async () => {
    await assertFails(deleteDoc(doc(therapistDb(), 'liveSessions', SESSION)))
  })

  it('DENIES access when the room has no allowedUids (fails closed)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'liveSessions', 'legacy'), { sessionId: 'legacy' })
    })
    await assertFails(getDoc(doc(therapistDb(), 'liveSessions', 'legacy')))
  })
})

describe('sessions', () => {
  it('lets both participants read the session record', async () => {
    await assertSucceeds(getDoc(doc(therapistDb(), 'sessions', SESSION)))
    await assertSucceeds(getDoc(doc(clientDb(), 'sessions', SESSION)))
  })

  it('DENIES an outsider reading the transcript and consent state', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'sessions', SESSION)))
  })

  it('DENIES an outsider with a THERAPIST claim (role alone is not entitlement)', async () => {
    await assertFails(getDoc(doc(outsiderTherapistDb(), 'sessions', SESSION)))
  })

  it('lets a participant record consent', async () => {
    await assertSucceeds(
      updateDoc(doc(clientDb(), 'sessions', SESSION), { 'aiConsent.client': true })
    )
  })

  it('lets a participant append a transcript chunk', async () => {
    await assertSucceeds(
      updateDoc(doc(therapistDb(), 'sessions', SESSION), {
        transcript: [{ text: 'hello', speaker: 'therapist' }],
      })
    )
  })

  it('DENIES an outsider writing consent on behalf of the client', async () => {
    await assertFails(
      updateDoc(doc(outsiderDb(), 'sessions', SESSION), { 'aiConsent.client': true })
    )
  })

  it('DENIES deletion', async () => {
    await assertFails(deleteDoc(doc(therapistDb(), 'sessions', SESSION)))
  })
})

describe('sessions/{id}/rawSessionLog — the session diary', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    timestamp: serverTimestamp(),
    type: 'attention',
    value: 87,
    ...over,
  })

  it('lets the therapist append an attention score', async () => {
    await assertSucceeds(
      addDoc(collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'), entry())
    )
  })

  it('lets participants read the diary back', async () => {
    await assertSucceeds(getDoc(doc(clientDb(), 'sessions', SESSION, 'rawSessionLog', 'x')))
  })

  it('DENIES an outsider reading attention scores', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'sessions', SESSION, 'rawSessionLog', 'x')))
  })

  it('DENIES an outsider writing a fabricated score', async () => {
    await assertFails(
      addDoc(collection(outsiderDb(), 'sessions', SESSION, 'rawSessionLog'), entry())
    )
  })

  it('rejects an out-of-range attention score', async () => {
    await assertFails(
      addDoc(collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'), entry({ value: 101 }))
    )
    await assertFails(
      addDoc(collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'), entry({ value: -1 }))
    )
  })

  it('rejects an attention score that is not an integer', async () => {
    await assertFails(
      addDoc(collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'), entry({ value: 'high' }))
    )
  })

  it('rejects an unknown entry type', async () => {
    await assertFails(
      addDoc(collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'), entry({ type: 'diagnosis' }))
    )
  })

  it('rejects extra fields smuggled into an entry', async () => {
    await assertFails(
      addDoc(
        collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'),
        entry({ rawFrame: 'base64...' })
      )
    )
  })

  it('accepts a transcript entry (forward-compatible with the deferred dual-write)', async () => {
    await assertSucceeds(
      addDoc(
        collection(therapistDb(), 'sessions', SESSION, 'rawSessionLog'),
        entry({ type: 'transcript', value: 'the client said hello' })
      )
    )
  })

  it('is append-only — no edits or deletes, even by a participant', async () => {
    let id = ''
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(
        collection(ctx.firestore(), 'sessions', SESSION, 'rawSessionLog'),
        { timestamp: serverTimestamp(), type: 'attention', value: 50 }
      )
      id = ref.id
    })
    await assertFails(
      updateDoc(doc(therapistDb(), 'sessions', SESSION, 'rawSessionLog', id), { value: 100 })
    )
    await assertFails(deleteDoc(doc(therapistDb(), 'sessions', SESSION, 'rawSessionLog', id)))
  })
})

describe('moduleStates', () => {
  const stateId = `${SESSION}_worry-vault`

  it('lets participants read and write shared module state', async () => {
    await assertSucceeds(getDoc(doc(clientDb(), 'moduleStates', stateId)))
    await assertSucceeds(
      setDoc(doc(therapistDb(), 'moduleStates', stateId), { state: { step: 2 } }, { merge: true })
    )
  })

  it('DENIES an outsider reading module state', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'moduleStates', stateId)))
  })

  it('DENIES an outsider writing module state', async () => {
    await assertFails(
      setDoc(doc(outsiderDb(), 'moduleStates', stateId), { state: { hijacked: true } })
    )
  })

  it('DENIES a docId whose session prefix does not exist', async () => {
    await assertFails(getDoc(doc(therapistDb(), 'moduleStates', 'no-such-session_worry-vault')))
  })

  it('DENIES deletion', async () => {
    await assertFails(deleteDoc(doc(therapistDb(), 'moduleStates', stateId)))
  })
})

describe('patients', () => {
  it('lets the patient read their own quests', async () => {
    await assertSucceeds(getDoc(doc(clientDb(), 'patients', CLIENT)))
  })

  it('lets a therapist read and assign quests', async () => {
    await assertSucceeds(getDoc(doc(therapistDb(), 'patients', CLIENT)))
    await assertSucceeds(
      setDoc(doc(therapistDb(), 'patients', CLIENT), { quests: [{ id: 'q1' }] }, { merge: true })
    )
  })

  it('DENIES another patient reading someone else\'s quests', async () => {
    await assertFails(getDoc(doc(outsiderDb(), 'patients', CLIENT)))
  })

  it('DENIES an anonymous visitor', async () => {
    await assertFails(getDoc(doc(anonDb(), 'patients', CLIENT)))
  })

  it('DENIES a user with no role claim at all (pre-backfill account)', async () => {
    // Documents the backfill dependency: without the claim, a therapist is
    // treated as an unrelated user here.
    const noClaim = testEnv.authenticatedContext('uid-noclaim').firestore()
    await assertFails(getDoc(doc(noClaim, 'patients', CLIENT)))
  })

  it('DENIES deletion', async () => {
    await assertFails(deleteDoc(doc(therapistDb(), 'patients', CLIENT)))
  })
})

describe('default deny', () => {
  it('refuses an unmatched collection even for a signed-in user', async () => {
    await assertFails(getDoc(doc(therapistDb(), 'users', THERAPIST)))
    await assertFails(setDoc(doc(therapistDb(), 'anythingElse', 'x'), { a: 1 }))
  })

  it('refuses the legacy presence collection', async () => {
    await assertFails(getDoc(doc(therapistDb(), 'presence', THERAPIST)))
  })
})
