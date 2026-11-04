'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';
import { usePracticeData } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import { Btn, Section, SkeletonCard, cx } from '@/components/staad/parts';
import { IconCheckSm, IconRowA, IconRowB, IconRowC } from '@/components/staad/icons';
import { DsDialog, toast } from '@/components/practice/ui';
import {
  DAY_NAMES,
  DEFAULT_AVAILABILITY,
  DEFAULT_DURATION,
  downloadFile,
  fmtDate,
  fullName,
  hasDocs,
  initials,
  loadAvailability,
  saveAvailability,
  sessionDuration,
  toCsv,
  type Availability,
} from '@/lib/practice';
import { apiFetch } from '@/lib/api';
import { apiErrorMessage, caughtErrorMessage, networkErrorMessage } from '@/lib/apiError';

const SPECIALITIES = ['SLD', 'ADHD', 'Anxiety', 'Depression', 'ID', 'Autism', 'Dyslexia', 'Trauma', 'General'];
const QUALIFICATIONS = ['BA/BSc', 'MA/MSc', 'M.Phil', 'Ph.D', 'MD', 'DM'];

export default function ProfilePage() {
  const router = useRouter();
  const { uid, role, email, profile, setRoleAndProfile, clearAuth } = useAuthStore();
  const { sessions, bookings, clients, loading } = usePracticeData();

  const isTherapist = role === 'THERAPIST';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [qualification, setQualification] = useState('');
  const [experience, setExperience] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [availability, setAvailability] = useState<Availability>(DEFAULT_AVAILABILITY);

  const [saving, setSaving] = useState(false);
  const [pwSending, setPwSending] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [marketingSaving, setMarketingSaving] = useState(false);
  // Password accounts confirm deletion with their password; Google accounts
  // with a Google popup.
  const usesPassword = !!auth.currentUser?.providerData.some((p) => p.providerId === 'password');

  useEffect(() => {
    if (!uid) router.push('/auth');
  }, [uid, router]);

  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.firstName ?? '');
    setLastName(profile.lastName ?? '');
    setQualification(profile.qualification ?? '');
    setExperience(profile.experience ?? '');
    setSpecialties(profile.specialty ?? []);
    setBio(profile.bio ?? '');
    setPhone(profile.phoneNumber ? `+${profile.phoneNumber}` : '');
    setAvailability(loadAvailability(profile.id));
  }, [profile]);

  const snapshot = (v: unknown) => JSON.stringify(v);
  const initial = useMemo(
    () =>
      snapshot({
        firstName: profile?.firstName ?? '',
        lastName: profile?.lastName ?? '',
        qualification: profile?.qualification ?? '',
        experience: profile?.experience ?? '',
        specialties: profile?.specialty ?? [],
        bio: profile?.bio ?? '',
        phone: profile?.phoneNumber ? `+${profile.phoneNumber}` : '',
      }),
    [profile]
  );
  const dirty =
    !!profile && initial !== snapshot({ firstName, lastName, qualification, experience, specialties, bio, phone });

  const toggleSpecialty = (s: string) =>
    setSpecialties((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const toggleDay = (d: number) =>
    setAvailability((a) => {
      const next = {
        ...a,
        days: a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d].sort(),
      };
      saveAvailability(profile?.id, next);
      return next;
    });

  const setHours = (key: 'start' | 'end', value: string) =>
    setAvailability((a) => {
      const next = { ...a, [key]: value };
      saveAvailability(profile?.id, next);
      return next;
    });

  const discard = () => {
    if (!profile) return;
    setFirstName(profile.firstName ?? '');
    setLastName(profile.lastName ?? '');
    setQualification(profile.qualification ?? '');
    setExperience(profile.experience ?? '');
    setSpecialties(profile.specialty ?? []);
    setBio(profile.bio ?? '');
    setPhone(profile.phoneNumber ? `+${profile.phoneNumber}` : '');
  };

  const save = async () => {
    if (!uid || !role) return;
    if (!firstName.trim()) {
      toast('First name is required.', 'error');
      return;
    }
    if (isTherapist && phone.replace(/\D/g, '').length < 10) {
      toast('Enter a valid mobile number.', 'error');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        role,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      };
      if (isTherapist) Object.assign(body, { qualification, experience, specialty: specialties, bio, phoneNumber: phone });
      const res = await apiFetch('/api/users/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'save your profile'));
      const data = await res.json().catch(() => ({}));
      setRoleAndProfile(role, { ...profile, ...data.profile });
      toast('Your profile was saved.');
    } catch (e) {
      toast(caughtErrorMessage(e, 'save your profile'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
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

  // Everything STAAD holds about this account and its clients, as JSON
  // (GET /api/users/export).
  const exportAllData = async () => {
    setExporting(true);
    try {
      const res = await apiFetch('/api/users/export');
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'download your data'));
      downloadFile(`staad-my-data-${new Date().toISOString().slice(0, 10)}.json`, await res.text(), 'application/json');
      toast('A copy of all your data has been downloaded.');
    } catch (e) {
      toast(caughtErrorMessage(e, 'download your data'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const setMarketing = async (granted: boolean) => {
    setMarketingSaving(true);
    try {
      const res = await apiFetch('/api/users/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'MARKETING', granted }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'update your email preferences'));
      const data = await res.json();
      setRoleAndProfile('THERAPIST', data.profile);
      toast(granted ? 'You will receive product updates by email.' : 'You will no longer receive product update emails.');
    } catch (e) {
      toast(caughtErrorMessage(e, 'update your email preferences'), 'error');
    } finally {
      setMarketingSaving(false);
    }
  };

  const exportData = () => {
    const header = ['Client', 'Date', 'Status', 'Notes filed'];
    const rows = sessions.map((s) => [
      fullName(s.client) || 'Client',
      fmtDate(s.scheduledAt),
      s.status,
      hasDocs(s) ? 'Yes' : 'No',
    ]);
    downloadFile('staad-sessions.csv', toCsv([header, ...rows]), 'text/csv');
    toast('Your session list has been downloaded.');
  };

  const deleteAccount = async () => {
    if (deleteConfirm !== 'DELETE' || !uid) return;
    setDeleting(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('You are signed out. Sign in again, then delete your account.');
      // Sign in again first. Firebase only deletes a sign-in account within a
      // few minutes of signing in, and the server refuses to delete the data
      // otherwise (REAUTH_REQUIRED), so the data is never removed while the
      // sign-in account survives.
      if (usesPassword) {
        if (!currentUser.email || !deletePassword) throw new Error('Enter your password to confirm.');
        await reauthenticateWithCredential(currentUser, EmailAuthProvider.credential(currentUser.email, deletePassword));
      } else {
        await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
      }
      // A fresh ID token carries the new sign-in time to the server.
      await currentUser.getIdToken(true);
      // Delete server-side data FIRST: the backend verifies the Firebase ID
      // token, which becomes invalid once the Firebase user is deleted.
      const res = await apiFetch('/api/users/profile', { method: 'DELETE' });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'delete your account'));
      await deleteUser(currentUser);
      clearAuth();
      toast('Your account has been deleted.');
      router.push('/auth');
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      toast(
        code === 'auth/wrong-password' || code === 'auth/invalid-credential'
          ? 'That password is not correct. Nothing was deleted.'
          : code === 'auth/requires-recent-login'
            ? 'For security, please log out and log back in, then try again.'
            : caughtErrorMessage(err, 'delete your account'),
        'error'
      );
    } finally {
      setDeleting(false);
    }
  };

  // practice stats — all derived from real sessions
  const completed = sessions.filter((s) => s.status === 'COMPLETED');
  const filedOnTime = completed.filter(hasDocs).length;
  const notesPct = completed.length ? Math.round((filedOnTime / completed.length) * 100) : 0;
  const avgMinutes = completed.length
    ? Math.round(completed.reduce((a, s) => a + sessionDuration(s, bookings), 0) / completed.length)
    : DEFAULT_DURATION;

  return (
    <StaadShell>
      <TopBar sessions={sessions} />

      <div className="phead">
        <div>
          <div className="eyebrow">Your account</div>
          <h1 className="phead__title">Profile</h1>
          <p className="phead__lead">How you appear to clients, and how STAAD reaches you.</p>
        </div>
        <div className="phead__acts">
          <Btn onClick={discard} disabled={!dirty}>
            Discard
          </Btn>
          <Btn icon={<IconCheckSm />} variant="primary" onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Btn>
        </div>
      </div>

      <div className="cols">
        <div className="left">
          <Section title="Identity" sub="Clients see your name, title and focus areas when they book">
            <article className="card card--flat">
              <div className="rowflex" style={{ gap: 22 }}>
                <span className="av av--xxl av--user">{initials(firstName, lastName) || '—'}</span>
                <div>
                  <span style={{ display: 'block', fontWeight: 800 }}>
                    {`${firstName} ${lastName}`.trim() || 'Your name'}
                  </span>
                  <span className="lsub">
                    {[role ? role.charAt(0) + role.slice(1).toLowerCase() : null, experience]
                      .filter(Boolean)
                      .join(' · ') || 'Therapist'}
                  </span>
                </div>
              </div>

              <div className="fgrid" style={{ marginTop: 22 }}>
                <div className="field">
                  <label htmlFor="p-first">First name</label>
                  <input id="p-first" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="p-last">Last name</label>
                  <input id="p-last" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="p-email">Email</label>
                  <input id="p-email" type="email" value={email ?? ''} readOnly aria-readonly />
                </div>
                {isTherapist && (
                  <>
                    <div className="field">
                      <label htmlFor="p-phone">Mobile number</label>
                      <input
                        id="p-phone"
                        type="tel"
                        value={phone}
                        placeholder="+91 98765 43210"
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="p-qual">Professional title</label>
                      <select id="p-qual" value={qualification} onChange={(e) => setQualification(e.target.value)}>
                        <option value="">Not set</option>
                        {QUALIFICATIONS.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="p-exp">Experience</label>
                      <input
                        id="p-exp"
                        type="text"
                        value={experience}
                        placeholder="e.g. 6 years in practice"
                        onChange={(e) => setExperience(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>

              {isTherapist && (
                <>
                  <div className="field" style={{ marginTop: 16 }}>
                    <label htmlFor="p-bio">How you introduce yourself</label>
                    <textarea
                      id="p-bio"
                      value={bio}
                      placeholder="Two or three lines clients read before their first session."
                      onChange={(e) => setBio(e.target.value)}
                    />
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>
                      Focus areas
                    </div>
                    <div className="chips">
                      {SPECIALITIES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={cx('chip', specialties.includes(s) && 'on')}
                          aria-pressed={specialties.includes(s)}
                          onClick={() => toggleSpecialty(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </article>
          </Section>

          {isTherapist && (
            <Section title="Working hours" sub="The window clients can book into">
              <article className="card card--flat">
                <div className="fgrid">
                  <div className="field">
                    <label htmlFor="p-from">Weekdays from</label>
                    <input
                      id="p-from"
                      type="time"
                      value={availability.start}
                      onChange={(e) => setHours('start', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="p-until">Weekdays until</label>
                    <input
                      id="p-until"
                      type="time"
                      value={availability.end}
                      onChange={(e) => setHours('end', e.target.value)}
                    />
                  </div>
                </div>

                <div className="rowflex" style={{ marginTop: 16, flexWrap: 'wrap' }}>
                  {DAY_NAMES.map((name, i) => (
                    <button
                      key={name}
                      type="button"
                      className={cx('chip', availability.days.includes(i) && 'on')}
                      aria-pressed={availability.days.includes(i)}
                      onClick={() => toggleDay(i)}
                    >
                      {name}
                    </button>
                  ))}
                  <span className="note">Tap a day to open or close it</span>
                </div>
              </article>
            </Section>
          )}

          <Section title="Security" sub="Password and account access">
            <article className="card card--flat">
              <div className="switchrow">
                <span>
                  <span className="switchrow__t">Password</span>
                  <span className="switchrow__s">
                    We email you a secure link instead of storing a password here.
                  </span>
                </span>
                <Btn sm onClick={changePassword} disabled={pwSending || !email}>
                  {pwSending ? 'Sending…' : 'Send reset link'}
                </Btn>
              </div>
            </article>
          </Section>
        </div>

        <aside className="panel">
          <span className="panel__glow" />
          <div>
            <h2 className="panel__t">Your Practice</h2>
            <p className="panel__s">Since joining STAAD</p>
          </div>

          {loading ? (
            <SkeletonCard height={120} />
          ) : (
            <>
              <article className="pcard">
                <span className="prow__s" style={{ display: 'block' }}>
                  Sessions run
                </span>
                <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 34, color: '#fff' }}>
                  {completed.length}
                </span>
                <span className="prow__s" style={{ display: 'block' }}>
                  Across {clients.length} client{clients.length === 1 ? '' : 's'}
                </span>
              </article>

              <div className="panel__rows">
                <div className="prow">
                  <span style={{ display: 'flex', width: 38, height: 38, flex: 'none', alignItems: 'center' }}>
                    <IconRowA />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="prow__t">Notes filed</span>
                    <span className="prow__s">
                      {completed.length ? `${notesPct}% of completed sessions` : 'No completed sessions yet'}
                    </span>
                  </span>
                </div>
                <div className="prow">
                  <span style={{ display: 'flex', width: 38, height: 38, flex: 'none', alignItems: 'center' }}>
                    <IconRowB />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="prow__t">Average session</span>
                    <span className="prow__s">{avgMinutes} minutes</span>
                  </span>
                </div>
                <div className="prow">
                  <span style={{ display: 'flex', width: 38, height: 38, flex: 'none', alignItems: 'center' }}>
                    <IconRowC />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="prow__t">Focus areas</span>
                    <span className="prow__s">{specialties.length ? specialties.join(', ') : 'None set yet'}</span>
                  </span>
                </div>
              </div>
            </>
          )}

          {isTherapist && (
            <article className="pcard" style={{ marginTop: 14 }}>
              <span className="pcard__name">Email preferences</span>
              <p className="prow__s">
                Account, billing and session emails are always sent. Product updates and news are optional.
              </p>
              <label
                htmlFor="p-marketing"
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 12, fontSize: 14, color: 'var(--ink)' }}
              >
                <input
                  id="p-marketing"
                  type="checkbox"
                  checked={!!profile?.marketingOptIn}
                  disabled={marketingSaving}
                  onChange={(e) => setMarketing(e.target.checked)}
                  style={{ marginTop: 3, width: 16, height: 16, flex: 'none' }}
                />
                <span>Email me product updates and news from STAAD</span>
              </label>
            </article>
          )}

          <article className="pcard" style={{ marginTop: 14 }}>
            <span className="pcard__name">Your data</span>
            <p className="prow__s">
              Download a copy of everything STAAD holds about you and your clients, or close the account for good.
            </p>
            <div className="rowflex" style={{ marginTop: 12 }}>
              <button type="button" className="chip" onClick={exportAllData} disabled={exporting}>
                {exporting ? 'Preparing…' : 'Download all my data (JSON)'}
              </button>
              <button type="button" className="chip" onClick={exportData}>
                Session list (CSV)
              </button>
              <button type="button" className="chip" onClick={() => setDangerOpen(true)}>
                Delete account
              </button>
            </div>
          </article>
        </aside>
      </div>

      <DsDialog
        open={dangerOpen}
        onOpenChange={(o) => {
          setDangerOpen(o);
          if (!o) {
            setDeleteConfirm('');
            setDeletePassword('');
          }
        }}
        title="Delete your account"
        description="This removes your profile, clients, sessions, notes, reports and invites. It cannot be undone. Payment records are kept as tax law requires. Download your data first if you need a copy."
        footer={
          <>
            <button className="ds-btn ds-btn-ghost" onClick={() => setDangerOpen(false)}>
              Cancel
            </button>
            <button
              className="ds-btn ds-btn-clay"
              onClick={deleteAccount}
              disabled={deleteConfirm !== 'DELETE' || (usesPassword && !deletePassword) || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="p-confirm">Type DELETE to confirm</label>
          <input
            id="p-confirm"
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="DELETE"
          />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          {usesPassword ? (
            <>
              <label htmlFor="p-delete-password">Your password</label>
              <input
                id="p-delete-password"
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </>
          ) : (
            <p className="prow__s">You will be asked to sign in with Google again to confirm.</p>
          )}
        </div>
      </DsDialog>
    </StaadShell>
  );
}
