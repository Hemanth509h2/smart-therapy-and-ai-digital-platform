import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { getSettings } from '@/lib/core/settings';
import { moduleName } from '@/lib/modules/modules';
import { minutesBetween, round2, therapistStorage, usageCost, usageRange, usageRates } from '@/lib/admin/usage';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

const MAX_SESSIONS = 500;

// GET /api/admin/usage/:therapistId?range=30d — one professional's usage and
// estimated cost, counted the same way as their row on /api/admin/usage, plus
// a daily breakdown, cost per session, modules, payments and
// storage per table. Sessions are listed by time and length only: no client
// names or other patient data.
export async function GET(request: Request, { params }: { params: { therapistId: string } }) {
  try {
    const auth = await requireAdmin(request, 'people.read');
    if (!auth.ok) return auth.response;

    const { therapistId } = params;
    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: therapistId },
      select: { id: true, firstName: true, lastName: true, userId: true, createdAt: true, specialty: true },
    });
    if (!therapist) return NextResponse.json({ error: "We couldn't find this professional. Their account may have been removed." }, { status: 404 });

    const range = usageRange(new URL(request.url).searchParams);
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

    return NextResponse.json({
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
    return errorResponse(error, 'Admin professional usage error', "We couldn't load this professional's usage. Please try again.");
  }
}
