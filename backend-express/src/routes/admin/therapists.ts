import { Router } from 'express';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { daysAgo, listParams } from '@/lib/admin/adminList';
import { resolveCurrent, serializeSubscription, addMonths } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';
import { audit } from '@/lib/admin/audit';
import nodemailer from 'nodemailer';
import { can } from '@/lib/admin/adminRoles';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/therapists/:id -------------------------------------------------

const USAGE_TYPES = ['AI_ANALYSIS', 'TRANSCRIPTION', 'MODULE_LAUNCH'] as const;
const USAGE_DAYS = 90;

// Client PHI stays hidden here: names are reduced to initials and clinical
// fields are left out. The full record comes from ./phi (audited).
const initial = (s: string | null | undefined) => (s?.trim() ? `${s.trim()[0].toUpperCase()}.` : '');
const maskName = (first: string, last: string) => [initial(first), initial(last)].filter(Boolean).join(' ') || '—';

// GET /api/admin/therapists/[id]
// Full detail view for one therapist: profile + account status, clients and
// sessions (client names masked), invite history, subscription history and
// pending request, usage stats and a 90-day daily usage series per type.
router.get('/admin/therapists/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.read');
    if (!auth.ok) return send(res, auth.response);
    const { id } = req.params;

    const therapist = await appDb.profileTherapist.findUnique({ where: { id } });

    if (!therapist) {
      return res.status(404).json({ error: "We couldn't find this professional. Their account may have been removed." });
    }

    const since = daysAgo(USAGE_DAYS - 1);
    since.setHours(0, 0, 0, 0);

    const [user, sessions, invites, docCount, usage, moduleUsage, subscriptions, pendingRequest, recentUsage] = await Promise.all([
      prisma.user.findUnique({
        where: { id: therapist.userId },
        select: { email: true, createdAt: true, status: true, suspendedAt: true, suspendReason: true, lastSeenAt: true },
      }),
      prisma.session.findMany({
        where: { therapistId: id },
        include: { client: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { scheduledAt: 'desc' },
      }),
      prisma.invite.findMany({
        where: { therapistId: id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.documentChunk.count({ where: { therapistId: id } }),
      appDb.usageEvent.groupBy({ by: ['type'], where: { therapistId: id }, _sum: { count: true } }),
      appDb.usageEvent.groupBy({
        by: ['label'],
        where: { therapistId: id, type: 'MODULE_LAUNCH' },
        _sum: { count: true },
      }),
      appDb.subscription.findMany({
        where: { therapistId: id },
        include: { plan: true },
        orderBy: { startedAt: 'desc' },
      }),
      appDb.subscriptionRequest.findFirst({
        where: { therapistId: id, status: 'PENDING' },
        include: { plan: { select: { id: true, name: true, toolQuota: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      appDb.usageEvent.findMany({
        where: { therapistId: id, type: { in: [...USAGE_TYPES] }, createdAt: { gte: since } },
        select: { type: true, count: true, createdAt: true },
      }),
    ]);

    // Clients seen in sessions plus clients the therapist added directly.
    const linked = await prisma.profileClient.findMany({
      where: { therapistId: id },
      select: { id: true, firstName: true, lastName: true },
    });
    const clientMap = new Map<string, { id: string; firstName: string; lastName: string }>();
    for (const s of sessions) {
      if (s.client && !clientMap.has(s.client.id)) clientMap.set(s.client.id, s.client);
    }
    for (const c of linked) if (!clientMap.has(c.id)) clientMap.set(c.id, c);
    const sessionCounts = new Map<string, { count: number; last: Date | null }>();
    for (const s of sessions) {
      const e = sessionCounts.get(s.clientId) ?? { count: 0, last: null };
      e.count++;
      if (!e.last || s.scheduledAt > e.last) e.last = s.scheduledAt;
      sessionCounts.set(s.clientId, e);
    }
    const clients = Array.from(clientMap.values()).map((c) => ({
      id: c.id,
      name: maskName(c.firstName, c.lastName),
      firstName: initial(c.firstName),
      lastName: initial(c.lastName),
      masked: true,
      sessions: sessionCounts.get(c.id)?.count ?? 0,
      lastSession: sessionCounts.get(c.id)?.last ?? null,
    }));

    // Daily usage buckets (local days), oldest first, zero-filled.
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const days: string[] = [];
    for (let i = 0; i < USAGE_DAYS; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      days.push(dayKey(d));
    }
    const usageDaily: Record<string, { date: string; count: number }[]> = {};
    for (const type of USAGE_TYPES) {
      const byDay = new Map<string, number>();
      for (const e of recentUsage) {
        if (e.type === type) byDay.set(dayKey(e.createdAt), (byDay.get(dayKey(e.createdAt)) ?? 0) + e.count);
      }
      usageDaily[type] = days.map((date) => ({ date, count: byDay.get(date) ?? 0 }));
    }

    const total = sessions.length;
    const active = sessions.filter((s) => s.status === 'ACTIVE').length;
    const completed = sessions.filter((s) => s.status === 'COMPLETED').length;
    const scheduled = sessions.filter((s) => s.status === 'SCHEDULED').length;

    let totalMinutes = 0;
    let lastActive: Date | null = null;
    for (const s of sessions) {
      if (s.startedAt && s.endedAt) {
        totalMinutes += Math.max(0, (s.endedAt.getTime() - s.startedAt.getTime()) / 60000);
      }
      if (!lastActive || s.updatedAt > lastActive) lastActive = s.updatedAt;
    }

    const usageByType = (type: string) => usage.find((u) => u.type === type)?._sum.count ?? 0;
    const invitesPending = invites.filter((i) => i.status === 'PENDING').length;
    const invitesClaimed = invites.filter((i) => i.status === 'CLAIMED').length;

    const topModules = moduleUsage
      .map((m) => ({ id: m.label ?? 'unknown', count: m._sum.count ?? 0 }))
      .sort((a, b) => b.count - a.count);

    return res.json({
      therapist: {
        id: therapist.id,
        userId: therapist.userId,
        name: `${therapist.firstName} ${therapist.lastName}`.trim(),
        email: user?.email ?? '',
        specialty: therapist.specialty,
        qualification: therapist.qualification,
        experience: therapist.experience,
        bio: therapist.bio,
        joinedAt: user?.createdAt ?? therapist.createdAt,
        status: user?.status ?? 'ACTIVE',
        suspendedAt: user?.suspendedAt ?? null,
        suspendReason: user?.suspendReason ?? null,
        lastSeenAt: user?.lastSeenAt ?? null,
        access: {
          allModulesAllowed: therapist.allModulesAllowed,
          moduleAccess: therapist.moduleAccess,
          allowedCount: therapist.allModulesAllowed ? ALL_MODULE_IDS.length : therapist.moduleAccess.length,
          totalModules: ALL_MODULE_IDS.length,
        },
      },
      stats: {
        clients: clients.length,
        sessions: { total, active, completed, scheduled },
        totalMinutes: Math.round(totalMinutes),
        invites: { pending: invitesPending, claimed: invitesClaimed },
        documents: docCount,
        ai: {
          analyses: usageByType('AI_ANALYSIS'),
          transcriptLines: usageByType('TRANSCRIPTION'),
          moduleLaunches: usageByType('MODULE_LAUNCH'),
        },
        topModules,
        lastActive,
      },
      clients,
      billing: {
        current: serializeSubscription(resolveCurrent(subscriptions)),
        history: subscriptions.map((s) => ({
          id: s.id,
          planId: s.planId,
          planName: s.plan.name,
          toolQuota: s.plan.toolQuota,
          status: s.status,
          months: s.months,
          startedAt: s.startedAt,
          currentPeriodEnd: s.currentPeriodEnd,
          renewedAt: s.renewedAt,
          renewalCount: s.renewalCount,
          moduleAccess: s.moduleAccess,
        })),
        pendingRequest: pendingRequest
          ? {
              id: pendingRequest.id,
              planId: pendingRequest.planId,
              planName: pendingRequest.plan.name,
              toolQuota: pendingRequest.plan.toolQuota,
              months: pendingRequest.months,
              modules: pendingRequest.modules,
              note: pendingRequest.note,
              createdAt: pendingRequest.createdAt,
            }
          : null,
      },
      usageDaily,
      sessions: sessions.map((s) => ({
        id: s.id,
        status: s.status,
        scheduledAt: s.scheduledAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMinutes:
          s.startedAt && s.endedAt ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000) : null,
        client: s.client
          ? {
              id: s.client.id,
              name: maskName(s.client.firstName, s.client.lastName),
              firstName: initial(s.client.firstName),
              lastName: initial(s.client.lastName),
            }
          : null,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        name: maskName(i.firstName, i.lastName),
        firstName: initial(i.firstName),
        lastName: initial(i.lastName),
        status: i.status,
        createdAt: i.createdAt,
      })),
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin therapist detail error'));
  }
}));

// ---- /api/admin/therapists/:id/access ------------------------------------------

// PATCH /api/admin/therapists/[id]/access — set a therapist's module access.
// Body: { allModulesAllowed: boolean, moduleAccess: string[] }
router.patch('/admin/therapists/:id/access', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.write');
    if (!auth.ok) return send(res, auth.response);
    const { allModulesAllowed, moduleAccess } = req.body;

    const therapist = await appDb.profileTherapist.findUnique({ where: { id: req.params.id } });
    if (!therapist) {
      return res.status(404).json({ error: "We couldn't find this professional. Their account may have been removed." });
    }

    // Keep only known module ids.
    const cleaned = Array.isArray(moduleAccess)
      ? moduleAccess.filter((m: string) => ALL_MODULE_IDS.includes(m))
      : [];

    const updated = await appDb.profileTherapist.update({
      where: { id: req.params.id },
      data: {
        allModulesAllowed: Boolean(allModulesAllowed),
        moduleAccess: cleaned,
      },
      select: { id: true, allModulesAllowed: true, moduleAccess: true },
    });

    await audit(req, auth, 'therapist.access.update', { type: 'ProfileTherapist', id: req.params.id }, {
      before: { allModulesAllowed: therapist.allModulesAllowed, moduleAccess: therapist.moduleAccess },
      after: { allModulesAllowed: updated.allModulesAllowed, moduleAccess: updated.moduleAccess },
    });

    return res.json({ therapist: updated });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Therapist access PATCH error'));
  }
}));

// ---- /api/admin/therapists/:id/activity ----------------------------------------

// GET /api/admin/therapists/[id]/activity — audit entries whose target is this
// therapist (profile id) or their user account (uid), newest first.
router.get('/admin/therapists/:id/activity', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.read');
    if (!auth.ok) return send(res, auth.response);
    const { skip, take } = listParams(req, { sortable: ['createdAt'], defaultSort: 'createdAt' });

    const therapist = await appDb.profileTherapist.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true } });
    if (!therapist) return res.status(404).json({ error: "We couldn't find this professional. Their account may have been removed." });

    const where = {
      OR: [
        { targetType: { in: ['ProfileTherapist', 'Therapist'] }, targetId: therapist.id },
        { targetType: 'User', targetId: therapist.userId },
      ],
    };
    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.auditLog.count({ where }),
    ]);

    return res.json({
      entries: entries.map((e) => ({
        id: e.id,
        action: e.action,
        actorUid: e.actorUid,
        actorEmail: e.actorEmail,
        targetType: e.targetType,
        targetId: e.targetId,
        before: e.before,
        after: e.after,
        createdAt: e.createdAt,
      })),
      total,
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin therapist activity error', "We couldn't load this professional's activity. Please try again."));
  }
}));

