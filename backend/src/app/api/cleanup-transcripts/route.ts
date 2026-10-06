import { NextRequest, NextResponse } from 'next/server'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const db = getFirestore()
  const cutoff = Timestamp.fromDate(
    new Date(Date.now() - 24 * 60 * 60 * 1000)
  )

  const stale = await db
    .collection('sessions')
    .where('transcriptLastUpdated', '<', cutoff)
    .get()

  let deleted = 0
  const batch = db.batch()

  stale.docs.forEach(docSnap => {
    batch.update(docSnap.ref, {
      transcript: [],
      transcriptLastUpdated: null,
    })
    deleted++
  })

  await batch.commit()

  return NextResponse.json({
    success: true,
    sessionsCleared: deleted,
    cutoff: cutoff.toDate().toISOString(),
  })
}
