import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import type { Prisma as AppPrisma } from '.prisma/app-client';
import { prisma, appDb } from '@/lib/core/db';
import { usersById } from '@/lib/core/links';
import { mailConfigured, sendMail } from '@/lib/core/mail';
import { requireAdmin, requireRecentLogin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { adminAuth } from '@/lib/core/firebaseAdmin';
import { appUrl } from '@/lib/core/app-url';
import { dateRange, daysAgo, listParams } from '@/lib/admin/adminList';
import { resolveCurrent } from '@/lib/billing/subscriptions';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { errorResponse, logError } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/professionals --------------------------------------------------

const SORTABLE = ['name', 'createdAt', 'lastActive', 'sessions', 'clients'];

// GET /api/admin/professionals — searchable, filterable, paginated therapist list.
// ?q=name/email/phone &status=active|inactive|suspended &plan=<planId>|none
// &from/&to=signup date &sort=name|createdAt|lastActive|sessions|clients &dir
// "Active" = signed in or had a session in the last 30 days (and not suspended).
router.get('/admin/professionals', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.read');
    if (!auth.ok) return send(res, auth.response);
    const { sp, skip, take, sort, dir, q, from, to } = listParams(req, { sortable: SORTABLE, defaultSort: 'createdAt' });

    const now = new Date();
    const cutoff = daysAgo(30);
    const currentTerm: AppPrisma.SubscriptionWhereInput = { status: 'ACTIVE', currentPeriodEnd: { gt: now } };
    const recentSession: Prisma.SessionWhereInput = { OR: [{ startedAt: { gte: cutoff } }, { scheduledAt: { gte: cutoff, lte: now } }] };

    // Users and sessions live in the HIPAA database, so resolve the
    // user-based filters per therapist here and filter therapists by id.
    const [all, recent] = await Promise.all([
      appDb.profileTherapist.findMany({ select: { id: true, userId: true } }),
      prisma.session.groupBy({ by: ['therapistId'], where: recentSession }),
    ]);
    const users = await usersById(all.map((t) => t.userId), {
      email: true, status: true, suspendedAt: true, suspendReason: true, lastSeenAt: true,
    });
    const userIdOf = new Map(all.map((t) => [t.id, t.userId]));
    const userOf = (id: string) => users.get(userIdOf.get(id) ?? '');
    const hadSession = new Set(recent.map((r) => r.therapistId));
    const pick = (test: (id: string, u: NonNullable<ReturnType<typeof userOf>>) => boolean) =>
      all.filter((t) => {
        const u = users.get(t.userId);
        return !!u && test(t.id, u);
      }).map((t) => t.id);
    const seenRecently = (u: { lastSeenAt: Date | null }) => !!u.lastSeenAt && u.lastSeenAt >= cutoff;
    const activeIds = pick((id, u) => u.status === 'ACTIVE' && (seenRecently(u) || hadSession.has(id)));
    const inactiveIds = pick((id, u) => u.status === 'ACTIVE' && !seenRecently(u) && !hadSession.has(id));
    const suspendedIds = pick((_, u) => u.status === 'SUSPENDED');

    const and: AppPrisma.ProfileTherapistWhereInput[] = [];
    if (q) {
      // Phone numbers are stored as digits with the country code, so a query
      // that looks like a phone number ("+91 98765-43210") is matched as one
      // run of digits; otherwise each word may also match part of the number.
      const phoneDigits = /^[\d\s+()-]+$/.test(q) ? q.replace(/\D/g, '') : '';
      const words = phoneDigits ? [phoneDigits] : q.split(/\s+/).filter(Boolean);
      and.push(
        ...words.map((w) => {
          const digits = w.replace(/\D/g, '');
          return {
            OR: [
              { firstName: { contains: w, mode: 'insensitive' as const } },
              { lastName: { contains: w, mode: 'insensitive' as const } },
              { id: { in: pick((_, u) => u.email.toLowerCase().includes(w.toLowerCase())) } },
              ...(digits.length >= 3 ? [{ phoneNumber: { contains: digits } }] : []),
            ],
          };
        })
      );
    }
    const status = sp.get('status');
    if (status === 'suspended') and.push({ id: { in: suspendedIds } });
    else if (status === 'active') and.push({ id: { in: activeIds } });
    else if (status === 'inactive') and.push({ id: { in: inactiveIds } });
    const plan = sp.get('plan');
    if (plan === 'none') and.push({ subscriptions: { none: currentTerm } });
    else if (plan) and.push({ subscriptions: { some: { ...currentTerm, planId: plan } } });
    const created = dateRange(from, to);
    if (created) and.push({ createdAt: created });
    const where: AppPrisma.ProfileTherapistWhereInput = and.length ? { AND: and } : {};

    // name/createdAt sort in the DB and fetch only the page; the computed
    // columns need every matching id, then sort + slice in memory.
    const dbSort = sort === 'name' || sort === 'createdAt';
    const orderBy: AppPrisma.ProfileTherapistOrderByWithRelationInput[] =
      sort === 'name' ? [{ firstName: dir }, { lastName: dir }, { id: 'asc' }] : [{ createdAt: dir }, { id: 'asc' }];

    const [total, idRows, kpiOnPlan, plans] = await Promise.all([
      appDb.profileTherapist.count({ where }),
      appDb.profileTherapist.findMany({ where, select: { id: true }, orderBy, ...(dbSort ? { skip, take } : {}) }),
      appDb.profileTherapist.count({ where: { subscriptions: { some: currentTerm } } }),
      appDb.plan.findMany({ select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ]);

    let ids = idRows.map((r) => r.id);
    let stats = await statsFor(ids, now, (id) => userOf(id)?.lastSeenAt ?? null);
    if (!dbSort) {
      const key = (id: string) => {
        const s = stats.get(id)!;
        return sort === 'sessions' ? s.sessionsTotal : sort === 'clients' ? s.clients : s.lastActive?.getTime() ?? 0;
      };
      ids = [...ids].sort((a, b) => (dir === 'asc' ? key(a) - key(b) : key(b) - key(a))).slice(skip, skip + take);
      stats = new Map(ids.map((id) => [id, stats.get(id)!]));
    }

    const [therapists, subs] = await Promise.all([
      appDb.profileTherapist.findMany({ where: { id: { in: ids } } }),
      appDb.subscription.findMany({ where: { therapistId: { in: ids }, ...currentTerm }, include: { plan: true } }),
    ]);
    const byId = new Map(therapists.map((t) => [t.id, t]));

    const professionals = ids
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => {
        const s = stats.get(t.id)!;
        const current = resolveCurrent(subs.filter((x) => x.therapistId === t.id), now);
        const u = userOf(t.id);
        return {
          id: t.id,
          userId: t.userId,
          name: `${t.firstName} ${t.lastName}`.trim(),
          email: u?.email ?? '',
          specialty: t.specialty,
          createdAt: t.createdAt,
          status: u?.status ?? 'ACTIVE',
          suspendedAt: u?.suspendedAt ?? null,
          suspendReason: u?.suspendReason ?? null,
          lastSeenAt: u?.lastSeenAt ?? null,
          lastActive: s.lastActive,
          clients: s.clients,
          sessions: { total: s.sessionsTotal, completed: s.sessionsCompleted },
          plan: current ? { id: current.planId, name: current.plan.name, endsAt: current.currentPeriodEnd } : null,
          access: {
            allModulesAllowed: t.allModulesAllowed,
            moduleAccess: t.moduleAccess,
            allowedCount: t.allModulesAllowed ? ALL_MODULE_IDS.length : t.moduleAccess.length,
            totalModules: ALL_MODULE_IDS.length,
          },
        };
      });

    return res.json({
      professionals,
      total,
      kpis: { total: all.length, active30d: activeIds.length, suspended: suspendedIds.length, onPlan: kpiOnPlan },
      plans,
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin professionals GET error', "We couldn't load the professionals list. Please try again."));
  }
}));

const latest = (a: Date | null | undefined, b: Date | null | undefined) =>
  !a ? b ?? null : !b ? a : a > b ? a : b;

// Session counts, distinct clients (linked or seen in a session) and last
// activity (latest sign-in or session) for a set of therapists, in a handful
// of grouped queries.
async function statsFor(ids: string[], now: Date, lastSeen: (id: string) => Date | null) {
  const out = new Map<string, { sessionsTotal: number; sessionsCompleted: number; clients: number; lastActive: Date | null }>();
  for (const id of ids) out.set(id, { sessionsTotal: 0, sessionsCompleted: 0, clients: 0, lastActive: lastSeen(id) });
  if (!ids.length) return out;

  const [byStatus, started, scheduled, sessionClients, linkedClients] = await Promise.all([
    prisma.session.groupBy({ by: ['therapistId', 'status'], where: { therapistId: { in: ids } }, _count: { _all: true } }),
    prisma.session.groupBy({ by: ['therapistId'], where: { therapistId: { in: ids } }, _max: { startedAt: true } }),
    prisma.session.groupBy({ by: ['therapistId'], where: { therapistId: { in: ids }, scheduledAt: { lte: now } }, _max: { scheduledAt: true } }),
    prisma.session.groupBy({ by: ['therapistId', 'clientId'], where: { therapistId: { in: ids } } }),
    prisma.profileClient.findMany({ where: { therapistId: { in: ids } }, select: { id: true, therapistId: true } }),
  ]);

  for (const g of byStatus) {
    const s = out.get(g.therapistId)!;
    s.sessionsTotal += g._count._all;
    if (g.status === 'COMPLETED') s.sessionsCompleted += g._count._all;
  }
  for (const g of [...started.map((x) => [x.therapistId, x._max.startedAt] as const), ...scheduled.map((x) => [x.therapistId, x._max.scheduledAt] as const)]) {
    const s = out.get(g[0])!;
    s.lastActive = latest(s.lastActive, g[1]);
  }
  const clientSets = new Map<string, Set<string>>();
  const addClient = (tid: string, cid: string) => {
    if (!clientSets.has(tid)) clientSets.set(tid, new Set());
    clientSets.get(tid)!.add(cid);
  };
  for (const g of sessionClients) addClient(g.therapistId, g.clientId);
  for (const c of linkedClients) if (c.therapistId) addClient(c.therapistId, c.id);
  for (const [tid, set] of clientSets) out.get(tid)!.clients = set.size;
  return out;
}

// POST /api/admin/professionals — create a professional (therapist) account.
// Body: { email, firstName, lastName?, phoneNumber, specialty?: string[], password? }
// Creates the Firebase sign-in, the User (HIPAA db) and the ProfileTherapist
// (app db) — the same records self-signup + onboarding create. Without a
// password, the professional is emailed a link to set their own; the link is
// also returned so the admin can share it if email isn't set up. An email
// that already has a Firebase sign-in but never finished onboarding is reused.
router.post('/admin/professionals', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.write');
    if (!auth.ok) return send(res, auth.response);
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return send(res, stepUp);

    const body = req.body;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const specialty: string[] = Array.isArray(body.specialty)
      ? Array.from(new Set(body.specialty.map((s: unknown) => String(s).trim()).filter(Boolean)))
      : [];

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter the professional's email address." });
    }
    if (!firstName) return res.status(400).json({ error: "Enter the professional's first name." });
    if (password && password.length < 8) {
      return res.status(400).json({ error: 'The password must be at least 8 characters.' });
    }
    // Same rule as onboarding: digits with country code, default 91.
    const digits = String(body.phoneNumber ?? '').replace(/\D/g, '');
    if (digits.length < 10) {
      return res.status(400).json({ error: 'Enter a valid phone number with at least 10 digits.' });
    }
    const phoneNumber = digits.length === 10 ? `91${digits}` : digits;

    const fb = adminAuth();
    let uid: string;
    let createdFirebaseUser = false;
    const existing = await fb.getUserByEmail(email).catch(() => null);
    if (existing) {
      uid = existing.uid;
      if (await prisma.user.findUnique({ where: { id: uid }, select: { id: true } })) {
        return res.status(409).json({ error: `An account with ${email} already exists. Find it in the professionals list instead.` });
      }
      // Someone already signed up with this email but never finished. The
      // sign-in belongs to them, so an admin may attach a profile to it but
      // never set or reset its password (that would hand the admin the account).
      if (password) {
        return res.status(409).json({
          error: `${email} already has a STAAD sign-in. Create the profile without setting a password; they keep signing in with their own password (or "Forgot password").`,
        });
      }
    } else {
      uid = '';
    }

    const phoneTaken = await appDb.profileTherapist.findUnique({ where: { phoneNumber }, select: { id: true } });
    if (phoneTaken) {
      return res.status(409).json({ error: 'This phone number is already used by another professional. Use a different number.' });
    }

    if (!existing) {
      const created = await fb.createUser({
        email,
        displayName: `${firstName} ${lastName}`.trim(),
        ...(password ? { password } : {}),
      });
      uid = created.uid;
      createdFirebaseUser = true;
    }

    // Two databases, so not atomic: undo what was created if a later step fails.
    let profile;
    try {
      await prisma.user.create({ data: { id: uid, email, role: 'THERAPIST' } });
      try {
        profile = await appDb.profileTherapist.create({
          data: { userId: uid, firstName, lastName, specialty, phoneNumber },
        });
      } catch (e) {
        await prisma.user.delete({ where: { id: uid } }).catch(() => {});
        throw e;
      }
    } catch (e) {
      if (createdFirebaseUser) await fb.deleteUser(uid).catch(() => {});
      throw e;
    }

    // Role claim for Firestore rules (see users/profile POST). Non-fatal.
    try {
      const record = await fb.getUser(uid);
      await fb.setCustomUserClaims(uid, { ...(record.customClaims ?? {}), role: 'THERAPIST' });
    } catch (e: any) {
      logError(`Failed to set role claim for ${uid}`, e);
    }

    // No password chosen: send a link to set one (also returned so the admin
    // can share it on WhatsApp). Not for a sign-in that already existed: its
    // owner already has a password, and a reset link handed to the admin
    // would let the admin take the account over.
    let setupLink: string | null = null;
    let emailed = false;
    if (!password && createdFirebaseUser) {
      // The account already exists by now, so a missing APP_URL must not fail
      // the request: no link, and the admin is told to use "Forgot password".
      let signInUrl: string | null = null;
      try {
        signInUrl = `${appUrl(req)}/auth`;
      } catch (e) {
        logError('Password setup link skipped', e);
      }
      setupLink = signInUrl
        ? await fb.generatePasswordResetLink(email, { url: signInUrl }).catch((e: any) => {
            logError('Password setup link failed', e);
            return null;
          })
        : null;
      if (setupLink) emailed = await sendWelcomeEmail(email, firstName, setupLink, auth.email);
    }

    await audit(req, auth, 'professional.create', { type: 'User', id: uid }, {
      after: { email, firstName, lastName, phoneNumber, specialty, passwordSet: !!password, emailed, reusedSignIn: !createdFirebaseUser },
    });

    return res.json({
      professional: { id: profile.id, userId: uid, name: `${firstName} ${lastName}`.trim(), email },
      setupLink,
      emailed,
    });
  } catch (error: any) {
    if (error?.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    if (error?.code === 'auth/invalid-password') {
      return res.status(400).json({ error: 'That password is too weak. Use at least 8 characters.' });
    }
    return send(res, errorResponse(error, 'Admin professionals POST error', "We couldn't create the professional's account. Please try again."));
  }
}));

