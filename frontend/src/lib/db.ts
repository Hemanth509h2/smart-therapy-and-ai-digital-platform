import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Same Neon pooler idle-close filtering as the backend client (see
// backend/src/lib/db.ts). Don't log every query by default — set
// PRISMA_LOG_QUERIES=true when debugging.
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
      if (e?.message?.includes('Closed')) return;
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
