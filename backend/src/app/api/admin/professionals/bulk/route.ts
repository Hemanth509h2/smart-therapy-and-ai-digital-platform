import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';

export const dynamic = 'force-dynamic';

const MAX_IDS = 200;

// POST /api/admin/professionals/bulk — change module access for many therapists.
// Body: { therapistIds: string[], action: 'grantModules' | 'revokeModules' | 'allowAllModules', moduleIds?: string[] }
// grant adds to each therapist's list (and keeps "all modules" therapists as they are);
// revoke removes from the list (an "all modules" therapist becomes "all but these").
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request, 'people.write');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const { action } = body ?? {};
    const therapistIds: string[] = Array.isArray(body?.therapistIds)
      ? Array.from(new Set(body.therapistIds.filter((x: unknown): x is string => typeof x === 'string')))
      : [];
    const moduleIds: string[] = Array.isArray(body?.moduleIds) ? Array.from(new Set(body.moduleIds)) : [];

    if (!['grantModules', 'revokeModules', 'allowAllModules'].includes(action)) {
      return NextResponse.json({ error: "action must be 'grantModules', 'revokeModules' or 'allowAllModules'" }, { status: 400 });
    }
    if (!therapistIds.length) return NextResponse.json({ error: 'therapistIds is required' }, { status: 400 });
    if (therapistIds.length > MAX_IDS) {
      return NextResponse.json({ error: `At most ${MAX_IDS} professionals per bulk action` }, { status: 400 });
    }
    if (action !== 'allowAllModules') {
      if (!moduleIds.length) return NextResponse.json({ error: 'moduleIds is required' }, { status: 400 });
      const unknown = moduleIds.filter((m) => !ALL_MODULE_IDS.includes(m));
      if (unknown.length) return NextResponse.json({ error: `Unknown module ids: ${unknown.join(', ')}` }, { status: 400 });
    }

    const therapists = await prisma.profileTherapist.findMany({
      where: { id: { in: therapistIds } },
      select: { id: true, allModulesAllowed: true, moduleAccess: true },
    });
    const found = new Set(therapists.map((t) => t.id));
    const missing = therapistIds.filter((id) => !found.has(id));

    const changes = therapists.map((t) => {
      let after: { allModulesAllowed: boolean; moduleAccess: string[] };
      if (action === 'allowAllModules') {
        after = { allModulesAllowed: true, moduleAccess: t.moduleAccess };
      } else if (action === 'grantModules') {
        after = t.allModulesAllowed
          ? { allModulesAllowed: true, moduleAccess: t.moduleAccess }
          : { allModulesAllowed: false, moduleAccess: ALL_MODULE_IDS.filter((m) => t.moduleAccess.includes(m) || moduleIds.includes(m)) };
      } else {
        const base = t.allModulesAllowed ? ALL_MODULE_IDS : t.moduleAccess;
        after = { allModulesAllowed: false, moduleAccess: base.filter((m) => !moduleIds.includes(m)) };
      }
      const before = { allModulesAllowed: t.allModulesAllowed, moduleAccess: t.moduleAccess };
      const changed =
        before.allModulesAllowed !== after.allModulesAllowed ||
        before.moduleAccess.length !== after.moduleAccess.length ||
        before.moduleAccess.some((m) => !after.moduleAccess.includes(m));
      return { id: t.id, before, after, changed };
    });

    const toUpdate = changes.filter((c) => c.changed);
    await prisma.$transaction(
      toUpdate.map((c) => prisma.profileTherapist.update({ where: { id: c.id }, data: c.after, select: { id: true } }))
    );
    await Promise.all(
      toUpdate.map((c) =>
        audit(request, auth, 'therapist.access.bulk', { type: 'ProfileTherapist', id: c.id }, {
          before: c.before,
          after: { ...c.after, action, moduleIds },
        })
      )
    );

    return NextResponse.json({ updated: toUpdate.length, unchanged: changes.length - toUpdate.length, missing });
  } catch (error: any) {
    console.error('Admin professionals bulk error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
