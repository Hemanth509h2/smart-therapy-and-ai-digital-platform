import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { dateRange, listParams } from '@/lib/admin/adminList';
import { errorResponse } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/audit ----------------------------------------------------------

// GET /api/admin/audit — the append-only admin audit trail. Read-only: there
// is deliberately no PATCH/DELETE for this table.
// Filters: ?q=<actor email> &action=<prefix, e.g. "plan." or "phi.reveal">
//          &targetType=Plan &targetId=<id> &from=&to= &page=&pageSize=
router.get('/admin/audit', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'audit.read');
    if (!auth.ok) return send(res, auth.response);

    const { sp, skip, take, q, from, to, dir } = listParams(req, { sortable: ['createdAt'], defaultSort: 'createdAt' });
    const action = (sp.get('action') || '').trim();
    const targetType = (sp.get('targetType') || '').trim();
    const targetId = (sp.get('targetId') || '').trim();

    const where: Prisma.AuditLogWhereInput = {
      ...(q ? { actorEmail: { contains: q, mode: 'insensitive' } } : {}),
      ...(action ? { action: { startsWith: action } } : {}),
      ...(targetType ? { targetType } : {}),
      ...(targetId ? { targetId } : {}),
      ...(dateRange(from, to) ? { createdAt: dateRange(from, to) } : {}),
    };

    const [entries, total, actions, targetTypes] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: dir }, skip, take }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
      prisma.auditLog.findMany({ distinct: ['targetType'], select: { targetType: true }, orderBy: { targetType: 'asc' } }),
    ]);

    return res.json({
      entries,
      total,
      actions: actions.map((a) => a.action),
      targetTypes: targetTypes.map((t) => t.targetType),
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin audit GET error', "We couldn't load the audit log. Please try again."));
  }
}));
