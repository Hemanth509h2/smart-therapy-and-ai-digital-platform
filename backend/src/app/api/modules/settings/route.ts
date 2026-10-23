import { NextResponse } from 'next/server';
import { appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';

export const dynamic = 'force-dynamic';

// GET /api/modules/settings — admin module overrides for the therapist app:
// which modules are switched off globally and which are featured.
export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const rows = await appDb.moduleSetting.findMany({
      where: { OR: [{ enabled: false }, { featured: true }] },
      select: { moduleId: true, enabled: true, featured: true },
    });
    return NextResponse.json({
      disabled: rows.filter((r) => !r.enabled).map((r) => r.moduleId),
      featured: rows.filter((r) => r.enabled && r.featured).map((r) => r.moduleId),
    });
  } catch (error: any) {
    console.error('Module settings GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
