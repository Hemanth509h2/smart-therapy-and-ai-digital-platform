// Mirror of backend/src/lib/admin/adminRoles.ts — used only to hide what an admin
// role can't use. The backend enforces it on every request.

export type AdminRole = 'SUPER_ADMIN' | 'BILLING' | 'SUPPORT' | 'CONTENT';

export type AdminPermission =
  | 'people.read'
  | 'people.write'
  | 'phi.read'
  | 'billing.read'
  | 'billing.write'
  | 'support'
  | 'content'
  | 'settings'
  | 'audit.read'
  | 'admins.manage';

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

export const ADMIN_ROLE_LABELS: Record<AdminRole, { label: string; description: string }> = {
  SUPER_ADMIN: { label: 'Super admin', description: 'Everything, including managing admins' },
  BILLING: { label: 'Billing', description: 'Plans and subscriptions' },
  SUPPORT: { label: 'Support', description: 'Read-only on people and billing; support inbox and messages' },
  CONTENT: { label: 'Content', description: 'Module library and app settings' },
};

export function adminRoleOf(profile: any): AdminRole {
  return (profile?.adminRole as AdminRole) || 'SUPER_ADMIN';
}

export function canAdmin(role: AdminRole, permission: AdminPermission) {
  return ADMIN_PERMISSIONS[role].includes(permission);
}
