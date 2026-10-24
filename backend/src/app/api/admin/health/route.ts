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

    const checks = await Promise.all([checkDb(), checkAppDb(), checkLiveKit(), checkSttRelay(), checkWhatsAppBot(), checkAutomation(), checkSmtp(), checkFirebase()]);

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

async function checkSttRelay(): Promise<Check> {
  const base = { id: 'stt', label: 'Transcription relay' };
  const url = process.env.STT_RELAY_URL || process.env.NEXT_PUBLIC_STT_RELAY_URL;
  if (!url) return { ...base, status: 'warn', latencyMs: null, message: 'Relay URL not set on the backend, so it was not checked.' };
  try {
    const { ms } = await reach(toHttp(url));
    return { ...base, status: 'ok', latencyMs: ms, message: 'Reachable.' };
  } catch (e) {
    return { ...base, status: 'down', latencyMs: null, message: isTimeout(e) ? 'No answer within 4s.' : 'Unreachable.' };
  }
}

async function checkWhatsAppBot(): Promise<Check> {
  const base = { id: 'whatsapp', label: 'WhatsApp bot' };
  const url = process.env.WHATSAPP_BOT_URL;
  if (!url) return { ...base, status: 'warn', latencyMs: null, message: 'Bot URL not configured.' };
  try {
    const { value: res, ms } = await reach(`${url.replace(/\/+$/, '')}/health`);
    if (res.status === 404) return { ...base, status: 'warn', latencyMs: ms, message: 'Reachable, but this bot version has no /health endpoint.' };
    if (!res.ok) return { ...base, status: 'down', latencyMs: ms, message: `Health check answered ${res.status}.` };
    const data = await res.json().catch(() => ({}));
    return data.connected === false
      ? { ...base, status: 'warn', latencyMs: ms, message: 'Bot is running but WhatsApp is not paired/connected.' }
      : { ...base, status: 'ok', latencyMs: ms, message: 'Running and connected.' };
  } catch (e) {
    return { ...base, status: 'down', latencyMs: null, message: isTimeout(e) ? 'No answer within 4s.' : 'Unreachable.' };
  }
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
