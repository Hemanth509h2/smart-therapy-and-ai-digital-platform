// Append-only admin audit trail (AuditLog). Call after every admin mutation
// and every PHI reveal. Never throws: a failed audit write is logged, not
// surfaced, so it can't break the action it describes.
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/db';

export async function audit(
  request: Request,
  actor: { uid: string; email?: string | null },
  action: string,
  target: { type: string; id?: string | null },
  change: { before?: unknown; after?: unknown } = {}
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUid: actor.uid,
        actorEmail: actor.email ?? null,
        action,
        targetType: target.type,
        targetId: target.id ?? null,
        before: toJson(change.before),
        after: toJson(change.after),
        ip:
          request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
          request.headers.get('x-real-ip') ||
          null,
      },
    });
  } catch (err: any) {
    console.error(`[audit] failed to record ${action} on ${target.type}:${target.id}:`, err?.message);
  }
}

// Dates, Decimals and undefined -> plain JSON; null stays SQL NULL.
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value));
}
