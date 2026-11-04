import { Router } from 'express';
import { prisma, appDb } from '@/lib/core/db';
import { adminAuth } from '@/lib/core/firebaseAdmin';
import { requireAuth, requireRecentLogin } from '@/lib/http/apiAuth';
import { errorResponse, logError, PublicError } from '@/lib/http/apiError';
import { deleteAccount } from '@/lib/core/deleteAccount';
import { handle, send } from '@/lib/http/reply';
import { optDate, optStr, strList } from '@/lib/http/validate';
import { rejectIfLimited } from '@/lib/http/rateLimit';
import { CONSENT_MARKETING, CONSENT_TERMS, LEGAL_VERSION } from '@/lib/core/legal';
import { recordConsent, setMarketingOptIn } from '@/lib/core/consent';
import { exportAccount } from '@/lib/core/exportAccount';
import { alertAdmins, deliver, notify } from '@/lib/email/notify';
import { accountDeletedEmail, dataExportEmail, termsAcceptedEmail, unsubscribedEmail, welcomeEmail } from '@/lib/email/templates';
import { accountDeletedAlert, newTherapistAlert } from '@/lib/email/alerts';

export const router = Router();

// ---- /api/users/profile --------------------------------------------------------

// Types and length limits for the profile fields both routes accept; throws a
// 400 (PublicError) naming the first bad field. Absent fields are fine.
function checkProfileFields(body: Record<string, unknown>) {
  optStr(body.firstName, 'First name', 80);
  optStr(body.lastName, 'Last name', 80);
  optStr(body.qualification, 'Qualification', 200);
  optStr(body.experience, 'Experience', 200);
  optStr(body.bio, 'Bio', 2_000);
  optStr(body.gender, 'Gender', 30);
  if (body.phoneNumber !== undefined && body.phoneNumber !== null) {
    if (String(body.phoneNumber).length > 30) throw new PublicError('The phone number is too long.');
  }
  strList(body.specialty, 'Specialties', 20, 60);
  strList(body.diagnosis, 'Conditions', 30, 100);
  optDate(body.dateOfBirth, 'Date of birth');
}

