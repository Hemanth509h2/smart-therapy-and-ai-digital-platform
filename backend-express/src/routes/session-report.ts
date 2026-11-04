import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/db';
import { therapistIdForUser } from '@/lib/core/links';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { requireAuth } from '@/lib/http/apiAuth';
import { requireTherapist } from '@/lib/http/progressAuth';
import { checkAIConsent } from '@/lib/sessions/transcript-store';
import { deliver, notify } from '@/lib/email/notify';
import { reportReadyEmail } from '@/lib/email/templates';
import { emailForUser } from '@/lib/email/recipients';
import { generateSessionReport } from '@/lib/reports/generate';
import { getReportStats } from '@/lib/reports/session-data';
import { errorResponse } from '@/lib/http/apiError';
import { handle, queryParams, send } from '@/lib/http/reply';
import { rejectIfLimited } from '@/lib/http/rateLimit';

export const router = Router();

// ---- /api/session-report -------------------------------------------------------

function ageFrom(dob: Date | null | undefined): number | undefined {
  if (!dob) return undefined
  const diff = Date.now() - new Date(dob).getTime()
  return Math.max(0, Math.floor(diff / (365.25 * 24 * 3600 * 1000)))
}


// Fetch the stored report for a session. Readable by the therapist who owns the
// session, or by the session's own client once the therapist has released it
// (visibleToClient). A missing report and one the caller may not see both
// return { report: null, stats: null }, so session IDs cannot be probed.
router.get('/session-report', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req)
    if (!auth.ok) return send(res, auth.response)

    const sessionId = queryParams(req).get('sessionId')
    if (!sessionId) {
      return res.status(400).json({ error: "We couldn't tell which session this is for. Refresh the page and try again." })
    }

    const [user, therapistId] = await Promise.all([
      prisma.user.findUnique({
        where: { id: auth.uid },
        select: { role: true, client: { select: { id: true } } },
      }),
      therapistIdForUser(auth.uid),
    ])

    let where: Prisma.SessionReportWhereInput
    if (user?.role === 'THERAPIST' && therapistId) {
      where = { sessionId, session: { therapistId } }
    } else if (user?.role === 'CLIENT' && user.client) {
      where = { sessionId, visibleToClient: true, session: { clientId: user.client.id } }
    } else {
      return res.status(403).json({ error: "Only the session's therapist or client can view this report." })
    }

    const report = await prisma.sessionReport.findFirst({ where })
    // Stats live on the Firestore session doc, saved when the report was generated.
    const stats = report ? await getReportStats(sessionId) : null
    return res.json({ report, stats })
  } catch (e: any) {
    return send(res, errorResponse(e, 'session-report get'))
  }
}));

// Generate (or regenerate) the report for a session, then persist it.
// Only the therapist who owns the session may do this.
router.post('/session-report', handle(async (req, res) => {
  try {
    const auth = await requireTherapist(req)
    if (!auth.ok) return send(res, auth.response)
    // Each generation is a long LLM request.
    if (await rejectIfLimited(res, { name: 'session-report', limit: 20, windowMs: 60 * 60 * 1000 }, auth.uid,
      'You have generated many reports in the last hour. Wait a little and try again.')) return

    const { sessionId } = req.body
    if (!sessionId) {
      return res.status(400).json({ error: "We couldn't tell which session this is for. Refresh the page and try again." })
    }

    // Not-owned and non-existent sessions are indistinguishable (both 404).
    const session = await prisma.session.findFirst({
      where: { id: sessionId, therapistId: auth.therapist.id },
      include: { client: true },
    })
    if (!session) {
      return res.status(404).json({ error: 'This session no longer exists. It may have been deleted.' })
    }
    const noPlan = await requireActivePlan({ therapistId: session.therapistId }, 'generate a session report')
    if (noPlan) return send(res, noPlan)

    // The report sends the session's notes, activity and transcript to a
    // third-party LLM, so it needs the same consent as the in-call AI features:
    // both the therapist and the client agreed at the start of the session.
    // Same dev-only bypass as /api/ai-insight, never in production.
    const sttTestMode =
      process.env.NEXT_PUBLIC_STT_TEST_MODE === 'true' &&
      process.env.NODE_ENV !== 'production'
    if (!sttTestMode && !(await checkAIConsent(sessionId))) {
      return res.status(403).json({
        error: "An AI report needs both you and the client to have allowed AI features for this session. You can still write your own notes.",
      })
    }

    const priorCount = await prisma.session.count({
      where: {
        therapistId: session.therapistId,
        clientId: session.clientId,
        createdAt: { lte: session.createdAt },
      },
    })

    const { content, model, stats } = await generateSessionReport(sessionId, {
      // First name only: the model doesn't need the client's full name.
      name: session.client.firstName.trim(),
      age: ageFrom(session.client.dateOfBirth),
      conditions: session.client.diagnosis,
      sessionNumber: priorCount,
    })

    const report = await prisma.sessionReport.upsert({
      where: { sessionId },
      create: {
        sessionId,
        therapistId: session.therapistId,
        clientId: session.clientId,
        content,
        model,
      },
      update: {
        content,
        model,
        aiGenerated: true,
        editedByTherapist: false,
        editedAt: null,
        generatedAt: new Date(),
      },
    })

    // Usually requested as the call ends (keepalive), so the therapist may
    // have left the page: tell them the draft is waiting.
    await deliver(notify('sessions', await emailForUser(auth.uid), reportReadyEmail({
      firstName: auth.therapist.firstName,
      sessionDate: session.startedAt ?? session.scheduledAt,
    })))

    return res.json({ report, stats })
  } catch (e: any) {
    return send(res, errorResponse(e, 'session-report generate', "We couldn't generate the report. Please try again."))
  }
}));

// Save the therapist's edits to the report body. Only the therapist who owns
// the session may do this.
router.patch('/session-report', handle(async (req, res) => {
  try {
    const auth = await requireTherapist(req)
    if (!auth.ok) return send(res, auth.response)

    const { sessionId, content } = req.body
    if (!sessionId || typeof content !== 'string') {
      return res.status(400).json({ error: "The report can't be empty. Add some text and save again." })
    }
    if (content.length > 100_000) {
      return res.status(400).json({ error: 'The report is too long (at most 100,000 characters).' })
    }
    const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'edit session reports')
    if (noPlan) return send(res, noPlan)
    // Ownership is part of the update's filter, so a report on another
    // therapist's session can never be written. A missing or non-owned report
    // fails with P2025, which errorResponse maps to the same 404.
    const report = await prisma.sessionReport.update({
      where: { sessionId, session: { therapistId: auth.therapist.id } },
      data: { content, editedByTherapist: true, editedAt: new Date() },
    })
    return res.json({ report })
  } catch (e: any) {
    return send(res, errorResponse(e, 'session-report save', "We couldn't save the report. Please try again."))
  }
}));
