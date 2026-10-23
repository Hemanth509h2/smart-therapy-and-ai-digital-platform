// Lookups across the two databases (see lib/core/db.ts). Patient rows in the
// HIPAA database point at therapists by therapistId, and therapist/admin
// profiles in the app database point at users by userId, with no foreign key
// between them. These helpers fetch the other side in one query per batch.
import type { Prisma as AppPrisma, ProfileTherapist } from '.prisma/app-client';
import type { Prisma, User } from '@prisma/client';
import { appDb, prisma } from '@/lib/core/db';

type TherapistSelect = AppPrisma.ProfileTherapistSelect | undefined;
type TherapistOf<S extends TherapistSelect> = S extends AppPrisma.ProfileTherapistSelect
  ? AppPrisma.ProfileTherapistGetPayload<{ select: S }>
  : ProfileTherapist;
type UserSelect = Prisma.UserSelect | undefined;
type UserOf<S extends UserSelect> = S extends Prisma.UserSelect ? Prisma.UserGetPayload<{ select: S }> : User;

const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => !!id))];

/** Therapist profiles by id, keyed by id. Pass `select` to limit the columns. */
export async function therapistsById<S extends TherapistSelect = undefined>(
  ids: (string | null | undefined)[],
  select?: S
): Promise<Map<string, TherapistOf<S>>> {
  const wanted = unique(ids);
  if (!wanted.length) return new Map();
  const args: AppPrisma.ProfileTherapistFindManyArgs = { where: { id: { in: wanted } } };
  if (select) args.select = { ...select, id: true };
  const rows = await appDb.profileTherapist.findMany(args);
  return new Map(rows.map((r) => [r.id, r as unknown as TherapistOf<S>]));
}

/** Adds `therapist` (or null) to each row, looked up by its therapistId. */
export async function withTherapists<R extends { therapistId: string | null }, S extends TherapistSelect = undefined>(
  rows: R[],
  select?: S
): Promise<(R & { therapist: TherapistOf<S> | null })[]> {
  const map = await therapistsById(rows.map((r) => r.therapistId), select);
  return rows.map((r) => ({ ...r, therapist: (r.therapistId && map.get(r.therapistId)) || null }));
}

/** Users by id (Firebase uid), keyed by id. Pass `select` to limit the columns. */
export async function usersById<S extends UserSelect = undefined>(
  ids: (string | null | undefined)[],
  select?: S
): Promise<Map<string, UserOf<S>>> {
  const wanted = unique(ids);
  if (!wanted.length) return new Map();
  const args: Prisma.UserFindManyArgs = { where: { id: { in: wanted } } };
  if (select) args.select = { ...select, id: true };
  const rows = await prisma.user.findMany(args);
  return new Map(rows.map((r) => [r.id, r as unknown as UserOf<S>]));
}

/** Adds `user` (or null) to each row, looked up by its userId. */
export async function withUsers<R extends { userId: string }, S extends UserSelect = undefined>(
  rows: R[],
  select?: S
): Promise<(R & { user: UserOf<S> | null })[]> {
  const map = await usersById(rows.map((r) => r.userId), select);
  return rows.map((r) => ({ ...r, user: map.get(r.userId) ?? null }));
}

/** The therapist profile for a Firebase uid, or null. */
export async function therapistForUser<S extends TherapistSelect = undefined>(
  userId: string,
  select?: S
): Promise<TherapistOf<S> | null> {
  const row = await appDb.profileTherapist.findUnique({ where: { userId }, ...(select ? { select } : {}) });
  return row as unknown as TherapistOf<S> | null;
}

/** The therapist profile id for a Firebase uid, or null. */
export async function therapistIdForUser(userId: string) {
  const t = await appDb.profileTherapist.findUnique({ where: { userId }, select: { id: true } });
  return t?.id ?? null;
}