router.post('/users/profile', handle(async (req, res) => {
  try {
    // Identity comes from the verified Firebase ID token — the client cannot
    // choose the uid/email of the account being created.
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);
    const uid = auth.uid;
    const email = auth.email;

    const { role, firstName, lastName, specialty, phoneNumber, dateOfBirth, diagnosis, inviteToken, acceptedTerms, termsVersion, marketingOptIn } = req.body;
    checkProfileFields(req.body);

    if (!email || !role) {
      return res.status(400).json({ error: "We couldn't read your account email or role. Sign out, sign in again and retry." });
    }

    const existing = await prisma.user.findUnique({ where: { id: uid }, select: { id: true } });
    if (existing) {
      return res.status(409).json({ error: 'This account already has a profile. Refresh the page to go to your dashboard.' });
    }

    const roleEnum = role === 'THERAPIST' ? 'THERAPIST' : 'CLIENT';

    // A therapist account needs the current Privacy Policy + Terms accepted
    // (the onboarding checkbox); the acceptance is recorded below.
    if (roleEnum === 'THERAPIST' && (acceptedTerms !== true || termsVersion !== LEGAL_VERSION)) {
      return res.status(400).json({
        error: 'Please read and accept the Privacy Policy and Terms & Conditions to create your account. If you already ticked the box, refresh the page: the documents were updated.',
        code: 'TERMS_REQUIRED',
      });
    }
    const wantsMarketing = marketingOptIn === true;

    // Stored as digits with country code (default 91).
    let therapistPhone: string | null = null;
    if (roleEnum === 'THERAPIST') {
      const digits = String(phoneNumber ?? '').replace(/\D/g, '');
      if (digits.length < 10) {
        return res.status(400).json({ error: 'Enter a valid phone number with at least 10 digits.' });
      }
      therapistPhone = digits.length === 10 ? `91${digits}` : digits;
      const taken = await appDb.profileTherapist.findUnique({ where: { phoneNumber: therapistPhone }, select: { id: true } });
      if (taken) {
        return res.status(409).json({ error: 'This phone number is already used by another account. Use a different number.' });
      }
    }

    // Create user and profile transactionally; claim invite if present.
    // The therapist profile lives in the app database, so that path is not
    // atomic: the User is removed again if the profile can't be created.
    const result = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          id: uid,
          email,
          role: roleEnum,
        },
      });

      if (roleEnum === 'THERAPIST') {
        return { user: u, profile: null, session: null };
      }

      const invite = inviteToken
        ? await tx.invite.findUnique({ where: { token: inviteToken } })
        : null;

      const profile = await tx.profileClient.create({
        data: {
          userId: uid,
          firstName: firstName || 'Client',
          lastName: lastName || '',
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : new Date(),
          diagnosis: diagnosis || [],
          phoneNumber: invite?.status === 'PENDING' ? invite.phoneNumber : null,
        },
      });

      // If this signup came from a therapist invite, claim it: create the assigned
      // session and mark the invite CLAIMED.
      let session = null;
      if (inviteToken) {
        if (invite && invite.status === 'PENDING') {
          session = await tx.session.create({
            data: {
              therapistId: invite.therapistId,
              clientId: profile.id,
              scheduledAt: invite.scheduledAt,
              status: 'SCHEDULED',
            },
          });
          await tx.invite.update({
            where: { id: invite.id },
            data: { status: 'CLAIMED', claimedClientId: profile.id },
          });
        }
      }

      return { user: u, profile, session };
    });

    const profile =
      roleEnum === 'THERAPIST'
        ? await appDb.profileTherapist
            .create({
              data: {
                userId: uid,
                firstName: firstName || 'Therapist',
                lastName: lastName || '',
                specialty: specialty || [],
                phoneNumber: therapistPhone,
                termsAcceptedAt: new Date(),
                termsVersion: LEGAL_VERSION,
                marketingOptIn: wantsMarketing,
                marketingOptInAt: wantsMarketing ? new Date() : null,
              },
            })
            .catch(async (e) => {
              await prisma.user.delete({ where: { id: uid } }).catch(() => {});
              throw e;
            })
        : result.profile;

    // Evidence of what was agreed and when. Non-fatal: the profile above
    // already holds the accepted version and timestamp.
    if (roleEnum === 'THERAPIST') {
      try {
        await recordConsent(req, uid, CONSENT_TERMS, true, LEGAL_VERSION);
        if (wantsMarketing) await recordConsent(req, uid, CONSENT_MARKETING, true);
      } catch (e) {
        logError(`Failed to record consent for ${uid}`, e);
      }
    }

    // Mirror the role onto the Firebase ID token as a custom claim. Firestore
    // rules cannot read Postgres, so this is the only way `patients/{uid}` can
    // distinguish a therapist from any other signed-in account.
    //
    // Deliberately AFTER the transaction and non-fatal: a claim failure must
    // not roll back a created account. The backfill script
    // (scripts/backfill-role-claims.mjs) repairs anyone who slips through.
    //
    // The claim only appears once the client refreshes its ID token — new
    // signups get it on their next token refresh, within the hour.
    try {
      await adminAuth().setCustomUserClaims(uid, { role: roleEnum });
    } catch (e) {
      logError(`Failed to set role claim for ${uid}`, e);
    }

    if (roleEnum === 'THERAPIST') {
      const t = profile as { firstName: string; lastName: string };
      const name = `${t.firstName} ${t.lastName}`.trim();
      await deliver([
        notify('account', email, welcomeEmail({ firstName: t.firstName })),
        alertAdmins('support', newTherapistAlert({ name, email, at: new Date() })),
      ]);
    }

    return res.json({ success: true, user: result.user, profile, session: result.session });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Error creating user profile in PostgreSQL'));
  }
}));

