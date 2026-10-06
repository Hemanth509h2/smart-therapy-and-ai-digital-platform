'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteUser, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';
import { usePracticeData } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import { Btn, InlineError, Section, SkeletonCard, cx } from '@/components/staad/parts';
import { IconCheckSm, IconDownload, IconRowA, IconRowB, IconRowC } from '@/components/staad/icons';
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
  const [availability, setAvailability] = useState<Availability>(DEFAULT_AVAILABILITY);

  const [saving, setSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState('');
  const [pwSending, setPwSending] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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
      }),
    [profile]
  );
  const dirty =
    !!profile && initial !== snapshot({ firstName, lastName, qualification, experience, specialties, bio });

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
  };

  const save = async () => {
    if (!uid || !role) return;
    if (!firstName.trim()) {
      toast('First name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        uid,
        role,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      };
      if (isTherapist) Object.assign(body, { qualification, experience, specialty: specialties, bio });
      const res = await apiFetch('/api/users/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save your profile.');
      setRoleAndProfile(role, { ...profile, ...data.profile });
      toast('Profile saved');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save your profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (!email) return;
    setPwMessage('');
    setPwSending(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setPwMessage(`Reset link sent to ${email}`);
      toast('Password reset email sent');
    } catch {
      setPwMessage('Could not send reset email. Please try again.');
    }
    setPwSending(false);
  };

  const exportData = () => {
    const header = ['Client', 'Date', 'Status', 'Notes filed'];
    const rows = sessions.map((s) => [
      fullName(s.client) || 'Client',
      fmtDate(s.scheduledAt),
      s.status,
      hasDocs(s) ? 'Yes' : 'No',
    ]);
    downloadFile('staad-my-data.csv', toCsv([header, ...rows]), 'text/csv');
    toast('Your session data has been downloaded.');
  };

  const deleteAccount = async () => {
    if (deleteConfirm !== 'DELETE' || !uid) return;
    setDeleteError('');
    setDeleting(true);
    try {
      const currentUser = auth.currentUser;
      if (currentUser) await deleteUser(currentUser);
      await apiFetch('/api/users/profile', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });
      clearAuth();
      router.push('/auth');
    } catch (err: any) {
      setDeleteError(
        err?.code === 'auth/requires-recent-login'
          ? 'For security, please log out and log back in, then try again.'
          : 'Could not delete account. Please try again.'
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
                    {pwMessage || 'We email you a secure link instead of storing a password here.'}
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

          <article className="pcard" style={{ marginTop: 14 }}>
            <span className="pcard__name">Danger zone</span>
            <p className="prow__s">Export everything, or close the account for good.</p>
            <div className="rowflex" style={{ marginTop: 12 }}>
              <button type="button" className="chip" onClick={exportData}>
                Export data
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
            setDeleteError('');
          }
        }}
        title="Delete your account"
        description="This removes your profile, sessions, notes and invites. It cannot be undone."
        footer={
          <>
            <button className="ds-btn ds-btn-ghost" onClick={() => setDangerOpen(false)}>
              Cancel
            </button>
            <button
              className="ds-btn ds-btn-clay"
              onClick={deleteAccount}
              disabled={deleteConfirm !== 'DELETE' || deleting}
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
        {deleteError && <InlineError message={deleteError} />}
      </DsDialog>
    </StaadShell>
  );
}