// ---- /api/admin/therapists/:id/grant -------------------------------------------

// POST /api/admin/therapists/[id]/grant — give a therapist a plan without a
// request or payment (comps, sales deals, support credits).
// Body: { planId, months (1-36), modules? }
// Same effect as approving a request: active terms are expired, a new
// Subscription is created and the plan's tool access is applied to the
// therapist (unlimited plans grant all tools; quota plans need 1..quota tools).
router.post('/admin/therapists/:id/grant', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.write');
    if (!auth.ok) return send(res, auth.response);
    const { planId, months, modules } = req.body;

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: req.params.id },
      select: { id: true, allModulesAllowed: true, moduleAccess: true },
    });
    if (!therapist) return res.status(404).json({ error: "We couldn't find this professional. Their account may have been removed." });

    const plan = planId ? await appDb.plan.findUnique({ where: { id: String(planId) } }) : null;
    if (!plan) return res.status(404).json({ error: "We couldn't find this plan. It may have been deleted." });

    const months_ = Number(months);
    if (!Number.isInteger(months_) || months_ < 1 || months_ > 36) {
      return res.status(400).json({ error: 'Enter a number of months from 1 to 36.' });
    }

    const unlimited = plan.toolQuota == null;
    const cleaned = Array.from(
      new Set((Array.isArray(modules) ? modules : []).filter((m: unknown): m is string => typeof m === 'string' && ALL_MODULE_IDS.includes(m)))
    );
    if (!unlimited) {
      if (cleaned.length === 0) {
        return res.status(400).json({ error: 'Select at least one tool to grant.' });
      }
      if (cleaned.length > plan.toolQuota!) {
        return res.status(400).json({ error: `This plan includes up to ${plan.toolQuota} tools. Select fewer tools.` });
      }
    }

    const now = new Date();
    const grantedModules = unlimited ? [] : cleaned;

    const subscription = await appDb.$transaction(async (tx) => {
      // Supersede any existing active terms.
      await tx.subscription.updateMany({
        where: { therapistId: therapist.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });

      const created = await tx.subscription.create({
        data: {
          therapistId: therapist.id,
          planId: plan.id,
          months: months_,
          startedAt: now,
          currentPeriodEnd: addMonths(now, months_),
          moduleAccess: grantedModules,
        },
      });

      // Apply tool access to the therapist (the in-session gate reads these).
      await tx.profileTherapist.update({
        where: { id: therapist.id },
        data: { allModulesAllowed: unlimited, moduleAccess: grantedModules },
      });

      return created;
    });

    await audit(req, auth, 'subscription.grant', { type: 'ProfileTherapist', id: therapist.id }, {
      before: { allModulesAllowed: therapist.allModulesAllowed, moduleAccess: therapist.moduleAccess },
      after: { subscriptionId: subscription.id, planId: plan.id, planName: plan.name, months: months_, moduleAccess: grantedModules },
    });

    return res.json({ success: true, subscription });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin grant plan error', "We couldn't grant this plan. Please try again."));
  }
}));

