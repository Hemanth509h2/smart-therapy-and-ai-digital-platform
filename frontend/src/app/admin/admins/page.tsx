'use client';

import React, { useState } from 'react';
import { Copy, Lock, Mail, UserPlus } from 'lucide-react';
import {
  AdminPage, Badge, Btn, ConfirmDialog, DataTable, ErrorBanner, Field, Input, Modal, Section, Select,
  useAdmin, useAdminQuery, type Column,
} from '@/components/admin/kit';
import { adminFetch, fmtDate, timeAgo } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { ADMIN_ROLE_LABELS, type AdminRole } from '@/lib/adminRoles';
import { toast } from '@/components/practice/ui';

interface AdminRow {
  id: string | null;
  userId: string;
  name: string;
  email: string;
  adminRole: AdminRole;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
}

interface InviteRow {
  id: string;
  email: string;
  adminRole: AdminRole;
  expiresAt: string;
  expired: boolean;
  createdAt: string;
}

const ROLES = Object.keys(ADMIN_ROLE_LABELS) as AdminRole[];
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ADMIN_ROLE_LABELS[r].label }));

function RoleBadge({ role }: { role: AdminRole }) {
  return <Badge tone={role === 'SUPER_ADMIN' ? 'info' : 'neutral'}>{ADMIN_ROLE_LABELS[role].label}</Badge>;
}

export default function AdminsPage() {
  const { uid } = useAdmin();
  const { data, loading, error, reload } = useAdminQuery<{ admins: AdminRow[]; invites: InviteRow[] }>('/api/admin/admins', 'load the admins');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleChange, setRoleChange] = useState<{ admin: AdminRow; role: AdminRole } | null>(null);
  const [removing, setRemoving] = useState<AdminRow | null>(null);
  const [revoking, setRevoking] = useState<InviteRow | null>(null);

  const admins = data?.admins ?? [];
  const invites = data?.invites ?? [];

  const columns: Column<AdminRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (a) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold">{a.name || '—'}</span>
          {a.userId === uid && <Badge tone="good">You</Badge>}
          {a.status === 'SUSPENDED' && <Badge tone="bad">Suspended</Badge>}
        </div>
      ),
    },
    { key: 'email', header: 'Email', render: (a) => <span style={{ color: 'var(--ink-muted)' }}>{a.email}</span> },
    {
      key: 'role',
      header: 'Role',
      render: (a) =>
        a.userId === uid ? (
          <span title="You can't change your own role"><RoleBadge role={a.adminRole} /></span>
        ) : (
          <Select
            ariaLabel={`Role for ${a.email}`}
            value={a.adminRole}
            options={ROLE_OPTIONS}
            onChange={(v) => v !== a.adminRole && setRoleChange({ admin: a, role: v as AdminRole })}
          />
        ),
    },
    { key: 'seen', header: 'Last seen', render: (a) => <span title={a.lastSeenAt ?? undefined}>{timeAgo(a.lastSeenAt)}</span> },
    { key: 'added', header: 'Added', render: (a) => fmtDate(a.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (a) =>
        a.userId === uid ? null : (
          <Btn size="sm" variant="danger" onClick={() => setRemoving(a)}>Remove</Btn>
        ),
    },
  ];

  const inviteColumns: Column<InviteRow>[] = [
    { key: 'email', header: 'Email', render: (i) => <span className="font-semibold">{i.email}</span> },
    { key: 'role', header: 'Role', render: (i) => <RoleBadge role={i.adminRole} /> },
    { key: 'sent', header: 'Sent', render: (i) => timeAgo(i.createdAt) },
    {
      key: 'expires',
      header: 'Expires',
      render: (i) => (i.expired ? <Badge tone="warn">Expired</Badge> : fmtDate(i.expiresAt)),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (i) => <Btn size="sm" variant="ghost" onClick={() => setRevoking(i)}>{i.expired ? 'Remove' : 'Revoke'}</Btn>,
    },
  ];

  return (
    <AdminPage
      title="Admins"
      description="Who can use the admin portal, and what each person may do."
      permission="admins.manage"
      actions={<Btn icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>Invite admin</Btn>}
    >
      <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium" style={{ background: 'var(--sage-light)', color: 'var(--ink)' }}>
        <Lock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--sage)' }} />
        <span>
          Inviting, changing a role and removing an admin ask for your password again if you signed in more than 15 minutes ago.
          You can&apos;t change or remove yourself, and the last super admin can&apos;t be demoted or removed.
        </span>
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}

      <Section title="Admin accounts" description={data ? `${admins.length} admin${admins.length === 1 ? '' : 's'}` : undefined}>
        <DataTable columns={columns} rows={admins} rowKey={(a) => a.userId} loading={loading} empty="No admins found." />
      </Section>

      <Section title="Pending invites" description="Invites that haven't been accepted yet. Links expire after 7 days.">
        <DataTable columns={inviteColumns} rows={invites} rowKey={(i) => i.id} loading={loading} empty="No pending invites." />
      </Section>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={reload} />

      <ConfirmDialog
        open={!!roleChange}
        onClose={() => setRoleChange(null)}
        title="Change role?"
        body={
          roleChange && (
            <>
              {roleChange.admin.email} goes from <strong>{ADMIN_ROLE_LABELS[roleChange.admin.adminRole].label}</strong> to{' '}
              <strong>{ADMIN_ROLE_LABELS[roleChange.role].label}</strong>: {ADMIN_ROLE_LABELS[roleChange.role].description.toLowerCase()}.
            </>
          )
        }
        confirmLabel="Change role"
        onConfirm={async () => {
          if (!roleChange) return;
          await adminFetch(`/api/admin/admins/${encodeURIComponent(roleChange.admin.userId)}`, {
            method: 'PATCH',
            json: { adminRole: roleChange.role },
            action: 'change this role',
          });
          toast(`${roleChange.admin.email} is now ${ADMIN_ROLE_LABELS[roleChange.role].label}.`);
          reload();
        }}
      />

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove admin access?"
        body={
          removing && (
            <>
              {removing.name || removing.email} will lose access to the admin portal straight away. Their account stays; if they
              also have a professional or client profile they keep using that.
            </>
          )
        }
        confirmLabel="Remove admin"
        danger
        onConfirm={async () => {
          if (!removing) return;
          await adminFetch(`/api/admin/admins/${encodeURIComponent(removing.userId)}`, {
            method: 'DELETE',
            action: 'remove this admin',
          });
          toast(`${removing.name || removing.email} no longer has admin access.`);
          reload();
        }}
      />

      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title={revoking?.expired ? 'Remove invite?' : 'Revoke invite?'}
        body={revoking && <>The link sent to {revoking.email} will stop working.</>}
        confirmLabel={revoking?.expired ? 'Remove' : 'Revoke'}
        danger
        onConfirm={async () => {
          if (!revoking) return;
          await adminFetch(`/api/admin/invites?id=${encodeURIComponent(revoking.id)}`, {
            method: 'DELETE',
            action: 'revoke this invite',
          });
          toast(`The invite for ${revoking.email} was ${revoking.expired ? 'removed' : 'revoked'}.`);
          reload();
        }}
      />
    </AdminPage>
  );
}

