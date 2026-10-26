import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { Prisma } from '@prisma/client';
import { Prisma as AppPrisma } from '.prisma/app-client';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { firebasePrivateKey } from '@/lib/core/firebaseKey'
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

type Status = 'ok' | 'warn' | 'down';
interface Check {
  id: string;
  label: string;
  status: Status;
  latencyMs: number | null;
  message: string;
}

// GET /api/admin/health — live checks of every dependency (run in parallel,
// each with a short timeout) and the last cron runs. Messages are written
// here, never copied from errors, so URLs and secrets can't leak.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'settings');
    if (!auth.ok) return auth.response;

    const checks = await Promise.all([checkDb(), checkAppDb(), checkLiveKit(), ...(await checkAiService()), checkAutomation(), checkSmtp(), checkFirebase()]);

    const jobs = await appDb.cronRun.findMany({ distinct: ['job'], select: { job: true } });
    const names = Array.from(new Set(['cleanup-transcripts', ...jobs.map((j) => j.job)]));
    const cron = await Promise.all(
      names.map(async (job) => ({
        job,
        runs: await appDb.cronRun.findMany({ where: { job }, orderBy: { startedAt: 'desc' }, take: 10 }),
      }))
    );

    return NextResponse.json({ checkedAt: new Date(), checks, cron });
  } catch (error: any) {
    return errorResponse(error, 'Admin health error', "We couldn't check system health. Please try again.");
  }
}