// ---- /api/admin/therapists/:id/message -----------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// POST /api/admin/therapists/[id]/message — email the therapist from the
// admin portal (support follow-up). Body: { subject, body }. Needs the
// support or people.write permission. 503 when SMTP isn't configured.
router.post('/admin/therapists/:id/message', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return send(res, auth.response);
    if (!can(auth.adminRole, 'support') && !can(auth.adminRole, 'people.write')) {
      return res.status(403).json({ error: "Your admin role doesn't allow this. Ask a super admin if you need access.", code: 'ADMIN_FORBIDDEN' });
    }

    const { subject, body } = req.body;
    const subj = String(subject || '').trim().slice(0, 200);
    const text = String(body || '').trim().slice(0, 10000);
    if (!subj || !text) return res.status(400).json({ error: 'Enter a subject and a message.' });

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: req.params.id },
      select: { id: true, firstName: true, userId: true },
    });
    if (!therapist) return res.status(404).json({ error: "We couldn't find this professional. Their account may have been removed." });
    const to = (await prisma.user.findUnique({ where: { id: therapist.userId }, select: { email: true } }))?.email;
    if (!to) return res.status(400).json({ error: "This professional has no email address, so we can't email them." });

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) {
      return res.status(503).json({ error: "Email isn't set up on the server yet, so nothing was sent. Ask whoever manages hosting to set it up." });
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for 587 (STARTTLS)
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `STAAD <${user}>`,
      to,
      replyTo: auth.email || undefined,
      subject: subj,
      text,
      html: `<div style="font-family:system-ui,Arial,sans-serif;color:#1f2937;line-height:1.5"><p style="white-space:pre-wrap">${esc(text)}</p></div>`,
    });

    await audit(req, auth, 'therapist.message', { type: 'ProfileTherapist', id: therapist.id }, { after: { to, subject: subj } });

    return res.json({ ok: true });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin therapist message error', "We couldn't send the message to this professional. Please try again."));
  }
}));

