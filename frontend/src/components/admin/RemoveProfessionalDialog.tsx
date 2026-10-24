'use client';

import React, { useEffect, useState } from 'react';
import { Btn, Field, Input, Modal } from '@/components/admin/kit';
import { adminFetch } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { toast } from '@/components/practice/ui';

export interface RemoveTarget {
  userId: string;
  name: string | null;
  email: string;
  clients?: number;
}

/**
 * Permanently removes a professional and all their data (super admins only).
 * The confirm button stays disabled until the account email is typed exactly.
 */
export function RemoveProfessionalDialog({
  target,
  onClose,
  onRemoved,
}: {
  target: RemoveTarget | null;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) setTyped('');
  }, [target]);

  const matches = !!target && typed.trim().toLowerCase() === target.email.toLowerCase();
  const who = target?.name || 'This professional';

  const remove = async () => {
    if (!target || !matches) return;
    setBusy(true);
    try {
      const r = await adminFetch<{ sessions: number; clients: number; warnings: string[] }>(`/api/admin/users/${target.userId}`, {
        method: 'DELETE',
        json: { confirmEmail: typed.trim() },
        action: 'remove this professional',
      });
      toast(`${who} was removed${r.sessions ? ` (${r.sessions} session${r.sessions === 1 ? '' : 's'} deleted)` : ''}.`);
      if (r.warnings?.length) toast(`Some session transcripts couldn't be deleted (${r.warnings.length}). See the audit log.`, 'warning');
      onClose();
      onRemoved();
    } catch (e) {
      toast(caughtErrorMessage(e, 'remove this professional'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      onClose={busy ? () => {} : onClose}
      title="Remove professional permanently?"
      description={
        <>
          <strong>{who}</strong> ({target?.email}) and everything they created will be deleted. <strong>This can&apos;t be undone.</strong>
        </>
      }
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="danger" onClick={remove} loading={busy} disabled={!matches}>Remove permanently</Btn>
        </>
      }
    >
      <ul className="list-disc space-y-1 pl-5 text-sm" style={{ color: 'var(--ink-muted)' }}>
        <li>Their sign-in account, profile, plan and subscription history</li>
        <li>All their sessions, bookings, session notes, AI reports, transcripts and progress records</li>
        <li>Their invites and uploaded documents</li>
        <li>
          Their clients&apos; accounts are <strong>kept</strong> but unlinked
          {typeof target?.clients === 'number' ? ` (${target.clients} client${target.clients === 1 ? '' : 's'})` : ''}.
        </li>
      </ul>
      <Field label={`Type ${target?.email ?? 'the email'} to confirm`}>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={target?.email}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter') remove(); }}
        />
      </Field>
    </Modal>
  );
}