function InviteModal({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('SUPPORT');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string; emailed: boolean; email: string } | null>(null);

  const close = () => {
    onClose();
    setTimeout(() => { setEmail(''); setRole('SUPPORT'); setResult(null); }, 200);
  };

  const send = async () => {
    setBusy(true);
    try {
      const d = await adminFetch<{ link: string; emailed: boolean }>('/api/admin/invites', {
        method: 'POST',
        json: { email: email.trim(), adminRole: role },
        action: 'send the invite',
      });
      setResult({ link: d.link, emailed: d.emailed, email: email.trim() });
      if (d.emailed) toast(`Invite emailed to ${email.trim()}.`);
      else toast(`Email isn't set up on the server, so send this link to ${email.trim()} yourself.`, 'warning');
      onInvited();
    } catch (e) {
      toast(caughtErrorMessage(e, 'send the invite'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      toast('Invite link copied.');
    } catch {
      toast('Could not copy — select the link and copy it.', 'error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={result ? 'Invite created' : 'Invite admin'}
      description={
        result
          ? `Invite link for ${result.email}.`
          : 'They get a link to accept. They must sign in (or sign up) with this email to accept it.'
      }
      footer={
        result ? (
          <Btn onClick={close}>Done</Btn>
        ) : (
          <>
            <Btn variant="ghost" onClick={close}>Cancel</Btn>
            <Btn icon={<Mail className="h-4 w-4" />} onClick={send} loading={busy} disabled={!email.trim()}>Send invite</Btn>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2">
          <Field label="Invite link" hint="Works once, for 7 days, only for that email.">
            <div className="flex gap-2">
              <Input readOnly value={result.link} onFocus={(e) => e.target.select()} />
              <Btn variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={copy} aria-label="Copy link" />
            </div>
          </Field>
        </div>
      ) : (
        <>
          <Field label="Email">
            <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@staad.in" onKeyDown={(e) => e.key === 'Enter' && email.trim() && send()} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold" style={{ color: 'var(--ink-muted)' }}>Role</legend>
            {ROLES.map((r) => (
              <label
                key={r}
                className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5"
                style={{ border: `1px solid ${role === r ? 'var(--sage)' : 'var(--glass-border)'}`, background: role === r ? 'var(--sage-light)' : 'var(--glass-bg)' }}
              >
                <input type="radio" name="admin-role" checked={role === r} onChange={() => setRole(r)} className="mt-1" style={{ accentColor: 'var(--sage)' }} />
                <span>
                  <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>{ADMIN_ROLE_LABELS[r].label}</span>
                  <span className="block text-xs" style={{ color: 'var(--ink-muted)' }}>{ADMIN_ROLE_LABELS[r].description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </>
      )}
    </Modal>
  );
}
