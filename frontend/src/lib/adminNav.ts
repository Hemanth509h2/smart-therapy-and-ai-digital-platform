// Admin portal navigation, shared by the STAAD shell (components/staad/Shell)
// and the legacy sidebar. Each item lists the permission it needs; items the
// signed-in admin's role can't use are hidden (the backend enforces it anyway).
import {
  Boxes,
  FileDown,
  Gauge,
  HeartPulse,
  Inbox,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  TicketPercent,
  User,
  UserCog,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { adminRoleOf, canAdmin, type AdminPermission } from '@/lib/adminRoles';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: AdminPermission;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/professionals', label: 'Professionals', icon: Users, permission: 'people.read' },
  { href: '/admin/clients', label: 'Clients', icon: User, permission: 'people.read' },
  { href: '/admin/sessions', label: 'Sessions', icon: Video, permission: 'people.read' },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: Receipt, permission: 'billing.read' },
  { href: '/admin/plans', label: 'Plans', icon: Layers, permission: 'billing.read' },
  { href: '/admin/coupons', label: 'Coupons', icon: TicketPercent, permission: 'billing.read' },
  { href: '/admin/support', label: 'Support inbox', icon: Inbox, permission: 'support' },
  { href: '/admin/messages', label: 'Messages', icon: MessageSquare, permission: 'support' },
  { href: '/admin/usage', label: 'Usage & cost', icon: Gauge, permission: 'people.read' },
  { href: '/admin/modules', label: 'Module library', icon: Boxes, permission: 'content' },
  { href: '/admin/reports', label: 'Reports', icon: FileDown, permission: 'people.read' },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.read' },
  { href: '/admin/health', label: 'System health', icon: HeartPulse, permission: 'settings' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, permission: 'settings' },
  { href: '/admin/admins', label: 'Admins', icon: Shield, permission: 'admins.manage' },
  { href: '/admin/profile', label: 'My profile', icon: UserCog },
];

export function adminNavFor(profile: any) {
  const role = adminRoleOf(profile);
  return ADMIN_NAV.filter((i) => !i.permission || canAdmin(role, i.permission));
}
