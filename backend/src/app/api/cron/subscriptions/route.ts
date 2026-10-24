import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { prisma, appDb } from '@/lib/core/db';
import { audit } from '@/lib/admin/audit';
import { FREE_TIER_ACCESS, daysUntil, resolveCurrent } from '@/lib/billing/subscriptions';
import { usersById } from '@/lib/core/links';

export const dynamic = 'force-dynamic';

// Days-before-end on which a renewal reminder goes out.
const REMINDER_DAYS = [7, 1] as const;
const SYSTEM = { uid: 'system', email: null };

// GET /api/cron/subscriptions — daily job (vercel.json). Auth: `x-cron-secret`
// header or `Authorization: Bearer <CRON_SECRET>`.
// 1. Marks ACTIVE terms past currentPeriodEnd as EXPIRED; professionals left
//    with no current term go back to free-tier tool access.
// 2. Emails renewal reminders 7 days and 1 day (IST calendar days) before a
//    current term ends — once per term + period end + kind, tracked in AuditLog.
// ?dryRun=1 reports what it would do without writing or emailing.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!secret || (request.headers.get('x-cron-secret') !== secret && bearer !== secret)) {
    return NextResponse.json({ error: 'Only the scheduled subscription job can run this.' }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
  const run = dryRun ? null : await appDb.cronRun.create({ data: { job: 'subscriptions', ok: false } });
  const now = new Date();

  try {
    // ── 1. Expire ended terms ────────────────────────────────────────────────
    const ended = await appDb.subscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { lte: now } },
      select: { id: true, therapistId: true, currentPeriodEnd: true, plan: { select: { name: true } } },
    });
    const therapistIds = Array.from(new Set(ended.map((s) => s.therapistId)));

    // Who still has another current term once these are gone?
    const stillActive = await appDb.subscription.findMany({
      where: { therapistId: { in: therapistIds }, status: 'ACTIVE', currentPeriodEnd: { gt: now } },
      select: { therapistId: true },
    });
    const covered = new Set(stillActive.map((s) => s.therapistId));
    const revert = therapistIds.filter((id) => !covered.has(id));

    if (!dryRun && ended.length) {
      await appDb.$transaction([
        appDb.subscription.updateMany({ where: { id: { in: ended.map((s) => s.id) }, status: 'ACTIVE' }, data: { status: 'EXPIRED' } }),
        appDb.profileTherapist.updateMany({ where: { id: { in: revert } }, data: FREE_TIER_ACCESS }),
      ]);
      for (const s of ended) {
        await audit(request, SYSTEM, 'subscription.expire', { type: 'Subscription', id: s.id }, {
          before: { status: 'ACTIVE', currentPeriodEnd: s.currentPeriodEnd },
          after: { status: 'EXPIRED', revertedToFreeTier: !covered.has(s.therapistId) },
        });
      }
    }

    // ── 2. Renewal reminders ─────────────────────────────────────────────────
    const horizon = new Date(now.getTime() + (Math.max(...REMINDER_DAYS) + 2) * 864e5);
    const upcoming = await appDb.subscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { gt: now, lte: horizon } },
      include: {
        plan: true,
        therapist: { select: { id: true, firstName: true, userId: true } },
      },
    });
    const byTherapist = new Map<string, typeof upcoming>();
    for (const s of upcoming) byTherapist.set(s.therapistId, [...(byTherapist.get(s.therapistId) ?? []), s]);

    const due: { sub: (typeof upcoming)[number]; kind: string; days: number }[] = [];
    for (const subs of Array.from(byTherapist.values())) {
      const current = resolveCurrent(subs, now) as (typeof upcoming)[number] | null;
      if (!current) continue;
      const days = daysUntil(current.currentPeriodEnd, now);
      if (!(REMINDER_DAYS as readonly number[]).includes(days)) continue;
      const kind = `d${days}`;
      const sent = await prisma.auditLog.findFirst({
        where: {
          action: 'subscription.reminder',
          targetType: 'Subscription',
          targetId: current.id,
          AND: [
            { after: { path: ['kind'], equals: kind } },
            { after: { path: ['periodEnd'], equals: current.currentPeriodEnd.toISOString() } },
          ],
        },
        select: { id: true },
      });
      if (!sent) due.push({ sub: current, kind, days });
    }

    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpReady = !!(smtpUser && smtpPass);
    let emailed = 0;
    const failed: string[] = [];
    const skipped: string[] = [];

    if (!dryRun && due.length && smtpReady) {
      const port = Number(process.env.SMTP_PORT || 587);
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      // No APP_URL ⇒ no link (the cron has no request origin to fall back on).
      const plansUrl = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/plans` : null;
      const emails = await usersById(due.map(({ sub }) => sub.therapist.userId), { email: true });
      for (const { sub, kind, days } of due) {
        const to = emails.get(sub.therapist.userId)?.email;
        if (!to) { skipped.push(sub.id); continue; }
        try {
          await transporter.sendMail({
            from: process.env.SMTP_FROM || `STAAD <${smtpUser}>`,
            to,
            ...reminderEmail(sub.therapist.firstName, sub.plan.name, sub.currentPeriodEnd, days, plansUrl),
          });
          await audit(request, SYSTEM, 'subscription.reminder', { type: 'Subscription', id: sub.id }, {
            after: { kind, periodEnd: sub.currentPeriodEnd.toISOString(), to },
          });
          emailed++;
        } catch (e: any) {
          console.error(`[cron/subscriptions] reminder to ${to} failed:`, e?.message);
          failed.push(sub.id);
        }
      }
    }

    const detail = {
      dryRun,
      expired: ended.length,
      revertedToFreeTier: revert.length,
      remindersDue: due.length,
      remindersSent: emailed,
      remindersFailed: failed.length,
      remindersSkipped: skipped.length,
      smtpConfigured: smtpReady,
      ...(dryRun
        ? {
            wouldExpire: ended.map((s) => ({ id: s.id, therapistId: s.therapistId, plan: s.plan.name, currentPeriodEnd: s.currentPeriodEnd })),
            wouldRevert: revert,
            wouldRemind: due.map(({ sub, kind }) => ({ id: sub.id, therapistId: sub.therapistId, plan: sub.plan.name, kind, currentPeriodEnd: sub.currentPeriodEnd })),
          }
        : {}),
    };

    if (run) {
      await appDb.cronRun.update({ where: { id: run.id }, data: { ok: failed.length === 0, detail, finishedAt: new Date() } });
    }
    return NextResponse.json({ ok: true, ...detail });
  } catch (error: any) {
    console.error('Cron subscriptions error:', error);
    if (run) {
      await appDb.cronRun
        .update({ where: { id: run.id }, data: { ok: false, detail: { error: error.message }, finishedAt: new Date() } })
        .catch(() => {});
    }
    return NextResponse.json(
      { error: 'The subscription job failed. It will run again on the next schedule.' },
      { status: 500 }
    );
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function reminderEmail(firstName: string, planName: string, end: Date, days: number, url: string | null) {
  const when = days === 1 ? 'tomorrow' : `in ${days} days`;
  const endText = end.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const name = firstName?.trim() || 'there';
  const text = [
    `Hi ${name},`,
    '',
    `Your STAAD ${planName} plan ends ${when} (${endText}).`,
    'To keep your therapy tools without a break, request a renewal from the Plans page in STAAD.',
    ...(url ? [url] : []),
    '',
    'If you have already arranged a renewal, you can ignore this email.',
    '',
    '— Team STAAD',
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#1f2937;line-height:1.5">
      <p>Hi ${esc(name)},</p>
      <p>Your STAAD <strong>${esc(planName)}</strong> plan ends <strong>${when}</strong> (${endText}).</p>
      <p>To keep your therapy tools without a break, request a renewal from the Plans page in STAAD.</p>
      ${url ? `<p><a href="${url}" style="display:inline-block;background:#4a7c6b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">Renew my plan</a></p>` : ''}
      <p style="color:#6b7280;font-size:13px">If you have already arranged a renewal, you can ignore this email.</p>
      <p>— Team STAAD</p>
    </div>
  `;
  return { subject: `Your STAAD ${planName} plan ends ${when}`, text, html };
}
