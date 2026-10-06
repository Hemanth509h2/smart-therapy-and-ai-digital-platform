import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminAuth } from '@/lib/firebaseAdmin';

// GET /api/admin/admins — list all admin accounts.
export async function GET() {
  try {
    const admins = await prisma.profileAdmin.findMany({
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({
      admins: admins.map((a) => ({
        id: a.id,
        userId: a.userId,
        name: `${a.firstName} ${a.lastName}`.trim(),
        email: a.user?.email ?? '',
        createdAt: a.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('Admins GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/admin/admins — create (or promote) an admin account.
// Body: { email, password?, firstName?, lastName? }
// If the email already has a Firebase user, it is reused (and promoted); a new
// password, when provided, is applied. Otherwise a new Firebase user is created.
export async function POST(request: Request) {
  try {
    const { email, password, firstName, lastName } = await request.json();
    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    const auth = adminAuth();

    let uid: string;
    try {
      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;
      if (password) {
        await auth.updateUser(uid, { password });
      }
    } catch {
      if (!password || String(password).length < 6) {
        return NextResponse.json(
          { error: 'A password of at least 6 characters is required for a new admin.' },
          { status: 400 }
        );
      }
      const created = await auth.createUser({ email, password });
      uid = created.uid;
    }

    // Upsert the DB user as ADMIN + ensure an admin profile exists.
    await prisma.user.upsert({
      where: { id: uid },
      update: { role: 'ADMIN', email },
      create: { id: uid, email, role: 'ADMIN' },
    });

    const profile = await prisma.profileAdmin.upsert({
      where: { userId: uid },
      update: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
      },
      create: {
        userId: uid,
        firstName: firstName || 'Admin',
        lastName: lastName || '',
      },
    });

    return NextResponse.json({ success: true, admin: { id: profile.id, userId: uid, email } });
  } catch (error: any) {
    console.error('Admins POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