// Welcome email with the set-password link (same SMTP setup as admin invites).
// Returns false instead of throwing when SMTP isn't configured or fails.
async function sendWelcomeEmail(to: string, firstName: string, link: string, createdBy: string | null) {
  if (!mailConfigured()) {
    console.warn('Professional welcome email not sent: SMTP_USER / SMTP_PASS missing');
    return false;
  }
  try {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const by = createdBy ? ` by ${createdBy}` : '';
    await sendMail('account', {
      to,
      subject: 'Your STAAD account is ready',
      text: [
        `Hi ${firstName},`,
        '',
        `A STAAD professional account has been created for you${by}.`,
        `Set your password to sign in: ${link}`,
        '',
        `Then sign in with ${to}. If you weren't expecting this, you can ignore this email.`,
      ].join('\n'),
      html: `
        <div style="font-family:system-ui,Arial,sans-serif;color:#1f2937;line-height:1.5">
          <h2 style="margin:0 0 8px">Welcome to STAAD</h2>
          <p>Hi ${esc(firstName)}, a STAAD professional account has been created for you${esc(by)}.</p>
          <p><a href="${esc(link)}" style="display:inline-block;background:#4a7c59;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">Set your password</a></p>
          <p style="color:#6b7280;font-size:13px">Then sign in with ${esc(to)}. If you weren't expecting this, you can ignore this email.</p>
        </div>
      `,
    });
    return true;
  } catch (e: any) {
    logError('Professional welcome email failed', e);
    return false;
  }
}

