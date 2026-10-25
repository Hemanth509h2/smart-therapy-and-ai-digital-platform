import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { usersById } from '@/lib/core/links';
import { requireAdmin } from '@/lib/http/apiAuth';
import { startOfMonth } from '@/lib/admin/adminList';
import { getSettings } from '@/lib/core/settings';
import { ALL_MODULE_IDS, moduleName } from '@/lib/modules/modules';
import { SENT_STATUSES, minutesBetween, round2, therapistStorage, usageCost, usageRange, usageRates } from '@/lib/admin/usage';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

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
// started in the range, AI reports from SessionReport, WhatsApp from messages
// sent, revenue from PAID Cashfree orders, storage from the size of each
// therapist's rows. Fixed hosting/database bills (Settings) count only in the
// platform totals; a professional's netInr is revenue minus their usage cost.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'people.read');
    if (!auth.ok) return auth.response;

    const sp = new URL(request.url).searchParams;
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
      whatsapp,
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
    return errorResponse(error, 'Admin usage error', "We couldn't load usage and costs. Please try again.");
  }
}
