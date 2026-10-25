'use client';

import React, { useEffect, useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { KeyRound, Save } from 'lucide-react';
import { AdminPage, Btn, Field, Input, KV, Section, useAdmin } from '@/components/admin/kit';
import { toast } from '@/components/practice/ui';
import { auth } from '@/lib/firebase';
import { adminFetch } from '@/lib/adminApi';
import { caughtErrorMessage, networkErrorMessage } from '@/lib/apiError';
import { ADMIN_ROLE_LABELS } from '@/lib/adminRoles';
import { useAuthStore } from '@/store/useAuthStore';

// The signed-in admin's own profile: name (editable), email, admin role and a
// password reset link. The role itself is changed by a super admin on the
// Admins page.
export default function AdminProfilePage() {
  const { email, profile, adminRole } = useAdmin();
  const setRoleAndProfile = useAuthStore((s) => s.setRoleAndProfile);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [pwSending, setPwSending] = useState(false);

  // Fill the form once the profile has loaded (and again if it changes).
  useEffect(() => {
    setFirstName(profile?.firstName ?? '');
    setLastName(profile?.lastName ?? '');
  }, [profile?.firstName, profile?.lastName]);

  const dirty = firstName.trim() !== (profile?.firstName ?? '') || lastName.trim() !== (profile?.lastName ?? '');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) return void toast('Enter your first name.', 'warning');
    setSaving(true);
    try {
      const res = await adminFetch<{ profile: any }>('/api/users/profile', {
        method: 'PUT',
        json: { firstName: firstName.trim(), lastName: lastName.trim() },
        action: 'save your profile',
      });
      // Updates the name in the sidebar straight away.
      setRoleAndProfile('ADMIN', res.profile);
      toast('Profile saved.');
    } catch (err) {
      toast(caughtErrorMessage(err, 'save your profile'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const sendReset = async () => {
    if (!email) return;
    setPwSending(true);
    try {
      await sendPasswordResetEmail(auth, email);
      toast(`Reset link sent to ${email}`);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      toast(
        code === 'auth/network-request-failed'
          ? networkErrorMessage('send the reset email')
          : code === 'auth/too-many-requests'
            ? 'Too many reset emails were requested. Wait a few minutes and try again.'
            : "We couldn't send the password reset email. Please try again.",
        'error'
      );
    }
    setPwSending(false);
  };

  return (
    <AdminPage title="My profile" description="Your name, sign-in email, admin role and password.">
      <Section title="Your details">
        <form onSubmit={save} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name">
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" required />
          </Field>
          <Field label="Last name">
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
          </Field>
          <div className="sm:col-span-2">
            <Btn type="submit" loading={saving} disabled={!dirty} icon={<Save className="h-4 w-4" />}>
              Save changes
            </Btn>
          </div>
        </form>
      </Section>

      <Section title="Account">
        <KV
          items={[
            { label: 'Email', value: email ?? '—' },
            { label: 'Admin role', value: ADMIN_ROLE_LABELS[adminRole].label },
            { label: 'What this role can do', value: ADMIN_ROLE_LABELS[adminRole].description },
          ]}
        />
        <p className="mt-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
          Only a super admin can change your role, on the Admins page.
        </p>
      </Section>

      <Section title="Password" description="We email you a link to set a new password.">
        <Btn variant="ghost" loading={pwSending} disabled={!email} onClick={sendReset} icon={<KeyRound className="h-4 w-4" />}>
          Send reset link
        </Btn>
      </Section>
    </AdminPage>
  );
}