router.put('/users/profile', handle(async (req, res) => {
  try {
    // Only the signed-in user may update their own profile; the uid and role
    // are taken from the verified token + database, never from the body.
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);
    const uid = auth.uid;

    const { firstName, lastName, qualification, experience, specialty, bio, phoneNumber, dateOfBirth, gender, diagnosis } = req.body;
    checkProfileFields(req.body);

    const user = await prisma.user.findUnique({ where: { id: uid }, select: { role: true } });
    if (!user) {
      return res.status(404).json({ error: "We couldn't find your account. Sign out and sign in again." });
    }

    if (user.role === 'THERAPIST') {
      // Stored as digits with country code (default 91), same as registration.
      let therapistPhone: string | undefined;
      if (phoneNumber !== undefined) {
        const digits = String(phoneNumber).replace(/\D/g, '');
        if (digits.length < 10) {
          return res.status(400).json({ error: 'Enter a valid phone number with at least 10 digits.' });
        }
        therapistPhone = digits.length === 10 ? `91${digits}` : digits;
        const taken = await appDb.profileTherapist.findFirst({
          where: { phoneNumber: therapistPhone, NOT: { userId: uid } },
          select: { id: true },
        });
        if (taken) {
          return res.status(409).json({ error: 'This phone number is already used by another account. Use a different number.' });
        }
      }

      const updated = await appDb.profileTherapist.update({
        where: { userId: uid },
        data: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
          ...(qualification !== undefined && { qualification }),
          ...(experience !== undefined && { experience }),
          ...(specialty !== undefined && { specialty }),
          ...(bio !== undefined && { bio }),
          ...(therapistPhone !== undefined && { phoneNumber: therapistPhone }),
        },
      });
      return res.json({ profile: updated });
    }

    if (user.role === 'CLIENT') {
      const updateData: any = {};
      if (dateOfBirth !== undefined) updateData.dateOfBirth = new Date(dateOfBirth);
      if (gender !== undefined) updateData.gender = gender;
      // firstName/lastName only updatable if NOT from invite (handled on frontend)
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;

      const updated = await prisma.profileClient.update({
        where: { userId: uid },
        data: updateData,
      });
      return res.json({ profile: updated });
    }

    if (user.role === 'ADMIN') {
      // Name only; the admin role is changed from Admin > Admins. Admins
      // created before roles existed have no ProfileAdmin row yet, hence the
      // upsert (the column defaults to SUPER_ADMIN, which is what they had).
      const name = {
        ...(firstName !== undefined && { firstName: String(firstName).trim() }),
        ...(lastName !== undefined && { lastName: String(lastName).trim() }),
      };
      if (name.firstName === '') {
        return res.status(400).json({ error: 'Enter your first name.' });
      }
      const updated = await appDb.profileAdmin.upsert({
        where: { userId: uid },
        create: { userId: uid, ...name },
        update: name,
      });
      return res.json({ profile: updated });
    }

    return res.status(400).json({ error: "Your account type can't be edited here." });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Profile PUT error'));
  }
}));

// DELETE /api/users/profile — permanently remove a user and all their data
// in both databases (see lib/core/deleteAccount.ts). For a therapist that
// includes the clients they added.
router.delete('/users/profile', handle(async (req, res) => {
  try {
    // Only the signed-in user may delete their own account. The uid comes
    // from the verified token; the req body is ignored.
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);
    const uid = auth.uid;

    // The browser deletes the Firebase sign-in account after this succeeds,
    // and Firebase only allows that within ~5 minutes of signing in. Ask for
    // a fresh sign-in first, so the data is never removed while the sign-in
    // account survives.
    const stepUp = requireRecentLogin(auth, 4);
    if (stepUp) return send(res, stepUp);

    // Captured before deletion: afterwards there is nothing left to look up.
    const [account, therapist] = await Promise.all([
      prisma.user.findUnique({ where: { id: uid }, select: { email: true, role: true } }),
      appDb.profileTherapist.findUnique({ where: { userId: uid }, select: { firstName: true, lastName: true } }),
    ]);

    const removed = await deleteAccount(uid);
    if (!removed) {
      return res.status(404).json({ error: "We couldn't find your account. Sign out and sign in again." });
    }

    if (account?.role === 'THERAPIST') {
      const now = new Date();
      const name = therapist ? `${therapist.firstName} ${therapist.lastName}`.trim() : account.email;
      await deliver([
        notify('account', account.email, accountDeletedEmail({ firstName: therapist?.firstName, at: now })),
        alertAdmins('support', accountDeletedAlert({ name, email: account.email, at: now })),
      ]);
    }

    return res.json({ success: true });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Profile DELETE error'));
  }
}));