// ---- /api/admin/professionals/bulk ---------------------------------------------

const MAX_IDS = 200;

// POST /api/admin/professionals/bulk — change module access for many therapists.
// Body: { therapistIds: string[], action: 'grantModules' | 'revokeModules' | 'allowAllModules', moduleIds?: string[] }
// grant adds to each therapist's list (and keeps "all modules" therapists as they are);
// revoke removes from the list (an "all modules" therapist becomes "all but these").
router.post('/admin/professionals/bulk', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'people.write');
    if (!auth.ok) return send(res, auth.response);

    const body = req.body;
    const { action } = body ?? {};
    const therapistIds: string[] = Array.isArray(body?.therapistIds)
      ? Array.from(new Set(body.therapistIds.filter((x: unknown): x is string => typeof x === 'string')))
      : [];
    const moduleIds: string[] = Array.isArray(body?.moduleIds) ? Array.from(new Set(body.moduleIds)) : [];

    if (!['grantModules', 'revokeModules', 'allowAllModules'].includes(action)) {
      return res.status(400).json({ error: "We couldn't tell which bulk action to run. Refresh the page and try again." });
    }
    if (!therapistIds.length) return res.status(400).json({ error: 'Select at least one professional.' });
    if (therapistIds.length > MAX_IDS) {
      return res.status(400).json({ error: `You can update at most ${MAX_IDS} professionals at a time. Select fewer and try again.` });
    }
    if (action !== 'allowAllModules') {
      if (!moduleIds.length) return res.status(400).json({ error: 'Select at least one tool.' });
      const unknown = moduleIds.filter((m) => !ALL_MODULE_IDS.includes(m));
      if (unknown.length) return res.status(400).json({ error: `Some of the selected tools no longer exist (${unknown.join(', ')}). Refresh the page and try again.` });
    }

    const therapists = await appDb.profileTherapist.findMany({
      where: { id: { in: therapistIds } },
      select: { id: true, allModulesAllowed: true, moduleAccess: true },
    });
    const found = new Set(therapists.map((t) => t.id));
    const missing = therapistIds.filter((id) => !found.has(id));

    const changes = therapists.map((t) => {
      let after: { allModulesAllowed: boolean; moduleAccess: string[] };
      if (action === 'allowAllModules') {
        after = { allModulesAllowed: true, moduleAccess: t.moduleAccess };
      } else if (action === 'grantModules') {
        after = t.allModulesAllowed
          ? { allModulesAllowed: true, moduleAccess: t.moduleAccess }
          : { allModulesAllowed: false, moduleAccess: ALL_MODULE_IDS.filter((m) => t.moduleAccess.includes(m) || moduleIds.includes(m)) };
      } else {
        const base = t.allModulesAllowed ? ALL_MODULE_IDS : t.moduleAccess;
        after = { allModulesAllowed: false, moduleAccess: base.filter((m) => !moduleIds.includes(m)) };
      }
      const before = { allModulesAllowed: t.allModulesAllowed, moduleAccess: t.moduleAccess };
      const changed =
        before.allModulesAllowed !== after.allModulesAllowed ||
        before.moduleAccess.length !== after.moduleAccess.length ||
        before.moduleAccess.some((m) => !after.moduleAccess.includes(m));
      return { id: t.id, before, after, changed };
    });

    const toUpdate = changes.filter((c) => c.changed);
    await appDb.$transaction(
      toUpdate.map((c) => appDb.profileTherapist.update({ where: { id: c.id }, data: c.after, select: { id: true } }))
    );
    await Promise.all(
      toUpdate.map((c) =>
        audit(req, auth, 'therapist.access.bulk', { type: 'ProfileTherapist', id: c.id }, {
          before: c.before,
          after: { ...c.after, action, moduleIds },
        })
      )
    );

    return res.json({ updated: toUpdate.length, unchanged: changes.length - toUpdate.length, missing });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin professionals bulk error', "We couldn't update the selected professionals. Please try again."));
  }
}));
