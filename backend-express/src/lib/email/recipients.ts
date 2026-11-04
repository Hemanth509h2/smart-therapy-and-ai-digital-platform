import type { ProfileClient } from '@prisma/client';
import { prisma, appDb } from '@/lib/core/db';
import { isEmailAddress } from './notify';

/** Who an email about a therapist goes to, and how to greet them. */
export interface TherapistContact {
  email: string | null;
  firstName: string;
  fullName: string;
}

/** Therapist profile id → their account email and name (null if gone). */
export async function therapistContact(therapistId: string | null | undefined): Promise<TherapistContact | null> {
  if (!therapistId) return null;
  const t = await appDb.profileTherapist.findUnique({
    where: { id: therapistId },
    select: { userId: true, firstName: true, lastName: true },
  });
  if (!t) return null;
  const user = await prisma.user.findUnique({ where: { id: t.userId }, select: { email: true } });
  return {
    email: user?.email ?? null,
    firstName: t.firstName,
    fullName: `${t.firstName} ${t.lastName}`.trim() || 'A therapist',
  };
}

/** Firebase uid → account email (null if gone). */
export async function emailForUser(uid: string | null | undefined): Promise<string | null> {
  if (!uid) return null;
  const user = await prisma.user.findUnique({ where: { id: uid }, select: { email: true } });
  return user?.email ?? null;
}

// Placeholder accounts made for clients and guests have addresses like
// client-<uuid>@client.staad.local: never real inboxes.
const isPlaceholder = (email: string) => /\.local$/i.test(email.trim());

/**
 * Where session emails for a client go: the parent / guardian email the
 * therapist entered, plus the client's own login email when they have a real
 * account. De-duplicated; placeholders and invalid addresses dropped.
 */
export async function clientEmails(client: Pick<ProfileClient, 'parentEmail' | 'userId'>): Promise<string[]> {
  const out = new Set<string>();
  if (isEmailAddress(client.parentEmail) && !isPlaceholder(client.parentEmail)) out.add(client.parentEmail.trim().toLowerCase());
  const own = await emailForUser(client.userId).catch(() => null);
  if (isEmailAddress(own) && !isPlaceholder(own)) out.add(own.trim().toLowerCase());
  return Array.from(out);
}
