// Seeds the starter subscription plans.
// Run: node --env-file=.env scripts/seed-plans.cjs
// Idempotent — upserts by unique plan name. Payments are out of scope, so
// priceMonthly is display-only (INR). toolQuota null = unlimited (all tools).
const { PrismaClient } = require('@prisma/client');

const PLANS = [
  {
    name: 'Base',
    description: 'Access to any 5 therapy tools of your choice.',
    priceMonthly: 999,
    durationMonths: 1,
    toolQuota: 5,
    sortOrder: 1,
  },
  {
    name: 'Pro',
    description: 'Access to any 12 therapy tools of your choice.',
    priceMonthly: 2499,
    durationMonths: 1,
    toolQuota: 12,
    sortOrder: 2,
  },
  {
    name: 'Unlimited',
    description: 'Unlimited access to every therapy tool on the platform.',
    priceMonthly: 4999,
    durationMonths: 1,
    toolQuota: null,
    sortOrder: 3,
  },
];

async function main() {
  const prisma = new PrismaClient();
  for (const p of PLANS) {
    await prisma.plan.upsert({
      where: { name: p.name },
      update: {
        description: p.description,
        priceMonthly: p.priceMonthly,
        durationMonths: p.durationMonths,
        toolQuota: p.toolQuota,
        sortOrder: p.sortOrder,
        isActive: true,
      },
      create: p,
    });
    console.log(`✓ Plan ready: ${p.name}`);
  }
  await prisma.$disconnect();
  console.log('Done seeding plans.');
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
