import os from 'node:os';
import { readFile, statfs } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { getSettings } from '@/lib/core/settings';

export const dynamic = 'force-dynamic';

const MB = 1024 * 1024;
const TOP_TABLES = 10;

type Client = { $queryRaw: typeof prisma.$queryRaw };

// GET /api/admin/usage/infra — database storage and the server the backend
// runs on. Everything is read live; nothing here is stored.
//
// The backend runs in a Docker container: os.* reports the host's CPUs, load
// and memory, statfs('/') the disk Docker stores containers on, and the cgroup
// files this container's own memory use and limit.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'settings');
    if (!auth.ok) return auth.response;

    const settings = await getSettings();
    const [hipaa, app, server] = await Promise.all([
      database('HIPAA database', 'Patient data: clients, sessions, notes, reports, messages', prisma, settings['limits.hipaaDbMb']),
      database('App database', 'Professionals, billing, usage log, settings, modules', appDb, settings['limits.appDbMb']),
      hosting(),
    ]);

    return NextResponse.json({
      checkedAt: new Date(),
      databases: [hipaa, app],
      server,
      fixed: { hostingMonthlyInr: settings['costs.hostingMonthlyInr'], databaseMonthlyInr: settings['costs.databaseMonthlyInr'] },
    });
  } catch (error: any) {
    console.error('Admin infra usage error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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

async function hosting() {
  const disk = await statfs('/').catch(() => null);
  const mem = process.memoryUsage();
  return {
    platform: `${os.type()} ${os.release()}`,
    cpus: os.cpus().length,
    load: os.loadavg().map((n) => Math.round(n * 100) / 100),
    uptimeSec: Math.round(os.uptime()),
    memory: { total: os.totalmem(), free: os.freemem() },
    disk: disk ? { total: disk.blocks * disk.bsize, free: disk.bavail * disk.bsize } : null,
    container: await containerMemory(),
    backend: { node: process.version, uptimeSec: Math.round(process.uptime()), rss: mem.rss, heapUsed: mem.heapUsed },
  };
}

// cgroup v2 memory use and limit of this container; null outside Docker.
async function containerMemory() {
  const read = (f: string) => readFile(`/sys/fs/cgroup/${f}`, 'utf8').then((s) => s.trim()).catch(() => null);
  const [current, max] = await Promise.all([read('memory.current'), read('memory.max')]);
  if (!current) return null;
  return { used: Number(current), limit: max && max !== 'max' ? Number(max) : null };
}