// ---- /api/admin/therapists/:id/phi ---------------------------------------------

// GET /api/admin/therapists/[id]/phi — full client records (names, DOB,
// diagnosis, contact) for one therapist. Every call is audited as phi.reveal.
router.get('/admin/therapists/:id/phi', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'phi.read');
    if (!auth.ok) return send(res, auth.response);
    const { id } = req.params;

    const therapist = await appDb.profileTherapist.findUnique({ where: { id }, select: { id: true } });
    if (!therapist) return res.status(404).json({ error: "We couldn't find this professional. Their account may have been removed." });

    // Same population as the detail view: linked clients + anyone they've had a session with.
    const clients = await prisma.profileClient.findMany({
      where: { OR: [{ therapistId: id }, { sessions: { some: { therapistId: id } } }] },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        diagnosis: true,
        parentEmail: true,
        phoneNumber: true,
        createdAt: true,
        user: { select: { email: true } },
      },
      orderBy: { firstName: 'asc' },
    });

    await audit(req, auth, 'phi.reveal', { type: 'ProfileTherapist', id }, { after: { scope: 'therapist.clients', clientIds: clients.map((c) => c.id) } });

    return res.json({
      clients: clients.map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        firstName: c.firstName,
        lastName: c.lastName,
        dateOfBirth: c.dateOfBirth,
        gender: c.gender,
        diagnosis: c.diagnosis,
        parentEmail: c.parentEmail,
        phoneNumber: c.phoneNumber,
        email: c.user?.email ?? null,
        createdAt: c.createdAt,
      })),
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin therapist PHI error', "We couldn't load this professional's client details. Please try again."));
  }
}));

