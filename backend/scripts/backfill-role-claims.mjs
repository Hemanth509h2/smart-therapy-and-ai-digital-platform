// Backfills the `role` Firebase custom claim for every existing user.
//
// MUST BE RUN BEFORE the tightened firestore.rules go live. The
// `patients/{uid}` rule authorises therapists via `request.auth.token.role`,
// and no existing account has that claim — it was introduced alongside these
// rules. Without a backfill, every therapist loses access to patient quests.
//
// Claims only reach the browser when the ID token refreshes (on re-login, or
// within an hour as tokens expire), so run this WELL AHEAD of the rules
// deployment, not at the same moment.
//
// Idempotent: re-running only rewrites claims that differ.
//
//   node --env-file=.env scripts/backfill-role-claims.mjs [--dry-run]

import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { PrismaClient } from '@prisma/client'

const dryRun = process.argv.includes('--dry-run')

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
})
const auth = getAuth(app)
const prisma = new PrismaClient()

const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } })
console.log(`${users.length} users in Postgres${dryRun ? ' (dry run)' : ''}`)

let set = 0
let skipped = 0
let missing = 0

for (const u of users) {
  try {
    const record = await auth.getUser(u.id)
    if (record.customClaims?.role === u.role) {
      skipped++
      continue
    }
    if (!dryRun) {
      // Preserve any other claims already on the account.
      await auth.setCustomUserClaims(u.id, { ...(record.customClaims ?? {}), role: u.role })
    }
    console.log(`  ${dryRun ? 'would set' : 'set'} role=${u.role} for ${u.email}`)
    set++
  } catch (e) {
    // A Postgres user with no Firebase account — orphaned signup. Reported,
    // not fatal: it cannot authenticate, so it is not a security hole.
    if (e.code === 'auth/user-not-found') {
      console.warn(`  no Firebase account for ${u.email} (${u.id})`)
      missing++
    } else {
      console.error(`  FAILED for ${u.email}:`, e.message)
    }
  }
}

console.log(`\ndone — ${set} ${dryRun ? 'to update' : 'updated'}, ${skipped} already correct, ${missing} missing`)
await prisma.$disconnect()
