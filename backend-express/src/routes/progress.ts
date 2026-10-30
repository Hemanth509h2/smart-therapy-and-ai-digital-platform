import { Router } from 'express';
import { prisma } from '@/lib/core/db';
import { requireTherapist } from '@/lib/http/progressAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';
import { handle, queryParams, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/progress/metrics -----------------------------------------------------

// GET /api/progress/metrics?clientId=xxx&metricType=MOOD_SCORE&from=ISO&to=ISO
// Fetches a client's progress metrics (optionally filtered), newest first.
router.get('/progress/metrics', handle(async (req, res) => {
  const auth = await requireTherapist(req);
  if (!auth.ok) return send(res, auth.response);

  try {
    const searchParams = queryParams(req);
    const clientId = searchParams.get('clientId');
    const metricType = searchParams.get('metricType');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!clientId) {
      return res.status(400).json({ error: 'Choose a client to see their progress metrics.' });
    }

    const metrics = await prisma.progressMetric.findMany({
      where: {
        clientId,
        // Therapists may only see metrics they themselves recorded unless
        // they're viewing a shared client roster — narrow to this therapist
        // for privacy by default.
        therapistId: auth.therapist.id,
        ...(metricType ? { metricType } : {}),
        ...(from || to
          ? {
              recordedAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { recordedAt: 'asc' },
    });

    return res.json({ metrics });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Progress metrics GET error'));
  }
}));

// POST /api/progress/metrics
// Body: { clientId, sessionId?, metricType, value, unit?, notes?, recordedAt? }
// Creates a single progress metric entry for a client.
router.post('/progress/metrics', handle(async (req, res) => {
  const auth = await requireTherapist(req);
  if (!auth.ok) return send(res, auth.response);
  const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'record progress metrics');
  if (noPlan) return send(res, noPlan);

  try {
    const body = req.body;
    const { clientId, sessionId, metricType, value, unit, notes, recordedAt } = body || {};

    if (!clientId || !metricType || value === undefined || value === null) {
      return res.status(400).json({ error: 'Choose a metric and enter a value.' });
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return res.status(400).json({ error: 'The value must be a number.' });
    }

    const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
    if (!client) {
      return res.status(404).json({ error: "We couldn't find that client. They may have been removed." });
    }

    const metric = await prisma.progressMetric.create({
      data: {
        clientId,
        therapistId: auth.therapist.id,
        sessionId: sessionId || null,
        metricType,
        value,
        unit: unit || null,
        notes: notes || null,
        recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
      },
    });

    return res.status(201).json({ metric });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Progress metrics POST error'));
  }
}));

// ---- /api/progress/metrics/:id -------------------------------------------------

// PATCH /api/progress/metrics/[id]
// Body: any subset of { value, unit, notes, metricType, recordedAt }
// Updates an existing progress metric. Only the therapist who recorded it
// may edit it.
router.patch('/progress/metrics/:id', handle(async (req, res) => {
  const auth = await requireTherapist(req);
  if (!auth.ok) return send(res, auth.response);
  const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'edit progress metrics');
  if (noPlan) return send(res, noPlan);

  try {
    const { id } = req.params;
    const existing = await prisma.progressMetric.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "We couldn't find that progress entry. It may have been deleted." });
    }
    if (existing.therapistId !== auth.therapist.id) {
      return send(res, notYourProfile('this progress entry'));
    }

    const body = req.body;
    const { value, unit, notes, metricType, recordedAt } = body || {};

    if (value !== undefined && (typeof value !== 'number' || Number.isNaN(value))) {
      return res.status(400).json({ error: 'The value must be a number.' });
    }

    const metric = await prisma.progressMetric.update({
      where: { id },
      data: {
        ...(value !== undefined ? { value } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(metricType !== undefined ? { metricType } : {}),
        ...(recordedAt !== undefined ? { recordedAt: new Date(recordedAt) } : {}),
      },
    });

    return res.json({ metric });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Progress metrics PATCH error'));
  }
}));

// DELETE /api/progress/metrics/[id]
router.delete('/progress/metrics/:id', handle(async (req, res) => {
  const auth = await requireTherapist(req);
  if (!auth.ok) return send(res, auth.response);
  const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'delete progress metrics');
  if (noPlan) return send(res, noPlan);

  try {
    const { id } = req.params;
    const existing = await prisma.progressMetric.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "We couldn't find that progress entry. It may have been deleted." });
    }
    if (existing.therapistId !== auth.therapist.id) {
      return send(res, notYourProfile('this progress entry'));
    }

    await prisma.progressMetric.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Progress metrics DELETE error'));
  }
}));

