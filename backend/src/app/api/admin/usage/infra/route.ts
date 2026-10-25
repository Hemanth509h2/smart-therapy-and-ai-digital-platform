import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { getSettings } from '@/lib/core/settings';
import { errorResponse } from '@/lib/http/apiError';
import { hostStats, remoteHostStats, type ServerReport } from '@/lib/admin/host-stats';

export const dynamic = 'force-dynamic';

const MB = 1024 * 1024;
const TOP_TABLES = 10;

type Client = { $queryRaw: typeof prisma.$queryRaw };

// GET /api/admin/usage/infra — database storage and the machines the
// frontend, backend and AI service run on (each reports its own; see
// lib/admin/host-stats.ts). Everything is read live; nothing here is stored.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'settings');
    if (!auth.ok) return auth.response;

    const settings = await getSettings();
    const [hipaa, app, ...servers] = await Promise.all([
      database('HIPAA database', 'Patient data: clients, sessions, notes, reports, messages', prisma, settings['limits.hipaaDbMb']),
      database('App database', 'Professionals, billing, usage log, settings, modules', appDb, settings['limits.appDbMb']),
      remoteHostStats('Frontend', 'frontend'),
      hostStats().then((stats): ServerReport => ({ name: 'Backend', ok: true, stats })),
      remoteHostStats('AI service', 'ai'),
    ]);

    return NextResponse.json({
      checkedAt: new Date(),
      databases: [hipaa, app],
      servers,
      fixed: { hostingMonthlyInr: settings['costs.hostingMonthlyInr'], databaseMonthlyInr: settings['costs.databaseMonthlyInr'] },
    });
  } catch (error: any) {
    return errorResponse(error, 'Admin infra usage error', "We couldn't load database and hosting usage. Please try again.");
  }
}

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
