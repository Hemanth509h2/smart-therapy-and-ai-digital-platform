import { Router } from 'express';
import { prisma, appDb } from '@/lib/core/db';
import { usersById } from '@/lib/core/links';
import { requireAdmin } from '@/lib/http/apiAuth';
import { startOfMonth } from '@/lib/admin/adminList';
import { getSettings } from '@/lib/core/settings';
import { ALL_MODULE_IDS, moduleName } from '@/lib/modules/modules';
import { minutesBetween, round2, therapistStorage, usageCost, usageRange, usageRates } from '@/lib/admin/usage';
import { errorResponse } from '@/lib/http/apiError';
import { hostStats, remoteHostStats, type ServerReport } from '@/lib/admin/host-stats';
import { handle, queryParams, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/usage ----------------------------------------------------------

const TYPES = ['AI_ANALYSIS', 'TRANSCRIPTION', 'MODULE_LAUNCH'] as const;

// GET /api/admin/usage?range=30d — usage and estimated cost for the platform
// and for every professional (including those with no usage).
//
// What `count` means per UsageEvent type (see where each is logged):
//  - AI_ANALYSIS: one row per live AI insight call (api/ai-insight), count 1.
//  - MODULE_LAUNCH: one row per launch from the session room, count 1; the
//    module id is stored in `label`.
//  - TRANSCRIPTION: one row per session end, count = number of transcript
//    segments (final utterances) written — NOT minutes. Transcription minutes
//    for the cost estimate are therefore the started→ended length of the
//    sessions that logged a TRANSCRIPTION event.
// The rest comes from the tables themselves: video minutes from sessions
// started in the range, AI reports from SessionReport, revenue from PAID Cashfree orders, storage from the size of each
// therapist's rows. Fixed hosting/database bills (Settings) count only in the
// platform totals; a professional's netInr is revenue minus their usage cost.
router.get('/admin/usage', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.read');
    if (!auth.ok) return send(res, auth.response);

    const sp = queryParams(req);
    const { key: rangeKey, days, since, seriesDays, seriesSince } = usageRange(sp);
    const monthStart = startOfMonth();
    const now = new Date();

    // Professionals an admin excluded from usage tracking are left out of
    // every figure; they're listed separately so they can be switched back on.
    const everyone = await appDb.profileTherapist.findMany({ select: { id: true, firstName: true, lastName: true, userId: true, createdAt: true, trackUsage: true } });
    const untrackedIds = everyone.filter((t) => !t.trackUsage).map((t) => t.id);
    const tracked = { therapistId: { notIn: untrackedIds } };

    // Every query starts at once; the two that need another's result chain off
    // it. Patient-side data (sessions, reports, messages, clients) lives in the
    // HIPAA database.
    const transcribedP = appDb.usageEvent.findMany({
      where: { type: 'TRANSCRIPTION', sessionId: { not: null }, createdAt: { gte: since }, ...tracked },
      distinct: ['sessionId'],
      select: { sessionId: true },
    });

    const [
      settings,
      daily,
      totals,
      perTherapist,
      modulesInRange,
      modulesAllTime,
      monthAnalyses,
      therapists,
      users,
      payments,
      subscriptions,
      transcribedSessions,
      heldSessions,
      reports,
      clientCounts,
      storage,
    ] = await Promise.all([
      getSettings(),
      appDb.$queryRaw<{ bucket: Date; type: string; n: number }[]>`
        SELECT date_trunc('day', "createdAt") AS bucket, type, sum(count)::int AS n
        FROM "UsageEvent" WHERE "createdAt" >= ${seriesSince} AND "therapistId" <> ALL(${untrackedIds}::text[])
        GROUP BY 1, 2 ORDER BY 1`,
      appDb.usageEvent.groupBy({ by: ['type'], where: { createdAt: { gte: since }, ...tracked }, _sum: { count: true } }),
      appDb.usageEvent.groupBy({ by: ['therapistId', 'type'], where: { createdAt: { gte: since }, ...tracked }, _sum: { count: true } }),
      appDb.usageEvent.groupBy({
        by: ['label'],
        where: { type: 'MODULE_LAUNCH', createdAt: { gte: since }, label: { not: null }, ...tracked },
        _sum: { count: true },
      }),
      appDb.usageEvent.groupBy({ by: ['label'], where: { type: 'MODULE_LAUNCH', label: { not: null }, ...tracked }, _sum: { count: true } }),
      appDb.usageEvent.groupBy({
        by: ['therapistId'],
        where: { type: 'AI_ANALYSIS', createdAt: { gte: monthStart }, ...tracked },
        _sum: { count: true },
      }),
      everyone.filter((t) => t.trackUsage),
      usersById(everyone.map((t) => t.userId), { email: true, status: true, lastSeenAt: true }),
      appDb.payment.groupBy({
        by: ['therapistId'],
        where: { orderStatus: 'PAID', therapistId: { not: null }, paidAt: { gte: since } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      appDb.subscription.findMany({
        where: { status: 'ACTIVE', currentPeriodEnd: { gt: now } },
        orderBy: { startedAt: 'desc' },
        select: { therapistId: true, plan: { select: { name: true } } },
      }),
      transcribedP.then((rows) =>
        prisma.session.findMany({
          where: { id: { in: rows.map((t) => t.sessionId!) }, startedAt: { not: null }, endedAt: { not: null } },
          select: { therapistId: true, startedAt: true, endedAt: true },
        })
      ),
      prisma.session.findMany({
        where: { startedAt: { gte: since }, endedAt: { not: null } },
        select: { therapistId: true, startedAt: true, endedAt: true },
      }),
      prisma.sessionReport.groupBy({ by: ['therapistId'], where: { aiGenerated: true, generatedAt: { gte: since } }, _count: { _all: true } }),
      // Clients either added directly by the therapist or seen in a session.
      prisma.$queryRaw<{ therapistId: string; n: number }[]>`
        SELECT "therapistId", count(DISTINCT "clientId")::int AS n FROM (
          SELECT "therapistId", "clientId" FROM "Session"
          UNION SELECT "therapistId", id AS "clientId" FROM "ProfileClient" WHERE "therapistId" IS NOT NULL
        ) c GROUP BY 1`,
      therapistStorage(),
    ]);

    let totalMinutes = 0;
    const minutesOf = new Map<string, number>();
    for (const s of transcribedSessions) {
      const m = minutesBetween(s);
      totalMinutes += m;
      minutesOf.set(s.therapistId, (minutesOf.get(s.therapistId) ?? 0) + m);
    }

    const rates = usageRates(settings);
    const threshold = settings['usage.alertMonthlyAnalyses'];

    // Continuous daily series per type (missing days = 0).
    const keyed = new Map(daily.map((r) => [`${r.type}|${new Date(r.bucket).toISOString().slice(0, 10)}`, r.n]));
    const series = Object.fromEntries(
      TYPES.map((type) => [
        type,
        Array.from({ length: seriesDays }, (_, i) => {
          const d = new Date(Date.now() - (seriesDays - 1 - i) * 864e5);
          return {
            label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
            value: keyed.get(`${type}|${d.toISOString().slice(0, 10)}`) ?? 0,
          };
        }),
      ])
    );

    // Per-professional usage for the range. Every therapist gets a row.
    const blank = () => ({
      clients: 0,
      sessions: 0,
      videoMinutes: 0,
      aiAnalyses: 0,
      aiReports: 0,
      transcriptSegments: 0,
      transcriptionMinutes: 0,
      moduleLaunches: 0,
      payments: 0,
      revenueInr: 0,
    });
    const byTherapist = new Map(therapists.map((t) => [t.id, blank()]));
    // Usage can outlive a removed therapist profile in the HIPAA database; skip those rows.
    const row = (id: string | null) => (id ? byTherapist.get(id) : undefined);

    for (const g of perTherapist) {
      const r = row(g.therapistId);
      if (!r) continue;
      const n = g._sum.count ?? 0;
      if (g.type === 'AI_ANALYSIS') r.aiAnalyses += n;
      else if (g.type === 'TRANSCRIPTION') r.transcriptSegments += n;
      else if (g.type === 'MODULE_LAUNCH') r.moduleLaunches += n;
    }
    for (const [id, minutes] of minutesOf) {
      const r = row(id);
      if (r) r.transcriptionMinutes = Math.round(minutes);
    }
    for (const s of heldSessions) {
      const r = row(s.therapistId);
      if (!r) continue;
      r.sessions += 1;
      r.videoMinutes += minutesBetween(s);
    }
    for (const g of reports) {
      const r = row(g.therapistId);
      if (r) r.aiReports = g._count._all;
    }
    for (const g of clientCounts) {
      const r = row(g.therapistId);
      if (r) r.clients = g.n;
    }
    for (const g of payments) {
      const r = row(g.therapistId);
      if (!r) continue;
      r.payments = g._count._all;
      r.revenueInr = round2(Number(g._sum.amount ?? 0));
    }

    const storageOf = new Map<string, number>();
    for (const r of storage) storageOf.set(r.therapistId, (storageOf.get(r.therapistId) ?? 0) + r.bytes);

    const planOf = new Map<string, string>();
    for (const s of subscriptions) if (!planOf.has(s.therapistId)) planOf.set(s.therapistId, s.plan.name);

    const professionals = therapists
      .map((t) => {
        const r = byTherapist.get(t.id)!;
        const videoMinutes = Math.round(r.videoMinutes);
        const { cost, estCostInr } = usageCost({ ...r, videoMinutes }, rates);
        const user = users.get(t.userId);
        return {
          therapistId: t.id,
          name: `${t.firstName} ${t.lastName}`.trim() || 'Unnamed',
          email: user?.email ?? null,
          status: user?.status ?? null,
          lastSeenAt: user?.lastSeenAt ?? null,
          joinedAt: t.createdAt,
          plan: planOf.get(t.id) ?? null,
          ...r,
          storageBytes: storageOf.get(t.id) ?? 0,
          videoMinutes,
          cost,
          estCostInr,
          netInr: round2(r.revenueInr - estCostInr),
        };
      })
      .sort((a, b) => b.estCostInr - a.estCostInr || b.sessions - a.sessions || a.name.localeCompare(b.name));

    const sum = (pick: (p: (typeof professionals)[number]) => number) => round2(professionals.reduce((a, p) => a + pick(p), 0));
    const sumOf = (type: string) => totals.find((t) => t.type === type)?._sum.count ?? 0;
    const transcriptionMinutes = Math.round(totalMinutes);
    const aiAnalyses = sumOf('AI_ANALYSIS');
    const videoMinutes = sum((p) => p.videoMinutes);
    const aiReports = sum((p) => p.aiReports);

    const costTotals = {
      aiCostInr: round2(aiAnalyses * rates.aiAnalysisInr),
      aiReportCostInr: round2(aiReports * rates.aiReportInr),
      transcriptionCostInr: round2(transcriptionMinutes * rates.transcriptionMinuteInr),
      videoCostInr: round2(videoMinutes * rates.videoMinuteInr),
    };
    const estCostInr = round2(Object.values(costTotals).reduce((a, b) => a + b, 0));
    const revenueInr = sum((p) => p.revenueInr);

    // Fixed monthly bills, prorated over the range ("all time" = since the
    // first professional joined).
    const firstJoined = therapists.reduce((min, t) => Math.min(min, t.createdAt.getTime()), now.getTime());
    const rangeDays = days ?? Math.max(1, (now.getTime() - firstJoined) / 864e5);
    const months = rangeDays / 30;
    const fixed = {
      hostingInr: round2(settings['costs.hostingMonthlyInr'] * months),
      databaseInr: round2(settings['costs.databaseMonthlyInr'] * months),
    };
    const fixedCostInr = round2(fixed.hostingInr + fixed.databaseInr);
    const totalCostInr = round2(estCostInr + fixedCostInr);

    const who = new Map(professionals.map((p) => [p.therapistId, p]));
    const launched = new Set(modulesAllTime.map((m) => m.label!));
    const topModules = modulesInRange
      .map((m) => ({ moduleId: m.label!, name: moduleName(m.label!), launches: m._sum.count ?? 0 }))
      .sort((a, b) => b.launches - a.launches);
    const inRange = new Set(topModules.map((m) => m.moduleId));

    return res.json({
      range: { key: rangeKey, days, seriesDays, from: since, to: now },
      rates: { ...rates, hostingMonthlyInr: settings['costs.hostingMonthlyInr'], databaseMonthlyInr: settings['costs.databaseMonthlyInr'] },
      totals: {
        professionals: professionals.length,
        activeProfessionals: professionals.filter((p) => p.sessions || p.aiAnalyses || p.moduleLaunches || p.aiReports).length,
        sessions: sum((p) => p.sessions),
        videoMinutes,
        aiAnalyses,
        aiReports,
        transcriptSegments: sumOf('TRANSCRIPTION'),
        transcriptionMinutes,
        moduleLaunches: sumOf('MODULE_LAUNCH'),
        storageBytes: sum((p) => p.storageBytes),
        revenueInr,
        estCostInr,
        fixed,
        fixedCostInr,
        totalCostInr,
        netInr: round2(revenueInr - totalCostInr),
        ...costTotals,
      },
      series,
      professionals,
      topModules,
      neverLaunched: ALL_MODULE_IDS.filter((id) => !launched.has(id)).map((id) => ({ moduleId: id, name: moduleName(id) })),
      untracked: everyone
        .filter((t) => !t.trackUsage)
        .map((t) => ({ therapistId: t.id, name: `${t.firstName} ${t.lastName}`.trim() || 'Unnamed', email: users.get(t.userId)?.email ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      notLaunchedInRange: ALL_MODULE_IDS.filter((id) => !inRange.has(id)).map((id) => ({ moduleId: id, name: moduleName(id) })),
      alerts: {
        threshold,
        therapists: monthAnalyses
          .filter((m) => (m._sum.count ?? 0) > threshold)
          .map((m) => ({ therapistId: m.therapistId, name: who.get(m.therapistId)?.name ?? 'Unknown', email: who.get(m.therapistId)?.email ?? null, aiAnalyses: m._sum.count ?? 0 }))
          .sort((a, b) => b.aiAnalyses - a.aiAnalyses),
      },
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin usage error', "We couldn't load usage and costs. Please try again."));
  }
}));

// ---- /api/admin/usage/infra ----------------------------------------------------

const MB = 1024 * 1024;
const TOP_TABLES = 10;

type Client = { $queryRaw: typeof prisma.$queryRaw };

// GET /api/admin/usage/infra — database storage and the machines the
// frontend, backend and AI service run on (each reports its own; see
// lib/admin/host-stats.ts). Everything is read live; nothing here is stored.
router.get('/admin/usage/infra', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'settings');
    if (!auth.ok) return send(res, auth.response);

    const settings = await getSettings();
    const [hipaa, app, ...servers] = await Promise.all([
      database('HIPAA database', 'Patient data: clients, sessions, notes, reports, messages', prisma, settings['limits.hipaaDbMb']),
      database('App database', 'Professionals, billing, usage log, settings, modules', appDb, settings['limits.appDbMb']),
      remoteHostStats('Frontend', 'frontend'),
      hostStats().then((stats): ServerReport => ({ name: 'Backend', ok: true, stats })),
      remoteHostStats('AI service', 'ai'),
    ]);

    return res.json({
      checkedAt: new Date(),
      databases: [hipaa, app],
      servers,
      fixed: { hostingMonthlyInr: settings['costs.hostingMonthlyInr'], databaseMonthlyInr: settings['costs.databaseMonthlyInr'] },
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin infra usage error', "We couldn't load database and hosting usage. Please try again."));
  }
}));

async function database(label: string, holds: string, db: Client, limitMb: number) {
  try {
    const [[size], [conns], tables] = await Promise.all([
      db.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`,
      db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`,
      db.$queryRaw<{ name: string; rows: bigint; bytes: bigint }[]>`
        SELECT relname AS name, n_live_tup AS rows, pg_total_relation_size(relid) AS bytes
        FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`,
    ]);
    const bytes = Number(size.bytes);
    return {
      label,
      holds,
      ok: true,
      bytes,
      limitBytes: limitMb * MB,
      connections: conns.n,
      tableCount: tables.length,
      rows: tables.reduce((a, t) => a + Number(t.rows), 0),
      tables: tables.slice(0, TOP_TABLES).map((t) => ({ name: t.name, rows: Number(t.rows), bytes: Number(t.bytes) })),
    };
  } catch (e: any) {
    console.error(`${label} size check failed:`, e.message);
    return { label, holds, ok: false, bytes: 0, limitBytes: limitMb * MB, connections: 0, tableCount: 0, rows: 0, tables: [] };
  }
}

// ---- /api/admin/usage/:therapistId ---------------------------------------------

const MAX_SESSIONS = 500;

// GET /api/admin/usage/:therapistId?range=30d — one professional's usage and
// estimated cost, counted the same way as their row on /api/admin/usage, plus
// a daily breakdown, cost per session, modules, payments and
// storage per table. Sessions are listed by time and length only: no client
// names or other patient data.
router.get('/admin/usage/:therapistId', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.read');
    if (!auth.ok) return send(res, auth.response);

    const { therapistId } = req.params;
    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: therapistId },
      select: { id: true, firstName: true, lastName: true, userId: true, createdAt: true, specialty: true },
    });
    if (!therapist) return res.status(404).json({ error: "We couldn't find this professional. Their account may have been removed." });

    const range = usageRange(queryParams(req));
    const { since } = range;
    const now = new Date();

    const [settings, user, subscription, events, sessions, reports, payments, [clients], storage] = await Promise.all([
      getSettings(),
      prisma.user.findUnique({ where: { id: therapist.userId }, select: { email: true, status: true, lastSeenAt: true } }),
      appDb.subscription.findFirst({
        where: { therapistId, status: 'ACTIVE', currentPeriodEnd: { gt: now } },
        orderBy: { startedAt: 'desc' },
        select: { currentPeriodEnd: true, plan: { select: { name: true } } },
      }),
      appDb.usageEvent.findMany({
        where: { therapistId, createdAt: { gte: since } },
        select: { sessionId: true, type: true, label: true, count: true, createdAt: true },
      }),
      prisma.session.findMany({
        where: { therapistId, OR: [{ startedAt: { gte: since } }, { scheduledAt: { gte: since, lte: now } }] },
        orderBy: { scheduledAt: 'desc' },
        take: MAX_SESSIONS,
        select: { id: true, status: true, scheduledAt: true, startedAt: true, endedAt: true },
      }),
      prisma.sessionReport.findMany({
        where: { therapistId, aiGenerated: true, generatedAt: { gte: since } },
        select: { sessionId: true, generatedAt: true },
      }),
      appDb.payment.findMany({
        where: { therapistId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, orderStatus: true, paidAt: true, createdAt: true, months: true, couponCode: true, discount: true, planId: true },
      }),
      prisma.$queryRaw<{ n: number }[]>`
        SELECT count(DISTINCT "clientId")::int AS n FROM (
          SELECT "clientId" FROM "Session" WHERE "therapistId" = ${therapistId}
          UNION SELECT id AS "clientId" FROM "ProfileClient" WHERE "therapistId" = ${therapistId}
        ) c`,
      therapistStorage(therapistId),
    ]);
    const rates = usageRates(settings);

    // Transcribed sessions may have started before the range; fetch any not listed.
    const transcribedIds = new Set(events.filter((e) => e.type === 'TRANSCRIPTION' && e.sessionId).map((e) => e.sessionId!));
    const listed = new Map(sessions.map((s) => [s.id, s]));
    const missing = [...transcribedIds].filter((id) => !listed.has(id));
    const extra = missing.length
      ? await prisma.session.findMany({ where: { id: { in: missing } }, select: { id: true, status: true, scheduledAt: true, startedAt: true, endedAt: true } })
      : [];
    const sessionById = new Map([...sessions, ...extra].map((s) => [s.id, s]));

    // ── Totals (same rules as the list) ──
    const held = sessions.filter((s) => s.startedAt && s.startedAt >= since && s.endedAt);
    const videoMinutes = Math.round(held.reduce((a, s) => a + minutesBetween(s), 0));
    const transcriptionMinutes = Math.round([...transcribedIds].reduce((a, id) => a + minutesBetween(sessionById.get(id) ?? { startedAt: null, endedAt: null }), 0));
    const sumType = (type: string) => events.filter((e) => e.type === type).reduce((a, e) => a + e.count, 0);
    const paid = payments.filter((p) => p.orderStatus === 'PAID' && p.paidAt && p.paidAt >= since);

    const counts = {
      clients: clients?.n ?? 0,
      sessions: held.length,
      videoMinutes,
      aiAnalyses: sumType('AI_ANALYSIS'),
      aiReports: reports.length,
      transcriptSegments: sumType('TRANSCRIPTION'),
      transcriptionMinutes,
      moduleLaunches: sumType('MODULE_LAUNCH'),
      payments: paid.length,
      revenueInr: round2(paid.reduce((a, p) => a + Number(p.amount), 0)),
      storageBytes: storage.reduce((a, r) => a + r.bytes, 0),
    };
    const { cost, estCostInr } = usageCost(counts, rates);

    // ── Daily estimated cost by type ──
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const daily = new Map<string, { ai: number; reports: number; transcription: number; video: number; sessions: number }>();
    const day = (d: Date) => {
      const k = dayKey(d);
      if (!daily.has(k)) daily.set(k, { ai: 0, reports: 0, transcription: 0, video: 0, sessions: 0 });
      return daily.get(k)!;
    };
    for (const e of events) {
      if (e.type === 'AI_ANALYSIS') day(e.createdAt).ai += e.count * rates.aiAnalysisInr;
      if (e.type === 'TRANSCRIPTION' && e.sessionId) day(e.createdAt).transcription += Math.round(minutesBetween(sessionById.get(e.sessionId) ?? { startedAt: null, endedAt: null })) * rates.transcriptionMinuteInr;
    }
    for (const s of held) {
      const d = day(s.startedAt!);
      d.video += Math.round(minutesBetween(s)) * rates.videoMinuteInr;
      d.sessions += 1;
    }
    for (const r of reports) day(r.generatedAt).reports += rates.aiReportInr;

    const series = Array.from({ length: range.seriesDays }, (_, i) => {
      const d = new Date(now.getTime() - (range.seriesDays - 1 - i) * 864e5);
      const v = daily.get(dayKey(d));
      const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      return {
        label,
        costInr: v ? round2(v.ai + v.reports + v.transcription + v.video) : 0,
        sessions: v?.sessions ?? 0,
      };
    });

    // ── Per session ──
    const perSession = new Map<string, { ai: number; segments: number; modules: number }>();
    for (const e of events) {
      if (!e.sessionId) continue;
      const r = perSession.get(e.sessionId) ?? { ai: 0, segments: 0, modules: 0 };
      if (e.type === 'AI_ANALYSIS') r.ai += e.count;
      else if (e.type === 'TRANSCRIPTION') r.segments += e.count;
      else if (e.type === 'MODULE_LAUNCH') r.modules += e.count;
      perSession.set(e.sessionId, r);
    }
    const reported = new Set(reports.map((r) => r.sessionId));
    const sessionRows = sessions.map((s) => {
      const u = perSession.get(s.id) ?? { ai: 0, segments: 0, modules: 0 };
      const minutes = Math.round(minutesBetween(s));
      const transcribed = transcribedIds.has(s.id);
      const c = usageCost(
        {
          aiAnalyses: u.ai,
          aiReports: reported.has(s.id) ? 1 : 0,
          transcriptionMinutes: transcribed ? minutes : 0,
          videoMinutes: s.startedAt && s.startedAt >= since ? minutes : 0,
        },
        rates
      );
      return {
        sessionId: s.id,
        status: s.status,
        scheduledAt: s.scheduledAt,
        startedAt: s.startedAt,
        minutes,
        aiAnalyses: u.ai,
        transcribed,
        transcriptSegments: u.segments,
        moduleLaunches: u.modules,
        aiReport: reported.has(s.id),
        estCostInr: c.estCostInr,
      };
    });

    // ── Modules, payments, storage ──
    const moduleCounts = new Map<string, number>();
    for (const e of events) if (e.type === 'MODULE_LAUNCH' && e.label) moduleCounts.set(e.label, (moduleCounts.get(e.label) ?? 0) + e.count);
    const modules = [...moduleCounts].map(([id, launches]) => ({ moduleId: id, name: moduleName(id), launches })).sort((a, b) => b.launches - a.launches);

    const plans = await appDb.plan.findMany({
      where: { id: { in: [...new Set(payments.map((p) => p.planId).filter((id): id is string => !!id))] } },
      select: { id: true, name: true },
    });
    const planName = new Map(plans.map((p) => [p.id, p.name]));

    return res.json({
      range: { key: range.key, days: range.days, seriesDays: range.seriesDays, from: since, to: now },
      rates,
      professional: {
        therapistId: therapist.id,
        name: `${therapist.firstName} ${therapist.lastName}`.trim() || 'Unnamed',
        email: user?.email ?? null,
        status: user?.status ?? null,
        lastSeenAt: user?.lastSeenAt ?? null,
        joinedAt: therapist.createdAt,
        specialty: therapist.specialty,
        plan: subscription?.plan.name ?? null,
        planEndsAt: subscription?.currentPeriodEnd ?? null,
      },
      totals: { ...counts, cost, estCostInr, netInr: round2(counts.revenueInr - estCostInr) },
      series,
      sessions: sessionRows,
      sessionsTruncated: sessions.length === MAX_SESSIONS,
      modules,
      payments: payments.map((p) => ({
        id: p.id,
        status: p.orderStatus,
        amountInr: Number(p.amount),
        discountInr: p.discount == null ? null : Number(p.discount),
        couponCode: p.couponCode,
        plan: p.planId ? planName.get(p.planId) ?? null : null,
        months: p.months,
        createdAt: p.createdAt,
        paidAt: p.paidAt,
      })),
      storage: storage.sort((a, b) => b.bytes - a.bytes).map(({ table, rows, bytes }) => ({ table, rows, bytes })),
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin professional usage error', "We couldn't load this professional's usage. Please try again."));
  }
}));
