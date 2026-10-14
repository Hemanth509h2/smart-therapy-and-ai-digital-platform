// What each admin role may do. Every /api/admin/* handler passes the
// permission it needs to requireAdmin(); the frontend mirrors this map in
// frontend/src/lib/adminRoles.ts to hide what a role can't use.
import type { AdminRole } from '@prisma/client';

export type AdminPermission =
  | 'people.read' // therapists, clients, sessions, usage
  | 'people.write' // suspend, module access, reassign, grant plans
  | 'phi.read' // reveal client names/diagnoses (each reveal is audited)
  | 'billing.read' // plans, subscriptions
  | 'billing.write' // edit plans and subscriptions
  | 'support' // support inbox, messaging
  | 'content' // module library
  | 'settings' // app settings, system health
  | 'audit.read'
  | 'admins.manage'; // invite/remove admins, change roles

const ALL: AdminPermission[] = [
  'people.read', 'people.write', 'phi.read', 'billing.read', 'billing.write',
  'support', 'content', 'settings', 'audit.read', 'admins.manage',
];

export const ADMIN_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  SUPER_ADMIN: ALL,
  BILLING: ['people.read', 'billing.read', 'billing.write'],
  SUPPORT: ['people.read', 'phi.read', 'billing.read', 'support'],
  CONTENT: ['content', 'settings'],
};

export function can(role: AdminRole | null | undefined, permission: AdminPermission) {
  return !!role && ADMIN_PERMISSIONS[role].includes(permission);
}