// ---- /api/progress/notes -------------------------------------------------------

// GET /api/progress/notes?clientId=xxx&reportId=yyy
router.get('/progress/notes', handle(async (req, res) => {
  const auth = await requireTherapist(req);
  if (!auth.ok) return send(res, auth.response);

  try {
    const searchParams = queryParams(req);
    const clientId = searchParams.get('clientId');
    const reportId = searchParams.get('reportId');

    if (!clientId) {
      return res.status(400).json({ error: 'Choose a client to see their progress notes.' });
    }

    const notes = await prisma.progressNote.findMany({
      where: {
        clientId,
        therapistId: auth.therapist.id,
        ...(reportId ? { reportId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ notes });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Progress notes GET error'));
  }
}));

// POST /api/progress/notes
// Body: { clientId, content, reportId?, isPrivate? }
router.post('/progress/notes', handle(async (req, res) => {
  const auth = await requireTherapist(req);
  if (!auth.ok) return send(res, auth.response);
  const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'save progress notes');
  if (noPlan) return send(res, noPlan);

  try {
    const body = req.body;
    const { clientId, content, reportId, isPrivate } = body || {};

    if (!clientId || !content) {
      return res.status(400).json({ error: "The note can't be empty. Write something and save again." });
    }

    const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
    if (!client) {
      return res.status(404).json({ error: "We couldn't find that client. They may have been removed." });
    }

    const note = await prisma.progressNote.create({
      data: {
        clientId,
        therapistId: auth.therapist.id,
        reportId: reportId || null,
        content,
        isPrivate: isPrivate === false ? false : true,
      },
    });

    return res.status(201).json({ note });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Progress notes POST error'));
  }
}));

// ---- /api/progress/reports -----------------------------------------------------

// GET /api/progress/reports?clientId=xxx
router.get('/progress/reports', handle(async (req, res) => {
  const auth = await requireTherapist(req);
  if (!auth.ok) return send(res, auth.response);

  try {
    const searchParams = queryParams(req);
    const clientId = searchParams.get('clientId');
    if (!clientId) {
      return res.status(400).json({ error: 'Choose a client to see their progress reports.' });
    }

    const reports = await prisma.progressReport.findMany({
      where: { clientId, therapistId: auth.therapist.id },
      include: { progressNotes: true },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ reports });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Progress reports GET error'));
  }
}));

// POST /api/progress/reports
// Body: { clientId, title?, periodStart, periodEnd, summary, status? }
// Creates a progress report. Automatically snapshots the client's metrics
// recorded by this therapist within [periodStart, periodEnd].
router.post('/progress/reports', handle(async (req, res) => {
  const auth = await requireTherapist(req);
  if (!auth.ok) return send(res, auth.response);
  const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'save progress reports');
  if (noPlan) return send(res, noPlan);

  try {
    const body = req.body;
    const { clientId, title, periodStart, periodEnd, summary, status } = body || {};

    if (!clientId || !periodStart || !periodEnd || !summary) {
      return res.status(400).json({ error: 'Choose the start and end dates and write a summary for the report.' });
    }

    const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
    if (!client) {
      return res.status(404).json({ error: "We couldn't find that client. They may have been removed." });
    }

    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const metricsInPeriod = await prisma.progressMetric.findMany({
      where: {
        clientId,
        therapistId: auth.therapist.id,
        recordedAt: { gte: start, lte: end },
      },
    });

    // Aggregate: average value per metricType, plus count of entries.
    const snapshot: Record<string, { average: number; count: number }> = {};
    for (const m of metricsInPeriod) {
      if (!snapshot[m.metricType]) snapshot[m.metricType] = { average: 0, count: 0 };
      snapshot[m.metricType].average =
        (snapshot[m.metricType].average * snapshot[m.metricType].count + m.value) /
        (snapshot[m.metricType].count + 1);
      snapshot[m.metricType].count += 1;
    }

    const report = await prisma.progressReport.create({
      data: {
        clientId,
        therapistId: auth.therapist.id,
        title: title || 'Progress Report',
        periodStart: start,
        periodEnd: end,
        summary,
        status: status === 'FINAL' ? 'FINAL' : 'DRAFT',
        metricsSnapshot: snapshot,
      },
    });

    return res.status(201).json({ report });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Progress reports POST error'));
  }
}));
