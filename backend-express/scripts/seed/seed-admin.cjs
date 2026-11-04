// Seeds the bootstrap admin account.
// Run: SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='<long password>' \
//        node --env-file=.env scripts/seed/seed-admin.cjs
// Creates (or reuses) a Firebase Auth user and marks it ADMIN in the database.
//
// There is no default password: SEED_ADMIN_PASSWORD must be set and at least
// 12 characters. An existing account's password is only changed when
// SEED_ADMIN_RESET_PASSWORD=true, and the password is never printed.
// Modular API: firebase-admin 14 no longer has the `admin.credential` / `admin.auth()` namespace.
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
// User lives in the HIPAA database (default client); ProfileAdmin lives in the
// app database (generated to node_modules/.prisma/app-client).
const { PrismaClient } = require('@prisma/client');
const { PrismaClient: AppPrismaClient } = require('.prisma/app-client');

const EMAIL = process.env.SEED_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const RESET = process.env.SEED_ADMIN_RESET_PASSWORD === 'true';

async function main() {
  if (!EMAIL) throw new Error('Set SEED_ADMIN_EMAIL to the admin’s email address.');
  if (!PASSWORD || PASSWORD.length < 12) {
    throw new Error('Set SEED_ADMIN_PASSWORD to a password of at least 12 characters.');
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  const auth = getAuth();

  let uid;
  try {
    const u = await auth.getUserByEmail(EMAIL);
    uid = u.uid;
    if (RESET) {
      await auth.updateUser(uid, { password: PASSWORD });
      console.log(`Reused existing Firebase user ${EMAIL} (${uid}); password changed.`);
    } else {
      console.log(`Reused existing Firebase user ${EMAIL} (${uid}); password left unchanged.`);
    }
  } catch (e) {
    if (e?.code !== 'auth/user-not-found') throw e;
    const u = await auth.createUser({ email: EMAIL, password: PASSWORD });
    uid = u.uid;
    console.log(`Created Firebase user ${EMAIL} (${uid}).`);
  }
  const record = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...(record.customClaims ?? {}), role: 'ADMIN' });

  const prisma = new PrismaClient();
  const appDb = new AppPrismaClient();
  try {
    await prisma.user.upsert({
      where: { id: uid },
      update: { role: 'ADMIN', email: EMAIL },
      create: { id: uid, email: EMAIL, role: 'ADMIN' },
    });
    await appDb.profileAdmin.upsert({
      where: { userId: uid },
      update: {},
      create: { userId: uid, firstName: 'STAAD', lastName: 'Admin', adminRole: 'SUPER_ADMIN' },
    });
  } finally {
    await Promise.all([prisma.$disconnect(), appDb.$disconnect()]);
  }
  console.log(`✓ Admin ready: ${EMAIL}`);
}

main().catch((e) => {
  console.error('Seed failed:', e?.message || e);
  process.exit(1);
});
