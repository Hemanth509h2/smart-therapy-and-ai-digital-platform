// Seeds the bootstrap admin account.
// Run: node --env-file=.env scripts/seed-admin.cjs
// Creates (or reuses) a Firebase Auth user and marks it ADMIN in the database.
const admin = require('firebase-admin');
const { PrismaClient } = require('@prisma/client');

const EMAIL = process.env.SEED_ADMIN_EMAIL || 'om.cofounder@staad.in';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || '123456';

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  const auth = admin.auth();

  let uid;
  try {
    const u = await auth.getUserByEmail(EMAIL);
    uid = u.uid;
    await auth.updateUser(uid, { password: PASSWORD });
    console.log(`Reused existing Firebase user ${EMAIL} (${uid}); password reset.`);
  } catch {
    const u = await auth.createUser({ email: EMAIL, password: PASSWORD });
    uid = u.uid;
    console.log(`Created Firebase user ${EMAIL} (${uid}).`);
  }

  const prisma = new PrismaClient();
  await prisma.user.upsert({
    where: { id: uid },
    update: { role: 'ADMIN', email: EMAIL },
    create: { id: uid, email: EMAIL, role: 'ADMIN' },
  });
  await prisma.profileAdmin.upsert({
    where: { userId: uid },
    update: {},
    create: { userId: uid, firstName: 'STAAD', lastName: 'Admin' },
  });
  await prisma.$disconnect();
  console.log(`✓ Admin ready: ${EMAIL} / ${PASSWORD}`);
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
