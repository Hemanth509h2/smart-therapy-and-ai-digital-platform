import { NextResponse } from 'next/server';
import { appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { errorResponse } from '@/lib/http/apiError';

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
      return NextResponse.json({ error: "We couldn't tell which bulk action to run. Refresh the page and try again." }, { status: 400 });
    }
    if (!therapistIds.length) return NextResponse.json({ error: 'Select at least one professional.' }, { status: 400 });
    if (therapistIds.length > MAX_IDS) {
      return NextResponse.json({ error: `You can update at most ${MAX_IDS} professionals at a time. Select fewer and try again.` }, { status: 400 });
    }
    if (action !== 'allowAllModules') {
      if (!moduleIds.length) return NextResponse.json({ error: 'Select at least one tool.' }, { status: 400 });
      const unknown = moduleIds.filter((m) => !ALL_MODULE_IDS.includes(m));
      if (unknown.length) return NextResponse.json({ error: `Some of the selected tools no longer exist (${unknown.join(', ')}). Refresh the page and try again.` }, { status: 400 });
    }

    const therapists = await appDb.profileTherapist.findMany({
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
    await appDb.$transaction(
      toUpdate.map((c) => appDb.profileTherapist.update({ where: { id: c.id }, data: c.after, select: { id: true } }))
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
    return errorResponse(error, 'Admin professionals bulk error', "We couldn't update the selected professionals. Please try again.");
  }
}
