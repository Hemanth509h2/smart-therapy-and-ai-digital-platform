import { Router } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { appDb, prisma } from '@/lib/core/db';
import { getSetting } from '@/lib/core/settings';
import { adminDb } from '@/lib/core/firebaseAdmin';
import { handle } from '@/lib/http/reply';
import { logError, safeErrorSummary } from '@/lib/http/apiError';
import { hasCronSecret } from '@/lib/http/secrets';
import { alertAdmins } from '@/lib/email/notify';
import { ACCESS_LOG_DAYS } from '@/lib/http/accessLog';
import { jobFailedAlert } from '@/lib/email/alerts';

export const router = Router();

// ---- /api/cleanup-transcripts --------------------------------------------------

const JOB = 'cleanup-transcripts'
const WHATSAPP_LOG_DAYS = 180
const CRON_RUN_DAYS = 90
// Rate-limit windows are at most a day long, so older buckets are dead.
const RATE_LIMIT_BUCKET_DAYS = 2
const DAY_MS = 24 * 60 * 60 * 1000

// The daily retention job. Clears live-session transcripts older than the
// admin retention window (setting 'retention.transcriptHours', default 24; the
// job runs once a day, so a transcript is gone within 24h after that), and
// deletes operational records past the limits in the Privacy Policy
// ("How long we keep information"): WhatsApp delivery records after
// WHATSAPP_LOG_DAYS, the job's own run history after CRON_RUN_DAYS, and the
// security access log after ACCESS_LOG_DAYS (kept at least a year: DPDP Rules).
// Called by Vercel cron (Authorization: Bearer <CRON_SECRET>) or manually with
// x-cron-secret.
router.get('/cleanup-transcripts', handle(async (req, res) => {
  if (!hasCronSecret(req)) {
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

    const [whatsApp, cronRuns, accessLogs, rateLimitBuckets] = await Promise.all([
      prisma.whatsAppMessage.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - WHATSAPP_LOG_DAYS * DAY_MS) } },
      }),
      appDb.cronRun.deleteMany({
        where: { startedAt: { lt: new Date(Date.now() - CRON_RUN_DAYS * DAY_MS) } },
      }),
      prisma.accessLog.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - ACCESS_LOG_DAYS * DAY_MS) } },
      }),
      appDb.rateLimitBucket.deleteMany({
        where: { windowStart: { lt: new Date(Date.now() - RATE_LIMIT_BUCKET_DAYS * DAY_MS) } },
      }),
    ])

    const result = {
      success: true,
      sessionsCleared: deleted,
      whatsAppRecordsDeleted: whatsApp.count,
      cronRunsDeleted: cronRuns.count,
      accessLogsDeleted: accessLogs.count,
      rateLimitBucketsDeleted: rateLimitBuckets.count,
      retentionHours: hours,
      cutoff: cutoff.toDate().toISOString(),
    }
    await finish(true, result)
    return res.json(result)
  } catch (e: any) {
    logError('cleanup-transcripts', e)
    await finish(false, { error: safeErrorSummary(e) })
    await alertAdmins('system', jobFailedAlert({ job: 'cleanup-transcripts (daily data retention)', error: JSON.stringify(safeErrorSummary(e)), at: new Date() }))
    return res.status(500).json({ error: 'Transcript cleanup failed. It will run again on the next schedule.' })
  }
}));
