import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app'
import { prisma } from '@/lib/db'

/**
 * Server-side provisioning of a session's Firestore documents.
 *
 * WHY THIS EXISTS
 * Firestore security rules cannot see Postgres, where session entitlement
 * actually lives (`Session.therapistId` / `Session.clientId`). So the rules
 * authorise against `liveSessions/{id}.allowedUids`, and this module is the
 * ONLY thing permitted to write that field — via the Admin SDK, which bypasses
 * rules.
 *
 * If a browser could write `allowedUids`, it would be granting itself access,
 * and the entire access model would be circular. Hence: clients may not create
 * `liveSessions` or `sessions` documents at all (see firestore.rules), and this
 * runs from the trusted server instead.
 *
 * Idempotent — safe to call on every join.
 */

function adminDb() {
  const app = getApps().length
    ? getApp()
    : initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      })
  return getFirestore(app)
}

export interface ProvisionResult {
  sessionId: string
  allowedUids: string[]
}

/**
 * Resolve the Firebase UIDs entitled to a session and mirror them into
 * Firestore, creating the `liveSessions` and `sessions` documents if absent.
 *
 * Note both profile tables key back to `User.id`, which IS the Firebase Auth
 * UID (see prisma/schema.prisma) — so `userId` is exactly what
 * `request.auth.uid` will hold.
 *
 * `opts.extraUids` adds one-off uids — used by the guest invite flow, where
 * the browser's anonymous Firebase uid is not the guest User row's id. On
 * re-provisioning, uids are UNIONED (not overwritten) so a guest rejoining
 * from a second device (a new anonymous uid) does not lose the first one.
 */
export async function provisionSessionDocs(
  sessionId: string,
  opts?: { extraUids?: string[] }
): Promise<ProvisionResult | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { therapist: true, client: true },
  })
  if (!session) return null

  const allowedUids = [session.therapist.userId, session.client.userId, ...(opts?.extraUids ?? [])].filter(
    (uid): uid is string => typeof uid === 'string' && uid.length > 0
  )
  if (allowedUids.length === 0) return null

  const db = adminDb()

  const liveRef = db.collection('liveSessions').doc(sessionId)
  const liveSnap = await liveRef.get()

  if (!liveSnap.exists) {
    // First join: lay down the full room scaffold. This is the write the client
    // used to perform itself in ensureSessionExists().
    await liveRef.set({
      sessionId,
      allowedUids,
      activeModuleId: null,
      therapistControl: false,
      participants: {},
      timestamps: {
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    })
  } else {
    // Re-provision: assert entitlement ONLY. Touching activeModuleId,
    // participants or whiteboard state here would reset a call in progress —
    // the second participant joining must not kick the first out of a module.
    // Uids are unioned rather than replaced so guest rejoins from other
    // devices (new anonymous uids) keep earlier ones valid.
    await liveRef.update({
      allowedUids: FieldValue.arrayUnion(...allowedUids),
      'timestamps.updatedAt': FieldValue.serverTimestamp(),
    })
  }

  await db
    .collection('sessions')
    .doc(sessionId)
    .set(
      {
        sessionId,
        aiConsent: {},
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    )

  return { sessionId, allowedUids }
}
