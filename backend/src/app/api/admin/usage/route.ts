import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { usersById } from '@/lib/core/links';
import { requireAdmin } from '@/lib/http/apiAuth';
import { daysAgo, startOfMonth } from '@/lib/admin/adminList';
import { getSettings } from '@/lib/core/settings';
import { ALL_MODULE_IDS, moduleName } from '@/lib/modules/modules';

export const dynamic = 'force-dynamic';

const TYPES = ['AI_ANALYSIS', 'TRANSCRIPTION', 'MODULE_LAUNCH'] as const;
// null = all time. The daily charts never go back further than a year.
const RANGES: Record<string, number | null> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365, all: null };
const MAX_SERIES_DAYS = 365;
const SENT_STATUSES = ['SENT', 'DELIVERED', 'READ'] as const;

// Tables holding a therapist's rows, per database, for the per-professional
// storage estimate. Fixed names only: they go into the SQL as-is.
const HIPAA_TABLES: [table: string, column: string][] = [
  ['ProfileClient', 'therapistId'],
  ['Invite', 'therapistId'],
  ['Booking', 'therapistId'],
  ['Session', 'therapistId'],
  ['SessionReport', 'therapistId'],
  ['TherapistNote', 'therapistId'],
  ['ProgressMetric', 'therapistId'],
  ['ProgressReport', 'therapistId'],
  ['ProgressNote', 'therapistId'],
  ['RiskFlag', 'therapistId'],
  ['document_chunks', 'therapist_id'],
  ['WhatsAppMessage', 'therapistId'],
];
const APP_TABLES: [table: string, column: string][] = [
  ['UsageEvent', 'therapistId'],
  ['Subscription', 'therapistId'],
  ['SubscriptionRequest', 'therapistId'],
  ['Payment', 'therapistId'],
];

