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
// signed token. The AI service checks it with STT_TOKEN_SECRET, which it
// already shares with the backend. The frontend gets a secret of its own,
// SERVER_STATS_SECRET, so the website never holds a key to the AI service.
export const STATS_SID = 'server-stats';
const STATS_SCOPE = 'server-stats';

// The frontend's address, taken from the CORS list: the first origin that
// isn't localhost (so a deployed backend skips the dev entry), else the first.
function frontendUrl() {
  const origins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return origins.find((o) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(o)) ?? origins[0];
}

/** Asks the frontend or AI service for its machine's stats. Never throws. */
export async function remoteHostStats(name: string, service: 'frontend' | 'ai'): Promise<ServerReport> {
  const frontend = service === 'frontend';
  const base = (frontend ? frontendUrl() : process.env.STT_RELAY_URL || process.env.NEXT_PUBLIC_STT_RELAY_URL)?.replace(/\/+$/, '');
  const urlVar = frontend ? 'ALLOWED_ORIGINS' : 'STT_RELAY_URL';
  if (!base) return { name, ok: false, reason: `${urlVar} is not set on the backend, so we don't know where this server is.` };
  const secretVar = frontend ? 'SERVER_STATS_SECRET' : 'STT_TOKEN_SECRET';
  const secret = process.env[secretVar];
  if (!secret) {
    return {
      name,
      ok: false,
      reason: frontend
        ? 'SERVER_STATS_SECRET is not set on the backend. Generate one (openssl rand -hex 32) and set the same value on the backend and the frontend.'
        : 'STT_TOKEN_SECRET is not set on the backend.',
    };
  }

  const token = mintSttToken(STATS_SID, secret, 60_000, STATS_SCOPE);
  const url =
    service === 'frontend'
      ? `${base}/server-stats`
      : `${base}/server-stats?sid=${STATS_SID}&token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      headers: frontend ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (res.ok) {
      const stats = await res.json().catch(() => null);
      // A page instead of JSON: the URL points somewhere that isn't this app's
      // /server-stats (e.g. a login or a 404 page answered with 200).
      if (stats && typeof stats.cpus === 'number') return { name, ok: true, stats: stats as HostStats };
      return { name, ok: false, reason: `${base}/server-stats did not answer with server stats. Check that ${urlVar} has this app's address.` };
    }
    return { name, ok: false, reason: failureReason(res.status, frontend, base, urlVar, secretVar) };
  } catch (e: any) {
    return { name, ok: false, reason: `Couldn't reach it at ${base} (${e?.name === 'TimeoutError' ? 'timed out' : e?.message || 'network error'}).` };
  }
}

// What the admin should fix, from the status /server-stats answered with.
function failureReason(status: number, frontend: boolean, base: string, urlVar: string, secretVar: string) {
  if (status === 401) {
    return `${base} asked for a login (401). On Vercel that's Deployment Protection: point ${urlVar} at the production domain, or turn protection off for it.`;
  }
  if (frontend && status === 503) return 'SERVER_STATS_SECRET is not set on the frontend. Set it to the same value as on the backend, then redeploy the frontend.';
  if (status === 403) return `${secretVar} on this server is different from the backend's. Make them the same value, then redeploy.`;
  if (status === 404) return `${base} has no /server-stats yet. Deploy the latest version there.`;
  return `${base}/server-stats answered ${status}.`;
}
