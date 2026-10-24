'use client';

import React, { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Btn, Checkbox, Field, Input, Modal } from '@/components/admin/kit';
import { adminFetch } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { toast } from '@/components/practice/ui';

interface Created {
  professional: { id: string; userId: string; name: string; email: string };
  setupLink: string | null;
  emailed: boolean;
}

const blank = { firstName: '', lastName: '', email: '', phoneNumber: '', specialty: '', setPassword: false, password: '' };

/**
 * Creates a professional (therapist) account. By default the professional is
 * emailed a link to set their own password; the admin can set one instead.
 * If the email couldn't be sent, the set-password link is shown to copy.
 */
export function AddProfessionalDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: Created['professional']) => void;
}) {
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  // Set after creating, when the link still has to reach the professional.
  const [pending, setPending] = useState<Created | null>(null);

  useEffect(() => {
    if (open) {
      setForm(blank);
      setPending(null);
    }
  }, [open]);

  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const email = form.email.trim();
    if (!form.firstName.trim()) return void toast("Enter the professional's first name.", 'warning');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void toast('Enter a valid email address.', 'warning');
    if (form.phoneNumber.replace(/\D/g, '').length < 10) return void toast('Enter a phone number with at least 10 digits.', 'warning');
    if (form.setPassword && form.password.length < 8) return void toast('The password must be at least 8 characters.', 'warning');

    setBusy(true);
    try {
      const res = await adminFetch<Created>('/api/admin/professionals', {
        method: 'POST',
        action: "create the professional's account",
        json: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email,
          phoneNumber: form.phoneNumber,
          specialty: form.specialty.split(',').map((s) => s.trim()).filter(Boolean),
          ...(form.setPassword ? { password: form.password } : {}),
        },
      });
      const name = res.professional.name || res.professional.email;
      onCreated(res.professional);
      if (form.setPassword) {
        toast(`${name}'s account was created. Share the password with them so they can sign in.`);
        onClose();
      } else if (res.emailed) {
        toast(`${name}'s account was created. We emailed ${res.professional.email} a link to set their password.`);
        onClose();
      } else {
        // Account exists, but the link didn't go out: keep the dialog open with it.
        toast(
          res.setupLink
            ? `${name}'s account was created, but the email couldn't be sent. Copy the set-password link and send it to them.`
            : `${name}'s account was created, but we couldn't make a set-password link. They can use "Forgot password" on the sign-in page.`,
          'warning',
          { duration: 9000 }
        );
        if (res.setupLink) setPending(res);
        else onClose();
      }
    } catch (e) {
      toast(caughtErrorMessage(e, "create the professional's account"), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!pending?.setupLink) return;
    try {
      await navigator.clipboard.writeText(pending.setupLink);
      toast('Set-password link copied.');
    } catch {
      toast("Couldn't copy the link. Select it and copy it manually.", 'error');
    }
  };

  if (pending) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Send the set-password link"
        description={`${pending.professional.name}'s account is ready. Send them this link so they can set a password, then sign in with ${pending.professional.email}.`}
        footer={<Btn onClick={onClose}>Done</Btn>}
      >
        <div className="flex gap-2">
          <Input readOnly value={pending.setupLink ?? ''} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Btn variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={copyLink} aria-label="Copy link" />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add professional"
      description="Creates a therapist account. They can sign in once they've set a password."
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={submit} loading={busy}>Create account</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Last name">
          <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} autoComplete="off" />
        </Field>
      </div>
      <Field label="Email" hint="They sign in with this email.">
        <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" autoComplete="off" />
      </Field>
      <Field label="Phone number" hint="Include the country code. 10 digits are treated as an Indian number.">
        <Input type="tel" value={form.phoneNumber} onChange={(e) => set('phoneNumber', e.target.value)} placeholder="+91 98765 43210" autoComplete="off" />
      </Field>
      <Field label="Specialties (optional)" hint="Separate with commas, e.g. ADHD, Autism, Dyslexia.">
        <Input value={form.specialty} onChange={(e) => set('specialty', e.target.value)} />
      </Field>
      <Checkbox checked={form.setPassword} onChange={(v) => set('setPassword', v)} label="Set a password now instead of emailing a link" />
      {form.setPassword && (
        <Field label="Password" hint="At least 8 characters. Share it with them securely.">
          <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        </Field>
      )}
    </Modal>
  );
}
