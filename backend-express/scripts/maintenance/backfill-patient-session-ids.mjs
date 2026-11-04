// Backfills `sessionId` on existing Firestore `patients/{uid}` documents.
//
// Run BEFORE deploying the firestore.rules that authorise therapists on
// patients/{uid} through a shared session. Those rules let a therapist read a
// patient document only when its `sessionId` names a live session whose
// allowedUids contains both of them. Documents written before that change have
// no `sessionId`, so without this backfill the therapist's first load in the
// next session finds nothing, and the board's first save then overwrites the
// saved quests with that session's list.
//
// For each patients/{uid} document without a sessionId, this picks the
// client's most recent session in Postgres (ProfileClient.userId == uid) that
// has a liveSessions document, and writes its id. Documents of guests
// (anonymous uids, which are not in Postgres) are reported and left alone.
//
// Idempotent; documents that already have a sessionId are skipped.
//
//   node --env-file=.env scripts/maintenance/backfill-patient-session-ids.mjs [--dry-run]

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { PrismaClient } from '@prisma/client'

const dryRun = process.argv.includes('--dry-run')

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
})
const db = getFirestore(app)
const prisma = new PrismaClient() // HIPAA database (DATABASE_URL_2)

const docs = await db.collection('patients').get()
console.log(`${docs.size} patient documents${dryRun ? ' (dry run)' : ''}`)

let updated = 0
let already = 0
let noSession = 0

for (const snap of docs.docs) {
  if (snap.get('sessionId')) {
    already++
    continue
  }
  const sessions = await prisma.session.findMany({
    where: { client: { userId: snap.id } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
    take: 20,
  })
  let sessionId = null
  for (const s of sessions) {
    const live = await db.collection('liveSessions').doc(s.id).get()
    if (live.exists && (live.get('allowedUids') ?? []).includes(snap.id)) {
      sessionId = s.id
      break
    }
  }
  if (!sessionId) {
    noSession++
    console.log(`  no live session for ${snap.id} (guest or never joined); left as is`)
    continue
  }
  if (!dryRun) await snap.ref.set({ sessionId }, { merge: true })
  updated++
}

console.log(`updated ${updated}, already set ${already}, without a session ${noSession}`)
await prisma.$disconnect()
