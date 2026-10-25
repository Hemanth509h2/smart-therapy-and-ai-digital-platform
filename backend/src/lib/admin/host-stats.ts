import os from 'node:os';
import { readFile, statfs } from 'node:fs/promises';
import { mintSttToken } from '@/lib/sessions/stt-token';

// CPU, memory and disk of the machine this process runs on, for the admin
// "Database & hosting" cards. The frontend (src/app/server-stats) and the AI
// service (server.py) report the same shape about their own machines.
//
// In Docker, os.* reports the host's CPUs, load and memory, statfs('/') the
// disk Docker stores containers on, and the cgroup files this container's own
// memory use and limit. On Vercel each request runs in a short-lived function
// whose disk is read-only (it always reads as full), so no disk is reported.
export interface HostStats {
  platform: string;
  hosting: 'server' | 'vercel';
  cpus: number;
  load: number[];
  uptimeSec: number;
  memory: { total: number; free: number };
  disk: { total: number; free: number } | null;
  container: { used: number; limit: number | null } | null;
  process: { runtime: string; uptimeSec: number; rss: number };
}

export async function hostStats(): Promise<HostStats> {
  const vercel = process.env.VERCEL === '1';
  const disk = vercel ? null : await statfs('/').catch(() => null);
  return {
    platform: `${os.type()} ${os.release()}`,
    hosting: vercel ? 'vercel' : 'server',
    cpus: os.cpus().length,
    load: os.loadavg().map((n) => Math.round(n * 100) / 100),
    uptimeSec: Math.round(os.uptime()),
    memory: { total: os.totalmem(), free: os.freemem() },
    disk: disk ? { total: disk.blocks * disk.bsize, free: disk.bavail * disk.bsize } : null,
    container: await containerMemory(),
    process: { runtime: `Node ${process.version}`, uptimeSec: Math.round(process.uptime()), rss: process.memoryUsage().rss },
  };
}

// cgroup v2 memory use and limit of this container; null outside Docker.
async function containerMemory() {
  const read = (f: string) => readFile(`/sys/fs/cgroup/${f}`, 'utf8').then((s) => s.trim()).catch(() => null);
  const [current, max] = await Promise.all([read('memory.current'), read('memory.max')]);
  if (!current) return null;
  return { used: Number(current), limit: max && max !== 'max' ? Number(max) : null };
}

export type ServerReport =
  | { name: string; ok: true; stats: HostStats }
  | { name: string; ok: false; reason: string };

// The frontend and AI service only answer /server-stats with a short-lived
// token signed with STT_TOKEN_SECRET (the secret the AI service already
// shares with the backend; the frontend needs it set too).
export const STATS_SID = 'server-stats';
const STATS_SCOPE = 'server-stats';

/** Asks the frontend or AI service for its machine's stats. Never throws. */
export async function remoteHostStats(name: string, service: 'frontend' | 'ai'): Promise<ServerReport> {
  const base = (service === 'frontend' ? process.env.APP_URL : process.env.STT_RELAY_URL || process.env.NEXT_PUBLIC_STT_RELAY_URL)?.replace(/\/+$/, '');
  const urlVar = service === 'frontend' ? 'APP_URL' : 'STT_RELAY_URL';
  if (!base) return { name, ok: false, reason: `${urlVar} is not set on the backend, so we don't know where this server is.` };
  const secret = process.env.STT_TOKEN_SECRET;
  if (!secret) return { name, ok: false, reason: 'STT_TOKEN_SECRET is not set on the backend.' };

  const token = mintSttToken(STATS_SID, secret, 60_000, STATS_SCOPE);
  const url =
    service === 'frontend'
      ? `${base}/server-stats`
      : `${base}/server-stats?sid=${STATS_SID}&token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      headers: service === 'frontend' ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (res.ok) return { name, ok: true, stats: (await res.json()) as HostStats };
    // Both answer 404/403 when they run a version without /server-stats, or
    // when their STT_TOKEN_SECRET differs from the backend's.
    return {
      name,
      ok: false,
      reason:
        `It answered ${res.status}. Deploy the latest version there, and set STT_TOKEN_SECRET on it ` +
        `to the same value as the backend's.`,
    };
  } catch (e: any) {
    return { name, ok: false, reason: `Couldn't reach it at ${base} (${e?.name === 'TimeoutError' ? 'timed out' : e?.message || 'network error'}).` };
  }
}
