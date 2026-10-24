// Shared by the admin Usage pages (api/admin/usage and its per-professional
// page): date ranges, cost rates, the cost formula and the storage estimate.
import { prisma, appDb } from '@/lib/core/db';
import { daysAgo } from '@/lib/admin/adminList';
import type { Settings } from '@/lib/core/settings';

// null = all time. The daily charts never go back further than a year.
export const USAGE_RANGES: Record<string, number | null> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365, all: null };
export const MAX_SERIES_DAYS = 365;
export const SENT_STATUSES = ['SENT', 'DELIVERED', 'READ'] as const;

export function usageRange(sp: URLSearchParams) {
  const key = (sp.get('range') || '') in USAGE_RANGES ? sp.get('range')! : '30d';
  const days = USAGE_RANGES[key];
  const seriesDays = Math.min(days ?? MAX_SERIES_DAYS, MAX_SERIES_DAYS);
  return { key, days, since: days == null ? new Date(0) : daysAgo(days), seriesDays, seriesSince: daysAgo(seriesDays) };
}

export function usageRates(settings: Settings) {
  return {
    aiAnalysisInr: settings['costs.aiAnalysisInr'],
    transcriptionMinuteInr: settings['costs.transcriptionMinuteInr'],
    aiReportInr: settings['costs.aiReportInr'],
    videoMinuteInr: settings['costs.videoMinuteInr'],
    whatsappMessageInr: settings['costs.whatsappMessageInr'],
  };
}
export type UsageRates = ReturnType<typeof usageRates>;

export interface UsageCounts {
  aiAnalyses: number;
  aiReports: number;
  transcriptionMinutes: number;
  videoMinutes: number;
  whatsappMessages: number;
}

export function usageCost(u: UsageCounts, rates: UsageRates) {
  const cost = {
    aiAnalysisInr: round2(u.aiAnalyses * rates.aiAnalysisInr),
    aiReportInr: round2(u.aiReports * rates.aiReportInr),
    transcriptionInr: round2(u.transcriptionMinutes * rates.transcriptionMinuteInr),
    videoInr: round2(u.videoMinutes * rates.videoMinuteInr),
    whatsappInr: round2(u.whatsappMessages * rates.whatsappMessageInr),
  };
  return { cost, estCostInr: round2(Object.values(cost).reduce((a, b) => a + b, 0)) };
}

export const minutesBetween = (s: { startedAt: Date | null; endedAt: Date | null }) =>
  s.startedAt && s.endedAt ? Math.max(0, (s.endedAt.getTime() - s.startedAt.getTime()) / 60000) : 0;

export const round2 = (n: number) => Math.round(n * 100) / 100;

// Tables holding a therapist's rows, per database, for the storage estimate.
// Fixed names only: they go into the SQL as-is.
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

export interface StorageRow {
  table: string;
  therapistId: string;
  rows: number;
  bytes: number;
}

// Approximate bytes of therapists' rows per table (pg_column_size of the row;
// large values stored out of line are counted compressed). Pass a therapist id
// to measure only theirs. Best effort: a missing table must not break the
// page, so a failing database counts as zero.
export async function therapistStorage(therapistId?: string): Promise<StorageRow[]> {
  const sql = (tables: [string, string][]) =>
    `SELECT tbl, t, count(*)::int AS n, sum(b)::bigint AS b FROM (${tables
      .map(
        ([table, col]) =>
          `SELECT '${table}' AS tbl, "${col}" AS t, pg_column_size(x.*) AS b FROM "${table}" x WHERE ${therapistId ? `"${col}" = $1` : `"${col}" IS NOT NULL`}`
      )
      .join(' UNION ALL ')}) s GROUP BY tbl, t`;
  const args = therapistId ? [therapistId] : [];
  type Raw = { tbl: string; t: string; n: number; b: bigint };
  const [hipaa, app] = await Promise.all([
    prisma.$queryRawUnsafe<Raw[]>(sql(HIPAA_TABLES), ...args).catch((e) => (console.error('Storage estimate (HIPAA) failed:', e.message), [] as Raw[])),
    appDb.$queryRawUnsafe<Raw[]>(sql(APP_TABLES), ...args).catch((e) => (console.error('Storage estimate (app) failed:', e.message), [] as Raw[])),
  ]);
  return [...hipaa, ...app].map((r) => ({ table: r.tbl, therapistId: r.t, rows: r.n, bytes: Number(r.b) }));
}