// Approximate bytes of each therapist's rows (pg_column_size of the row; large
// values stored out of line are counted compressed). Best effort: a missing
// table must not break the page, so failures count as zero.
async function storageByTherapist(): Promise<Map<string, number>> {
  const sql = (tables: [string, string][]) =>
    `SELECT t, sum(b)::bigint AS b FROM (${tables
      .map(([table, col]) => `SELECT "${col}" AS t, pg_column_size(x.*) AS b FROM "${table}" x WHERE "${col}" IS NOT NULL`)
      .join(' UNION ALL ')}) s GROUP BY t`;
  const [hipaa, app] = await Promise.all([
    prisma.$queryRawUnsafe<{ t: string; b: bigint }[]>(sql(HIPAA_TABLES)).catch((e) => (console.error('Storage estimate (HIPAA) failed:', e.message), [])),
    appDb.$queryRawUnsafe<{ t: string; b: bigint }[]>(sql(APP_TABLES)).catch((e) => (console.error('Storage estimate (app) failed:', e.message), [])),
  ]);
  const out = new Map<string, number>();
  for (const r of [...hipaa, ...app]) out.set(r.t, (out.get(r.t) ?? 0) + Number(r.b));
  return out;
}

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
// started in the range, AI reports from SessionReport, WhatsApp from messages
// sent, revenue from PAID Cashfree orders, storage from the size of each
// therapist's rows. Fixed hosting/database bills (Settings) count only in the
// platform totals; a professional's netInr is revenue minus their usage cost.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'people.read');
    if (!auth.ok) return auth.response;

    const sp = new URL(request.url).searchParams;
    const rangeKey = (sp.get('range') || '') in RANGES ? sp.get('range')! : '30d';
    const days = RANGES[rangeKey];
    const since = days == null ? new Date(0) : daysAgo(days);
    const seriesDays = Math.min(days ?? MAX_SERIES_DAYS, MAX_SERIES_DAYS);
    const seriesSince = daysAgo(seriesDays);
    const monthStart = startOfMonth();
    const now = new Date();

    const [settings, daily, totals, transcribed, perTherapist, modulesInRange, modulesAllTime, monthAnalyses, therapists, payments, subscriptions] =
      await Promise.all([
        getSettings(),
        appDb.$queryRaw<{ bucket: Date; type: string; n: number }[]>`
          SELECT date_trunc('day', "createdAt") AS bucket, type, sum(count)::int AS n
          FROM "UsageEvent" WHERE "createdAt" >= ${seriesSince}
          GROUP BY 1, 2 ORDER BY 1`,
        appDb.usageEvent.groupBy({ by: ['type'], where: { createdAt: { gte: since } }, _sum: { count: true } }),
        appDb.usageEvent.findMany({
          where: { type: 'TRANSCRIPTION', sessionId: { not: null }, createdAt: { gte: since } },
          distinct: ['sessionId'],
          select: { sessionId: true },
        }),
        appDb.usageEvent.groupBy({ by: ['therapistId', 'type'], where: { createdAt: { gte: since } }, _sum: { count: true } }),
        appDb.usageEvent.groupBy({
          by: ['label'],
          where: { type: 'MODULE_LAUNCH', createdAt: { gte: since }, label: { not: null } },
          _sum: { count: true },
        }),
        appDb.usageEvent.groupBy({ by: ['label'], where: { type: 'MODULE_LAUNCH', label: { not: null } }, _sum: { count: true } }),
        appDb.usageEvent.groupBy({
          by: ['therapistId'],
          where: { type: 'AI_ANALYSIS', createdAt: { gte: monthStart } },
          _sum: { count: true },
        }),
        appDb.profileTherapist.findMany({ select: { id: true, firstName: true, lastName: true, userId: true, createdAt: true } }),
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
      ]);

    // Patient-side data lives in the HIPAA database.
    const [transcribedSessions, heldSessions, reports, whatsapp, clientCounts, storage] = await Promise.all([
      prisma.session.findMany({
        where: { id: { in: transcribed.map((t) => t.sessionId!) }, startedAt: { not: null }, endedAt: { not: null } },
        select: { therapistId: true, startedAt: true, endedAt: true },
      }),
      prisma.session.findMany({
        where: { startedAt: { gte: since }, endedAt: { not: null } },
        select: { therapistId: true, startedAt: true, endedAt: true },
      }),
      prisma.sessionReport.groupBy({ by: ['therapistId'], where: { aiGenerated: true, generatedAt: { gte: since } }, _count: { _all: true } }),
      prisma.whatsAppMessage.groupBy({
        by: ['therapistId'],
        where: { therapistId: { not: null }, status: { in: [...SENT_STATUSES] }, sentAt: { gte: since } },
        _count: { _all: true },
      }),
      // Clients either added directly by the therapist or seen in a session.
      prisma.$queryRaw<{ therapistId: string; n: number }[]>`
        SELECT "therapistId", count(DISTINCT "clientId")::int AS n FROM (
          SELECT "therapistId", "clientId" FROM "Session"
          UNION SELECT "therapistId", id AS "clientId" FROM "ProfileClient" WHERE "therapistId" IS NOT NULL
        ) c GROUP BY 1`,
      storageByTherapist(),
    ]);

    const minutesBetween = (s: { startedAt: Date | null; endedAt: Date | null }) => Math.max(0, (s.endedAt!.getTime() - s.startedAt!.getTime()) / 60000);

    let totalMinutes = 0;
    const minutesOf = new Map<string, number>();
    for (const s of transcribedSessions) {
      const m = minutesBetween(s);
      totalMinutes += m;
      minutesOf.set(s.therapistId, (minutesOf.get(s.therapistId) ?? 0) + m);
    }

    const rates = {
      aiAnalysisInr: settings['costs.aiAnalysisInr'],
      transcriptionMinuteInr: settings['costs.transcriptionMinuteInr'],
      aiReportInr: settings['costs.aiReportInr'],
      videoMinuteInr: settings['costs.videoMinuteInr'],
      whatsappMessageInr: settings['costs.whatsappMessageInr'],
    };
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
      whatsappMessages: 0,
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
    for (const g of whatsapp) {
      const r = row(g.therapistId);
      if (r) r.whatsappMessages = g._count._all;
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

    const planOf = new Map<string, string>();
    for (const s of subscriptions) if (!planOf.has(s.therapistId)) planOf.set(s.therapistId, s.plan.name);
    const users = await usersById(therapists.map((t) => t.userId), { email: true, status: true, lastSeenAt: true });

    const professionals = therapists
      .map((t) => {
        const r = byTherapist.get(t.id)!;
        const videoMinutes = Math.round(r.videoMinutes);
        const cost = {
          aiAnalysisInr: round2(r.aiAnalyses * rates.aiAnalysisInr),
          aiReportInr: round2(r.aiReports * rates.aiReportInr),
          transcriptionInr: round2(r.transcriptionMinutes * rates.transcriptionMinuteInr),
          videoInr: round2(videoMinutes * rates.videoMinuteInr),
          whatsappInr: round2(r.whatsappMessages * rates.whatsappMessageInr),
        };
        const estCostInr = round2(Object.values(cost).reduce((a, b) => a + b, 0));
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
          storageBytes: storage.get(t.id) ?? 0,
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
    const whatsappMessages = sum((p) => p.whatsappMessages);

    const costTotals = {
      aiCostInr: round2(aiAnalyses * rates.aiAnalysisInr),
      aiReportCostInr: round2(aiReports * rates.aiReportInr),
      transcriptionCostInr: round2(transcriptionMinutes * rates.transcriptionMinuteInr),
      videoCostInr: round2(videoMinutes * rates.videoMinuteInr),
      whatsappCostInr: round2(whatsappMessages * rates.whatsappMessageInr),
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

    return NextResponse.json({
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
        whatsappMessages,
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
    console.error('Admin usage error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
