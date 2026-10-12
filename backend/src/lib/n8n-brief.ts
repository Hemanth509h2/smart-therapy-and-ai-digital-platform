import { prisma } from '@/lib/db';
import { normalizePhoneNumber } from '@/lib/phone';

// Message builders for the n8n WhatsApp assistant: the morning brief and the
// replies to therapist commands (CLIENTS, WEEK, PENDING, SESSION <id>, HELP).
// Times are shown in India time, since that's where therapists and clients are.

const TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const HELP_FOOTER = [
  '💬 *Reply with:*',
  '• `CLIENTS` — full client list',
  "• `WEEK` — this week's schedule",
  '• `PENDING` — notes to write',
  '• `SESSION <id>` — session details',
  '• `HELP` — commands',
].join('\n');

/** Midnight in India, as a UTC instant, `days` from today. */
function istMidnight(days = 0): Date {
  const now = new Date(Date.now() + IST_OFFSET_MS);
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - IST_OFFSET_MS;
  return new Date(midnight + days * DAY_MS);
}

const time = (d: Date) => d.toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const day = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();
const doctor = (t: { firstName: string; lastName: string }) => `Dr. ${fullName(t) || 'there'}`;

/** E.164 (+91…) for sending; therapists may be stored with or without the +. */
export function phoneForms(raw: string): { e164: string; forms: string[] } | null {
  try {
    const e164 = normalizePhoneNumber(raw);
    return { e164, forms: [e164, e164.slice(1)] };
  } catch {
    return null;
  }
}

export async function findTherapistByPhone(raw: string) {
  const p = phoneForms(raw);
  if (!p) return null;
  return prisma.profileTherapist.findFirst({ where: { phoneNumber: { in: p.forms } } });
}

type Therapist = { id: string; firstName: string; lastName: string };

async function sessionsBetween(therapistId: string, from: Date, to: Date) {
  return prisma.session.findMany({
    where: { therapistId, scheduledAt: { gte: from, lt: to }, status: { in: ['SCHEDULED', 'ACTIVE'] } },
    include: { client: { select: { firstName: true, lastName: true, diagnosis: true } } },
    orderBy: { scheduledAt: 'asc' },
  });
}

/** The morning brief: greeting, today's sessions, the command list. */
export async function buildMorningBrief(t: Therapist): Promise<string> {
  const today = await sessionsBetween(t.id, istMidnight(0), istMidnight(1));
  const lines = today.length
    ? today.map((s, i) => [
        `${i + 1}. ⏰ ${time(s.scheduledAt)} • ${fullName(s.client)}`,
        s.client.diagnosis.length ? `   📋 ${s.client.diagnosis.join(', ')}` : null,
        `   🆔 \`${s.id}\``,
      ].filter(Boolean).join('\n'))
    : ['_No sessions scheduled_'];
  return [`🌅 *Good Morning ${doctor(t)}!*`, '', "📅 *Today's Schedule:*", ...lines, '', HELP_FOOTER].join('\n');
}

async function clientsReply(t: Therapist): Promise<string> {
  // Directly added clients plus anyone they've had a session with.
  const viaSessions = await prisma.session.findMany({ where: { therapistId: t.id }, select: { clientId: true }, distinct: ['clientId'] });
  const clients = await prisma.profileClient.findMany({
    where: { OR: [{ therapistId: t.id }, { id: { in: viaSessions.map(s => s.clientId) } }] },
    select: { firstName: true, lastName: true, diagnosis: true },
    orderBy: { firstName: 'asc' },
  });
  if (!clients.length) return '👥 *Your Clients*\n\n_No clients yet_';
  const list = clients.map((c, i) => `${i + 1}. ${fullName(c)}${c.diagnosis.length ? ` — ${c.diagnosis.join(', ')}` : ''}`);
  return [`👥 *Your Clients (${clients.length})*`, '', ...list].join('\n');
}

async function weekReply(t: Therapist): Promise<string> {
  const sessions = await sessionsBetween(t.id, istMidnight(0), istMidnight(7));
  if (!sessions.length) return '🗓️ *Next 7 Days*\n\n_No sessions scheduled_';
  const lines: string[] = [];
  let lastDay = '';
  for (const s of sessions) {
    const d = day(s.scheduledAt);
    if (d !== lastDay) { lines.push('', `*${d}*`); lastDay = d; }
    lines.push(`⏰ ${time(s.scheduledAt)} • ${fullName(s.client)}  🆔 \`${s.id}\``);
  }
  return ['🗓️ *Next 7 Days*', ...lines].join('\n');
}

async function pendingReply(t: Therapist): Promise<string> {
  // Completed in the last 30 days with no therapist note yet.
  const sessions = await prisma.session.findMany({
    where: { therapistId: t.id, status: 'COMPLETED', scheduledAt: { gte: new Date(Date.now() - 30 * DAY_MS) }, notes: { none: {} } },
    include: { client: { select: { firstName: true, lastName: true } } },
    orderBy: { scheduledAt: 'desc' },
  });
  if (!sessions.length) return '📝 *Pending Notes*\n\n✅ All caught up — no notes to write.';
  const list = sessions.map((s, i) => `${i + 1}. ${day(s.scheduledAt)} • ${fullName(s.client)}  🆔 \`${s.id}\``);
  return [`📝 *Pending Notes (${sessions.length})*`, '', ...list].join('\n');
}

async function sessionReply(t: Therapist, idPart: string): Promise<string> {
  const id = idPart.trim().replace(/`/g, '');
  if (id.length < 6) return 'Send `SESSION <id>` with the session id from your schedule.';
  const s = await prisma.session.findFirst({
    where: { therapistId: t.id, id: { startsWith: id } },
    include: { client: { select: { firstName: true, lastName: true, diagnosis: true } }, _count: { select: { notes: true } }, report: { select: { id: true } } },
  });
  if (!s) return `No session of yours matches \`${id}\`.`;
  return [
    '📄 *Session Details*',
    '',
    `👤 ${fullName(s.client)}`,
    s.client.diagnosis.length ? `📋 ${s.client.diagnosis.join(', ')}` : null,
    `📅 ${day(s.scheduledAt)}, ${time(s.scheduledAt)}`,
    `📌 Status: ${s.status.charAt(0) + s.status.slice(1).toLowerCase()}`,
    s.status === 'COMPLETED' ? `📝 Notes: ${s._count.notes || 'none yet'} · Report: ${s.report ? 'ready' : 'not yet'}` : null,
    `🆔 \`${s.id}\``,
  ].filter(Boolean).join('\n');
}

/** Reply to a therapist's WhatsApp command. Unknown text gets the help list. */
export async function commandReply(t: Therapist, text: string): Promise<string> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  switch ((cmd || '').toUpperCase()) {
    case 'CLIENTS': return clientsReply(t);
    case 'WEEK': return weekReply(t);
    case 'PENDING': return pendingReply(t);
    case 'SESSION': return sessionReply(t, rest.join(' '));
    case 'TODAY': return buildMorningBrief(t);
    default: return [`👋 Hi ${doctor(t)}!`, '', HELP_FOOTER].join('\n');
  }
}
