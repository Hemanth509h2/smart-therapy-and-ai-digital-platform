import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { usersById } from '@/lib/core/links';
import { requireAdmin } from '@/lib/http/apiAuth';
import { daysAgo, startOfMonth } from '@/lib/admin/adminList';
import { getSettings } from '@/lib/core/settings';
import { ALL_MODULE_IDS, moduleName } from '@/lib/modules/modules';

export const dynamic = 'force-dynamic';

const TYPES = ['AI_ANALYSIS', 'TRANSCRIPTION', 'MODULE_LAUNCH'] as const;
const RANGES: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

// GET /api/admin/usage?range=30d — AI / transcription / module usage with
// estimated cost.
//
// What `count` means per type (see where each is logged):
//  - AI_ANALYSIS: one row per live AI insight call (api/ai-insight), count 1.
//  - MODULE_LAUNCH: one row per launch from the session room, count 1; the
//    module id is stored in `label`.
//  - TRANSCRIPTION: one row per session end, count = number of transcript
//    segments (final utterances) written — NOT minutes. Transcription minutes
//    for the cost estimate are therefore the started→ended length of the
//    sessions that logged a TRANSCRIPTION event.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'people.read');
    if (!auth.ok) return auth.response;

    const sp = new URL(request.url).searchParams;
    const days = RANGES[sp.get('range') || ''] ?? 30;
    const since = daysAgo(days);
    const monthStart = startOfMonth();

    const [settings, daily, totals, transcribed, perTherapist, modulesInRange, modulesAllTime, monthAnalyses] =
      await Promise.all([
        getSettings(),
        appDb.$queryRaw<{ bucket: Date; type: string; n: number }[]>`
          SELECT date_trunc('day', "createdAt") AS bucket, type, sum(count)::int AS n
          FROM "UsageEvent" WHERE "createdAt" >= ${since}
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
      ]);

    // Sessions live in the HIPAA database: sum their lengths here.
    const transcribedSessions = await prisma.session.findMany({
      where: { id: { in: transcribed.map((t) => t.sessionId!) }, startedAt: { not: null }, endedAt: { not: null } },
      select: { therapistId: true, startedAt: true, endedAt: true },
    });
    let totalMinutes = 0;
    const minutesOf = new Map<string, number>();
    for (const s of transcribedSessions) {
      const m = (s.endedAt!.getTime() - s.startedAt!.getTime()) / 60000;
      totalMinutes += m;
      minutesOf.set(s.therapistId, (minutesOf.get(s.therapistId) ?? 0) + m);
    }

    const aiRate = settings['costs.aiAnalysisInr'];
    const minuteRate = settings['costs.transcriptionMinuteInr'];
    const threshold = settings['usage.alertMonthlyAnalyses'];

    // Continuous daily series per type (missing days = 0).
    const keyed = new Map(daily.map((r) => [`${r.type}|${new Date(r.bucket).toISOString().slice(0, 10)}`, r.n]));
    const series = Object.fromEntries(
      TYPES.map((type) => [
        type,
        Array.from({ length: days }, (_, i) => {
          const d = new Date(Date.now() - (days - 1 - i) * 864e5);
          return {
            label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
            value: keyed.get(`${type}|${d.toISOString().slice(0, 10)}`) ?? 0,
          };
        }),
      ])
    );

    const sumOf = (type: string) => totals.find((t) => t.type === type)?._sum.count ?? 0;
    const transcriptionMinutes = Math.round(totalMinutes);
    const aiAnalyses = sumOf('AI_ANALYSIS');

    // Per-therapist totals for the range.
    const byTherapist = new Map<string, { aiAnalyses: number; transcriptSegments: number; moduleLaunches: number; transcriptionMinutes: number }>();
    const row = (id: string) => {
      if (!byTherapist.has(id)) byTherapist.set(id, { aiAnalyses: 0, transcriptSegments: 0, moduleLaunches: 0, transcriptionMinutes: 0 });
      return byTherapist.get(id)!;
    };
    for (const g of perTherapist) {
      const r = row(g.therapistId);
      const n = g._sum.count ?? 0;
      if (g.type === 'AI_ANALYSIS') r.aiAnalyses += n;
      else if (g.type === 'TRANSCRIPTION') r.transcriptSegments += n;
      else if (g.type === 'MODULE_LAUNCH') r.moduleLaunches += n;
    }
    for (const [id, minutes] of minutesOf) row(id).transcriptionMinutes = Math.round(minutes);

    const overThreshold = monthAnalyses.filter((m) => (m._sum.count ?? 0) > threshold);
    const ids = Array.from(new Set([...byTherapist.keys(), ...overThreshold.map((m) => m.therapistId)]));
    const therapists = await appDb.profileTherapist.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, userId: true },
    });
    const emails = await usersById(therapists.map((t) => t.userId), { email: true });
    const who = new Map(therapists.map((t) => [t.id, { name: `${t.firstName} ${t.lastName}`.trim(), email: emails.get(t.userId)?.email ?? null }]));

    const topTherapists = Array.from(byTherapist, ([id, r]) => ({
      therapistId: id,
      name: who.get(id)?.name ?? 'Unknown',
      email: who.get(id)?.email ?? null,
      ...r,
      estCostInr: round2(r.aiAnalyses * aiRate + r.transcriptionMinutes * minuteRate),
    }))
      .sort((a, b) => b.estCostInr - a.estCostInr || b.moduleLaunches - a.moduleLaunches)
      .slice(0, 15);

    const launched = new Set(modulesAllTime.map((m) => m.label!));
    const topModules = modulesInRange
      .map((m) => ({ moduleId: m.label!, name: moduleName(m.label!), launches: m._sum.count ?? 0 }))
      .sort((a, b) => b.launches - a.launches);
    const inRange = new Set(topModules.map((m) => m.moduleId));

    return NextResponse.json({
      range: { days, from: since, to: new Date() },
      rates: { aiAnalysisInr: aiRate, transcriptionMinuteInr: minuteRate },
      totals: {
        aiAnalyses,
        transcriptSegments: sumOf('TRANSCRIPTION'),
        transcriptionMinutes,
        moduleLaunches: sumOf('MODULE_LAUNCH'),
        estCostInr: round2(aiAnalyses * aiRate + transcriptionMinutes * minuteRate),
        aiCostInr: round2(aiAnalyses * aiRate),
        transcriptionCostInr: round2(transcriptionMinutes * minuteRate),
      },
      series,
      topTherapists,
      topModules,
      neverLaunched: ALL_MODULE_IDS.filter((id) => !launched.has(id)).map((id) => ({ moduleId: id, name: moduleName(id) })),
      notLaunchedInRange: ALL_MODULE_IDS.filter((id) => !inRange.has(id)).map((id) => ({ moduleId: id, name: moduleName(id) })),
      alerts: {
        threshold,
        therapists: overThreshold
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
