import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { audit } from '@/lib/audit';
import { daysAgo } from '@/lib/adminList';
import { ALL_MODULE_IDS, MODULE_CATEGORIES } from '@/lib/modules';

export const dynamic = 'force-dynamic';

// GET /api/admin/modules — the built-in module library (lib/modules.ts) by
// category, merged with admin overrides (ModuleSetting) and launch counts.
// Launches come from MODULE_LAUNCH usage events, whose `label` is the module id.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'content');
    if (!auth.ok) return auth.response;

    const [overrides, recent, allTime] = await Promise.all([
      prisma.moduleSetting.findMany(),
      prisma.usageEvent.groupBy({
        by: ['label'],
        where: { type: 'MODULE_LAUNCH', label: { not: null }, createdAt: { gte: daysAgo(30) } },
        _sum: { count: true },
      }),
      prisma.usageEvent.groupBy({ by: ['label'], where: { type: 'MODULE_LAUNCH', label: { not: null } }, _sum: { count: true } }),
    ]);
    const setting = new Map(overrides.map((o) => [o.moduleId, o]));
    const recentBy = new Map(recent.map((r) => [r.label!, r._sum.count ?? 0]));
    const allBy = new Map(allTime.map((r) => [r.label!, r._sum.count ?? 0]));

    const categories = MODULE_CATEGORIES.map((c) => ({
      id: c.id,
      name: c.name,
      desc: c.desc,
      emoji: c.emoji,
      modules: c.modules.map((m) => {
        const s = setting.get(m.id);
        return {
          id: m.id,
          name: m.name,
          emoji: m.emoji,
          desc: m.desc,
          enabled: s?.enabled ?? true,
          featured: s?.featured ?? false,
          updatedAt: s?.updatedAt ?? null,
          updatedBy: s?.updatedBy ?? null,
          launches30d: recentBy.get(m.id) ?? 0,
          launchesAllTime: allBy.get(m.id) ?? 0,
        };
      }),
    }));

    return NextResponse.json({ categories });
  } catch (error: any) {
    console.error('Admin modules GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/admin/modules — body { moduleId, enabled?, featured? }.
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin(request, 'content');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const moduleId = String(body.moduleId || '');
    if (!ALL_MODULE_IDS.includes(moduleId)) {
      return NextResponse.json({ error: 'Unknown module.' }, { status: 400 });
    }
    const change: { enabled?: boolean; featured?: boolean } = {};
    if (typeof body.enabled === 'boolean') change.enabled = body.enabled;
    if (typeof body.featured === 'boolean') change.featured = body.featured;
    if (!Object.keys(change).length) {
      return NextResponse.json({ error: 'Nothing to change: send enabled and/or featured.' }, { status: 400 });
    }

    const existing = await prisma.moduleSetting.findUnique({ where: { moduleId } });
    const before = { enabled: existing?.enabled ?? true, featured: existing?.featured ?? false };
    const updatedBy = auth.email || auth.uid;
    const saved = await prisma.moduleSetting.upsert({
      where: { moduleId },
      create: { moduleId, ...change, updatedBy },
      update: { ...change, updatedBy },
    });

    await audit(request, auth, 'module.update', { type: 'Module', id: moduleId }, {
      before,
      after: { enabled: saved.enabled, featured: saved.featured },
    });

    return NextResponse.json({ module: saved });
  } catch (error: any) {
    console.error('Admin modules PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
