import { PrismaClient } from '@prisma/client';
import { PrismaClient as AppPrismaClient } from '.prisma/app-client';

// Two databases:
//   prisma - HIPAA database (DATABASE_URL_2): users, clients, sessions, notes,
//            reports, progress, invites, messages, support tickets, audit log.
//   appDb  - app database (DATABASE_URL): therapist and admin profiles, plans,
//            subscriptions, payments, coupons, usage, settings, module data.
// They can't join each other: rows link by plain ids (userId, therapistId), so
// fetch the other side with the other client. Never store patient data in appDb.
const globalForPrisma = global as unknown as { prisma: PrismaClient; appDb: AppPrismaClient };

// Query logs flood the terminal on every request. Keep them off by default;
// set PRISMA_LOG_QUERIES=true in .env when debugging the database layer.
//
// Neon's pooler closes idle connections, so the pool periodically reports
// `Error { kind: Closed }`. Those are self-healing (the next query opens a
// fresh connection), so filter them out of the error stream instead of
// letting them look like real outages. Real errors still surface.
const VERBOSE = process.env.PRISMA_LOG_QUERIES === 'true';

const LOG = [
  { emit: 'event', level: 'error' },
  ...(VERBOSE ? ([{ emit: 'event', level: 'query' }, 'warn'] as const) : []),
] as const;

function withLogging<T extends PrismaClient | AppPrismaClient>(client: T, tag: string): T {
  client.$on('error' as never, ((e: { message?: string }) => {
    if (e?.message?.includes('kind: Closed') || e?.message?.includes('Closed')) return;
    console.error(`[${tag}]`, e?.message ?? e);
  }) as never);
  if (VERBOSE) {
    client.$on('query' as never, ((e: { query?: string; duration?: number }) => {
      console.log(`[${tag}] ${e.duration}ms ${e.query}`);
    }) as never);
  }
  return client;
}

export const prisma = globalForPrisma.prisma || withLogging(new PrismaClient({ log: [...LOG] }), 'prisma');

export const appDb = globalForPrisma.appDb || withLogging(new AppPrismaClient({ log: [...LOG] }), 'appDb');

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.appDb = appDb;
}
