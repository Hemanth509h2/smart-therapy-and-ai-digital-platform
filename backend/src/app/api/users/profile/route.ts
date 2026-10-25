import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { adminAuth } from '@/lib/core/firebaseAdmin';
import { requireAuth } from '@/lib/http/apiAuth';
import { errorResponse } from '@/lib/http/apiError';
import { therapistForUser } from '@/lib/core/links';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // Identity comes from the verified Firebase ID token — the client cannot
    // choose the uid/email of the account being created.
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const uid = auth.uid;
    const email = auth.email;

    const { role, firstName, lastName, specialty, phoneNumber, dateOfBirth, diagnosis, inviteToken } = await request.json();

    if (!email || !role) {
      return NextResponse.json({ error: "We couldn't read your account email or role. Sign out, sign in again and retry." }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { id: uid }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: 'This account already has a profile. Refresh the page to go to your dashboard.' }, { status: 409 });
    }

    const roleEnum = role === 'THERAPIST' ? 'THERAPIST' : 'CLIENT';

    // Stored as digits with country code (default 91).
    let therapistPhone: string | null = null;
    if (roleEnum === 'THERAPIST') {
      const digits = String(phoneNumber ?? '').replace(/\D/g, '');
      if (digits.length < 10) {
        return NextResponse.json({ error: 'Enter a valid phone number with at least 10 digits.' }, { status: 400 });
      }
      therapistPhone = digits.length === 10 ? `91${digits}` : digits;
      const taken = await appDb.profileTherapist.findUnique({ where: { phoneNumber: therapistPhone }, select: { id: true } });
      if (taken) {
        return NextResponse.json({ error: 'This phone number is already used by another account. Use a different number.' }, { status: 409 });
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
              },
            })
            .catch(async (e) => {
              await prisma.user.delete({ where: { id: uid } }).catch(() => {});
              throw e;
            })
        : result.profile;

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
      console.error('Failed to set role claim for', uid, e);
    }

    return NextResponse.json({ success: true, user: result.user, profile, session: result.session });
  } catch (error: any) {
    return errorResponse(error, 'Error creating user profile in PostgreSQL');
  }
}

export async function PUT(request: Request) {
  try {
    // Only the signed-in user may update their own profile; the uid and role
    // are taken from the verified token + database, never from the body.
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const uid = auth.uid;

    const { firstName, lastName, qualification, experience, specialty, bio, phoneNumber, dateOfBirth, gender, diagnosis } = await request.json();

    const user = await prisma.user.findUnique({ where: { id: uid }, select: { role: true } });
    if (!user) {
      return NextResponse.json({ error: "We couldn't find your account. Sign out and sign in again." }, { status: 404 });
    }

    if (user.role === 'THERAPIST') {
      // Stored as digits with country code (default 91), same as registration.
      let therapistPhone: string | undefined;
      if (phoneNumber !== undefined) {
        const digits = String(phoneNumber).replace(/\D/g, '');
        if (digits.length < 10) {
          return NextResponse.json({ error: 'Enter a valid phone number with at least 10 digits.' }, { status: 400 });
        }
        therapistPhone = digits.length === 10 ? `91${digits}` : digits;
        const taken = await appDb.profileTherapist.findFirst({
          where: { phoneNumber: therapistPhone, NOT: { userId: uid } },
          select: { id: true },
        });
        if (taken) {
          return NextResponse.json({ error: 'This phone number is already used by another account. Use a different number.' }, { status: 409 });
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
      return NextResponse.json({ profile: updated });
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
      return NextResponse.json({ profile: updated });
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
        return NextResponse.json({ error: 'Enter your first name.' }, { status: 400 });
      }
      const updated = await appDb.profileAdmin.upsert({
        where: { userId: uid },
        create: { userId: uid, ...name },
        update: name,
      });
      return NextResponse.json({ profile: updated });
    }

    return NextResponse.json({ error: "Your account type can't be edited here." }, { status: 400 });
  } catch (error: any) {
    return errorResponse(error, 'Profile PUT error');
  }
}

// DELETE /api/users/profile — permanently remove a user and all their data.
// Sessions/bookings/notes/invites are not cascade-deleted from the profile, so
// they are cleared explicitly inside a transaction before the user is removed
// (deleting the User cascades to the client profile). Therapist/admin profiles
// live in the app database and are deleted after, so this is not atomic.
export async function DELETE(request: Request) {
  try {
    // Only the signed-in user may delete their own account. The uid comes
    // from the verified token; the request body is ignored.
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const uid = auth.uid;

    const [user, therapist] = await Promise.all([
      prisma.user.findUnique({
        where: { id: uid },
        include: { client: true },
      }),
      therapistForUser(uid, { id: true }),
    ]);
    if (!user) {
      return NextResponse.json({ error: "We couldn't find your account. Sign out and sign in again." }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      if (therapist) {
        const tId = therapist.id;
        await tx.therapistNote.deleteMany({ where: { therapistId: tId } });
        await tx.session.deleteMany({ where: { therapistId: tId } });
        await tx.booking.deleteMany({ where: { therapistId: tId } });
        await tx.invite.deleteMany({ where: { therapistId: tId } });
        await tx.documentChunk.deleteMany({ where: { therapistId: tId } });
        // Used to cascade (or set null) from ProfileTherapist.
        await tx.whatsAppMessage.deleteMany({ where: { therapistId: tId } });
        await tx.progressNote.deleteMany({ where: { therapistId: tId } });
        await tx.progressReport.deleteMany({ where: { therapistId: tId } });
        await tx.progressMetric.deleteMany({ where: { therapistId: tId } });
        await tx.profileClient.updateMany({ where: { therapistId: tId }, data: { therapistId: null } });
      }
      if (user.client) {
        const cId = user.client.id;
        // Deleting the client's sessions cascades their notes.
        await tx.booking.deleteMany({ where: { clientId: cId } });
        await tx.session.deleteMany({ where: { clientId: cId } });
      }
      // Removes the User and cascades to the client profile.
      await tx.user.delete({ where: { id: uid } });
    });
    // Patient data is gone by now; the profiles cascade to their app-side rows.
    await appDb.profileTherapist.deleteMany({ where: { userId: uid } });
    await appDb.profileAdmin.deleteMany({ where: { userId: uid } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error, 'Profile DELETE error');
  }
}

export async function GET(request: Request) {
  // Returns the caller's own profile. The uid comes from the verified
  // Firebase ID token — the old `?uid=` query param let anyone read any
  // user's profile and is no longer honored.
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const uid = auth.uid;

  try {
    // Every page load waits on this request, so look up both databases at once.
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
      return NextResponse.json({ error: "We couldn't find your account. Sign out and sign in again." }, { status: 404 });
    }

    const user = { ...found, therapist, admin };
    return NextResponse.json({ user });
  } catch (error: any) {
    return errorResponse(error, 'users/profile GET');
  }
}
