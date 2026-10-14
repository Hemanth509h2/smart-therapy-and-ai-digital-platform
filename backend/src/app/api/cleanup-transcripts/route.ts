import { NextRequest, NextResponse } from 'next/server'
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { prisma } from '@/lib/db'
import { getSetting } from '@/lib/settings'

export const dynamic = 'force-dynamic'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

const JOB = 'cleanup-transcripts'

// Clears live-session transcripts older than the admin retention window
// (setting 'retention.transcriptHours', default 24). Called by Vercel cron
// (Authorization: Bearer <CRON_SECRET>) or manually with x-cron-secret.
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const secret = req.headers.get('x-cron-secret') || bearer
  if (!expected || secret !== expected) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const run = await prisma.cronRun.create({ data: { job: JOB, ok: false } }).catch(() => null)
  const finish = (ok: boolean, detail: Record<string, unknown>) =>
    run
      ? prisma.cronRun
          .update({ where: { id: run.id }, data: { ok, detail: detail as any, finishedAt: new Date() } })
          .catch((e) => console.error('[cleanup-transcripts] could not record run:', e?.message))
      : Promise.resolve()

  try {
    const hours = Math.max(1, Number(await getSetting('retention.transcriptHours')) || 24)
    const db = getFirestore()
    const cutoff = Timestamp.fromDate(new Date(Date.now() - hours * 60 * 60 * 1000))

    const stale = await db
      .collection('sessions')
      .where('transcriptLastUpdated', '<', cutoff)
      .get()

    // Firestore batches hold at most 500 writes.
    let deleted = 0
    for (let i = 0; i < stale.docs.length; i += 400) {
      const batch = db.batch()
      for (const docSnap of stale.docs.slice(i, i + 400)) {
        batch.update(docSnap.ref, {
          transcript: [],
          transcriptLastUpdated: null,
        })
        deleted++
      }
      await batch.commit()
    }

    const result = {
      success: true,
      sessionsCleared: deleted,
      retentionHours: hours,
      cutoff: cutoff.toDate().toISOString(),
    }
    await finish(true, result)
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[cleanup-transcripts]', e)
    await finish(false, { error: e?.message || String(e) })
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
