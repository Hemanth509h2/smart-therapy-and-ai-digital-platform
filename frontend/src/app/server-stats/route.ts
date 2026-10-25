import os from 'node:os';
import { readFile, statfs } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';

// GET /server-stats — CPU, memory and disk of the machine this website runs
// on, for the admin "Database & hosting" page. The backend asks for it with a
// 60-second token signed with STT_TOKEN_SECRET (sent as a Bearer header), so
// it must be set here to the backend's value. Without it, or with a wrong
// token, the route says it doesn't exist. Same shape as the backend's own
// report (backend/src/lib/admin/host-stats.ts). Not under /api, which may be
// proxied to the backend (see next.config.mjs).
export async function GET(request: Request) {
  const secret = process.env.STT_TOKEN_SECRET;
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || !validToken(token, secret)) {
    return new Response('Not found', { status: 404 });
  }

  // On Vercel each request runs in a short-lived function whose disk is
  // read-only (it always reads as full), so no disk is reported there.
  const vercel = process.env.VERCEL === '1';
  const disk = vercel ? null : await statfs('/').catch(() => null);
  return Response.json(
    {
      platform: `${os.type()} ${os.release()}`,
      hosting: vercel ? 'vercel' : 'server',
      cpus: os.cpus().length,
      load: os.loadavg().map((n) => Math.round(n * 100) / 100),
      uptimeSec: Math.round(os.uptime()),
      memory: { total: os.totalmem(), free: os.freemem() },
      disk: disk ? { total: disk.blocks * disk.bsize, free: disk.bavail * disk.bsize } : null,
      container: await containerMemory(),
      process: { runtime: `Node ${process.version}`, uptimeSec: Math.round(process.uptime()), rss: process.memoryUsage().rss },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

// The backend's token: base64url(payload).base64url(hmac-sha256), payload
// {sid, exp (seconds), scope} — see backend/src/lib/sessions/stt-token.ts.
function validToken(token: string, secret: string) {
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return false;
  const expected = createHmac('sha256', secret).update(payloadB64).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return payload.sid === 'server-stats' && payload.scope === 'server-stats' && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

// cgroup v2 memory use and limit of this container; null outside Docker.
async function containerMemory() {
  const read = (f: string) => readFile(`/sys/fs/cgroup/${f}`, 'utf8').then((s) => s.trim()).catch(() => null);
  const [current, max] = await Promise.all([read('memory.current'), read('memory.max')]);
  if (!current) return null;
  return { used: Number(current), limit: max && max !== 'max' ? Number(max) : null };
}
