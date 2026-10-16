import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Query logs flood the terminal on every request. Keep them off by default;
// set PRISMA_LOG_QUERIES=true in .env when debugging the database layer.
//
// Neon's pooler closes idle connections, so the pool periodically reports
// `Error { kind: Closed }`. Those are self-healing (the next query opens a
// fresh connection), so filter them out of the error stream instead of
// letting them look like real outages. Real errors still surface.
const VERBOSE = process.env.PRISMA_LOG_QUERIES === 'true';

export const prisma =
  globalForPrisma.prisma ||
  (() => {
    const client = new PrismaClient({
      log: [
        { emit: 'event', level: 'error' },
        ...(VERBOSE ? ([{ emit: 'event', level: 'query' }, 'warn'] as const) : []),
      ],
    });
    client.$on('error' as never, ((e: { message?: string }) => {
      if (e?.message?.includes('kind: Closed') || e?.message?.includes('Closed')) return;
      console.error('[prisma]', e?.message ?? e);
    }) as never);
    if (VERBOSE) {
      client.$on('query' as never, ((e: { query?: string; duration?: number }) => {
        console.log(`[prisma] ${e.duration}ms ${e.query}`);
      }) as never);
    }
    return client;
  })();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
