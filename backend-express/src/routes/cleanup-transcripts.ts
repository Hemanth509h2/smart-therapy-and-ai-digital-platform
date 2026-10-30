import { Router } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { appDb } from '@/lib/core/db';
import { getSetting } from '@/lib/core/settings';
import { adminDb } from '@/lib/core/firebaseAdmin';
import { handle } from '@/lib/http/reply';

export const router = Router();

// ---- /api/cleanup-transcripts --------------------------------------------------

const JOB = 'cleanup-transcripts'

// Clears live-session transcripts older than the admin retention window
// (setting 'retention.transcriptHours', default 24). Called by Vercel cron
// (Authorization: Bearer <CRON_SECRET>) or manually with x-cron-secret.
router.get('/cleanup-transcripts', handle(async (req, res) => {
  const expected = process.env.CRON_SECRET
  const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  const secret = req.get('x-cron-secret') || bearer
  if (!expected || secret !== expected) {
    return res.status(401).json({ error: 'Only the scheduled cleanup job can run this.' })
  }

  const run = await appDb.cronRun.create({ data: { job: JOB, ok: false } }).catch(() => null)
  const finish = (ok: boolean, detail: Record<string, unknown>) =>
    run
      ? appDb.cronRun
          .update({ where: { id: run.id }, data: { ok, detail: detail as any, finishedAt: new Date() } })
          .catch((e) => console.error('[cleanup-transcripts] could not record run:', e?.message))
      : Promise.resolve()

  try {
    const hours = Math.max(1, Number(await getSetting('retention.transcriptHours')) || 24)
    const db = adminDb()
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
          captions: [],
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
    return res.json(result)
  } catch (e: any) {
    console.error('[cleanup-transcripts]', e)
    await finish(false, { error: e?.message || String(e) })
    return res.status(500).json({ error: 'Transcript cleanup failed. It will run again on the next schedule.' })
  }
}));