async function timed<T>(fn: () => Promise<T>) {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

const isTimeout = (e: any) => e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timed? ?out/i.test(e?.message || '');

async function checkDb(): Promise<Check> {
  return checkDatabase({ id: 'db', label: 'Database (HIPAA)' }, prisma, Prisma.dmmf.datamodel.models);
}

async function checkAppDb(): Promise<Check> {
  return checkDatabase({ id: 'app-db', label: 'Database (app)' }, appDb, AppPrisma.dmmf.datamodel.models);
}

type RawClient = { $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> };
type Models = ReadonlyArray<{ name: string; dbName: string | null; fields: ReadonlyArray<{ name: string; kind: string; dbName?: string | null }> }>;

// Connects, then compares the live tables/columns with the Prisma schema, so a
// migration that was never applied shows here instead of as a failing page.
async function checkDatabase(base: { id: string; label: string }, db: RawClient, models: Models): Promise<Check> {
  try {
    const { value: rows, ms } = await timed(() =>
      Promise.race([
        db.$queryRaw<{ t: string; c: string }[]>`SELECT table_name::text AS t, column_name::text AS c FROM information_schema.columns WHERE table_schema = current_schema()`,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ])
    );
    const tables = new Set(rows.map((r) => r.t));
    const columns = new Set(rows.map((r) => `${r.t}.${r.c}`));
    const missing: string[] = [];
    for (const m of models) {
      const table = m.dbName || m.name;
      if (!tables.has(table)) {
        missing.push(`table ${table}`);
        continue;
      }
      for (const f of m.fields) {
        if (f.kind !== 'object' && !columns.has(`${table}.${f.dbName || f.name}`)) missing.push(`${table}.${f.dbName || f.name}`);
      }
    }
    if (missing.length) {
      const list = missing.slice(0, 3).join(', ') + (missing.length > 3 ? ` and ${missing.length - 3} more` : '');
      return { ...base, status: 'warn', latencyMs: ms, message: `Connected, but a database update was not applied (missing ${list}).` };
    }
    return { ...base, status: ms > 1000 ? 'warn' : 'ok', latencyMs: ms, message: ms > 1000 ? 'Up to date, but responding slowly.' : 'Connected and up to date.' };
  } catch (e: any) {
    return { ...base, status: 'down', latencyMs: null, message: isTimeout(e) ? 'No answer within 5s.' : 'Query failed.' };
  }
}

// Any HTTP answer means the host is up; only network failures/timeouts are "down".
async function reach(url: string, timeoutMs = 4000) {
  return timed(() => fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' }));
}

const toHttp = (url: string) => url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');

async function checkLiveKit(): Promise<Check> {
  const base = { id: 'livekit', label: 'LiveKit (video)' };
  const configured = !!(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
  if (!configured) return { ...base, status: 'down', latencyMs: null, message: 'API key/secret not configured.' };
  const url = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!url) return { ...base, status: 'warn', latencyMs: null, message: 'Configured. Server URL not set on the backend, so reachability was not checked.' };
  try {
    const { ms } = await reach(toHttp(url));
    return { ...base, status: 'ok', latencyMs: ms, message: 'Configured and reachable.' };
  } catch (e) {
    return { ...base, status: 'down', latencyMs: null, message: isTimeout(e) ? 'Configured, but no answer within 4s.' : 'Configured, but unreachable.' };
  }
}

interface AiHealth {
  authConfigured?: boolean;
  sarvamConfigured?: boolean;
  assistantConfigured?: boolean;
  callPlanConfigured?: boolean;
}

// The AI service (ai/) runs STT, the AI Assistant (insights + reports) and AI
// Notes (call plan). One /health call reports which of them are set up; each
// gets its own card.
async function checkAiService(): Promise<Check[]> {
  const stt = { id: 'stt', label: 'Speech-to-text (STT)' };
  const assistant = { id: 'ai-assistant', label: 'AI Assistant' };
  const notes = { id: 'ai-notes', label: 'AI Notes' };
  const all = (status: Status, message: string, latencyMs: number | null = null): Check[] =>
    [stt, assistant, notes].map((base) => ({ ...base, status, latencyMs, message }));

  const url = process.env.STT_RELAY_URL || process.env.NEXT_PUBLIC_STT_RELAY_URL;
  if (!url) return all('warn', 'AI service URL (STT_RELAY_URL) not set on the backend, so it was not checked.');
  let data: AiHealth;
  let ms: number;
  try {
    const r = await reach(`${toHttp(url).replace(/\/+$/, '')}/health`);
    ms = r.ms;
    if (!r.value.ok) return all('down', `AI service health check answered ${r.value.status}.`, ms);
    data = await r.value.json().catch(() => ({}));
  } catch (e) {
    return all('down', isTimeout(e) ? 'AI service gave no answer within 4s.' : 'AI service is unreachable.');
  }

  // Tokens are minted here and verified there; a secret missing on either side
  // gets connections refused in production.
  const secretMissingOn = [!process.env.STT_TOKEN_SECRET && 'the backend', data.authConfigured === false && 'the AI service'].filter(Boolean);
  const authMissing = process.env.NODE_ENV === 'production' && secretMissingOn.length > 0;
  const authWarn = `STT_TOKEN_SECRET is not set on ${secretMissingOn.join(' or ')}, so connections are refused.`;
  const llmMissing = 'OPENROUTER_API_KEY not set on the AI service';
  const feature = (base: { id: string; label: string }, configured: boolean | undefined, off: string, ready: string): Check =>
    configured === false
      ? { ...base, status: 'down', latencyMs: ms, message: off }
      : authMissing
        ? { ...base, status: 'warn', latencyMs: ms, message: authWarn }
        : configured === undefined
          ? { ...base, status: 'warn', latencyMs: ms, message: 'AI service is running, but this version does not report whether this feature is set up.' }
          : { ...base, status: 'ok', latencyMs: ms, message: ready };

  return [
    feature(stt, data.sarvamConfigured, 'SARVAM_API_KEY not set on the AI service, so live transcription and captions are off.', 'Running and the Sarvam key is set.'),
    feature(assistant, data.assistantConfigured ?? data.callPlanConfigured, `${llmMissing}, so AI insights and session reports are off.`, 'Running and the OpenRouter key is set.'),
    feature(notes, data.callPlanConfigured, `${llmMissing}, so the AI Notes call plan is off.`, 'Running and the OpenRouter key is set.'),
  ];
}

// n8n runs the scheduled WhatsApp workflows; they call /api/automation/* with
// AUTOMATION_API_KEY, so both n8n and the key have to be in place.
async function checkAutomation(): Promise<Check> {
  const base = { id: 'automation', label: 'Automation (n8n)' };
  if (!process.env.AUTOMATION_API_KEY) {
    return { ...base, status: 'down', latencyMs: null, message: 'AUTOMATION_API_KEY not set, so every workflow call is rejected.' };
  }
  const url = process.env.N8N_URL;
  if (!url) return { ...base, status: 'warn', latencyMs: null, message: 'API key set. n8n URL (N8N_URL) not set on the backend, so it was not checked.' };
  try {
    const { value: res, ms } = await reach(`${url.replace(/\/+$/, '')}/healthz`);
    return res.ok
      ? { ...base, status: 'ok', latencyMs: ms, message: 'n8n is running and the API key is set.' }
      : { ...base, status: 'down', latencyMs: ms, message: `n8n health check answered ${res.status}.` };
  } catch (e) {
    return { ...base, status: 'down', latencyMs: null, message: isTimeout(e) ? 'No answer within 4s.' : 'n8n is unreachable.' };
  }
}

async function checkSmtp(): Promise<Check> {
  const base = { id: 'smtp', label: 'Email (SMTP)' };
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return { ...base, status: 'down', latencyMs: null, message: 'SMTP user/password not configured.' };
  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });
  try {
    const { ms } = await timed(() =>
      Promise.race([transporter.verify(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))])
    );
    return { ...base, status: 'ok', latencyMs: ms, message: 'Signed in to the mail server.' };
  } catch (e: any) {
    const authFailed = e?.code === 'EAUTH';
    return { ...base, status: 'down', latencyMs: null, message: isTimeout(e) ? 'No answer within 5s.' : authFailed ? 'Mail server rejected the credentials.' : 'Could not connect to the mail server.' };
  } finally {
    transporter.close();
  }
}

async function checkFirebase(): Promise<Check> {
  const base = { id: 'firebase', label: 'Firebase admin' };
  const ok = !!(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && firebasePrivateKey());
  return ok
    ? { ...base, status: 'ok', latencyMs: null, message: 'Service account configured.' }
    : { ...base, status: 'down', latencyMs: null, message: 'Service account not configured (transcript cleanup and admin invites need it).' };
}