// ---- /api/admin/therapists/:id/track-usage -------------------------------------

// PATCH /api/admin/therapists/[id]/track-usage — turn usage tracking on or off.
// Body: { trackUsage: boolean }. Off: no usage events are stored for this
// therapist and the Usage & cost page leaves them out. Earlier events are kept.
router.patch('/admin/therapists/:id/track-usage', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.write');
    if (!auth.ok) return send(res, auth.response);
    const { trackUsage } = req.body;
    if (typeof trackUsage !== 'boolean') {
      return res.status(400).json({ error: 'Choose whether to track this professional’s usage.' });
    }

    const therapist = await appDb.profileTherapist.findUnique({ where: { id: req.params.id }, select: { trackUsage: true } });
    if (!therapist) {
      return res.status(404).json({ error: "We couldn't find this professional. Their account may have been removed." });
    }

    const updated = await appDb.profileTherapist.update({
      where: { id: req.params.id },
      data: { trackUsage },
      select: { id: true, trackUsage: true },
    });

    await audit(req, auth, 'therapist.trackUsage.update', { type: 'ProfileTherapist', id: req.params.id }, {
      before: { trackUsage: therapist.trackUsage },
      after: { trackUsage },
    });

    return res.json({ therapist: updated });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Therapist track-usage PATCH error'));
  }
}));