router.get('/users/profile', handle(async (req, res) => {
  // Returns the caller's own profile. The uid comes from the verified
  // Firebase ID token — the old `?uid=` query param let anyone read any
  // user's profile and is no longer honored.
  const auth = await requireAuth(req);
  if (!auth.ok) return send(res, auth.response);
  const uid = auth.uid;

  try {
    // Every page load waits on this req, so look up both databases at once.
    const [found, therapist, admin] = await Promise.all([
      prisma.user.findUnique({
        where: { id: uid },
        include: {
          client: true,
        },
      }),
      appDb.profileTherapist.findUnique({ where: { userId: uid } }),
      appDb.profileAdmin.findUnique({ where: { userId: uid } }),
    ]);

    if (!found) {
      return res.status(404).json({ error: "We couldn't find your account. Sign out and sign in again." });
    }

    const user = { ...found, therapist, admin };
    return res.json({ user });
  } catch (error: any) {
    return send(res, errorResponse(error, 'users/profile GET'));
  }
}));

// ---- /api/users/consent --------------------------------------------------------

// POST /api/users/consent
//   { kind: 'TERMS_PRIVACY', version }  accept the current Privacy Policy + Terms
//   { kind: 'MARKETING', granted }      opt in to / out of marketing emails
// Therapists only; every change is also kept as a ConsentRecord.
router.post('/users/consent', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);
    if (await rejectIfLimited(res, { name: 'users-consent', limit: 30, windowMs: 60 * 60 * 1000 }, auth.uid)) return;
    const uid = auth.uid;
    const { kind, version, granted } = req.body;

    const therapist = await appDb.profileTherapist.findUnique({
      where: { userId: uid },
      select: { id: true, firstName: true, marketingOptIn: true },
    });
    if (!therapist) {
      return res.status(404).json({ error: 'Only therapist accounts have these settings.' });
    }

    if (kind === CONSENT_TERMS) {
      if (version !== LEGAL_VERSION) {
        return res.status(400).json({ error: 'The Privacy Policy or Terms were updated again. Refresh the page and review the latest version.', code: 'TERMS_REQUIRED' });
      }
      const profile = await appDb.profileTherapist.update({
        where: { userId: uid },
        data: { termsAcceptedAt: new Date(), termsVersion: LEGAL_VERSION },
      });
      await recordConsent(req, uid, CONSENT_TERMS, true, LEGAL_VERSION);
      await deliver(notify('account', auth.email, termsAcceptedEmail({ firstName: therapist.firstName, version: LEGAL_VERSION, at: new Date() })));
      return res.json({ profile });
    }

    if (kind === CONSENT_MARKETING) {
      if (typeof granted !== 'boolean') {
        return res.status(400).json({ error: 'Choose whether you want marketing emails.' });
      }
      await setMarketingOptIn(req, uid, granted);
      // One confirmation when product updates are actually turned off.
      if (!granted && therapist.marketingOptIn) {
        await deliver(notify('account', auth.email, unsubscribedEmail({ firstName: therapist.firstName })));
      }
      const profile = await appDb.profileTherapist.findUnique({ where: { userId: uid } });
      return res.json({ profile });
    }

    return res.status(400).json({ error: 'Unknown consent type.' });
  } catch (error: any) {
    return send(res, errorResponse(error, 'users/consent POST'));
  }
}));

// ---- /api/users/export ---------------------------------------------------------

// GET /api/users/export — everything STAAD holds about the signed-in user, as
// a JSON file (right of access / data portability). See lib/core/exportAccount.ts.
router.get('/users/export', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);
    // A full export is heavy: a few per hour is plenty.
    if (await rejectIfLimited(res, { name: 'users-export', limit: 5, windowMs: 60 * 60 * 1000 }, auth.uid,
      'You have downloaded your data several times in the last hour. Please try again later.')) return;

    const data = await exportAccount(auth.uid);
    if (!data) {
      return res.status(404).json({ error: "We couldn't find your account. Sign out and sign in again." });
    }

    const therapist = await appDb.profileTherapist.findUnique({ where: { userId: auth.uid }, select: { firstName: true } });
    await deliver(notify('account', auth.email, dataExportEmail({ firstName: therapist?.firstName, at: new Date() })));

    const day = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="staad-my-data-${day}.json"`);
    res.set('Cache-Control', 'no-store');
    return res.json(data);
  } catch (error: any) {
    return send(res, errorResponse(error, 'users/export GET', "We couldn't prepare your data export. Please try again."));
  }
}));
