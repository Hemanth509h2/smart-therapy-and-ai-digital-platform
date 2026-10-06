'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';

function OnboardingForm() {
  const { uid, email, setRoleAndProfile } = useAuthStore();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const router = useRouter();
  const [role, setRole] = useState<'THERAPIST' | 'CLIENT'>('THERAPIST');

  // Therapist profile fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [specialtyInput, setSpecialtyInput] = useState('');

  // Client profile fields
  const [dob, setDob] = useState('');
  const [diagnosisInput, setDiagnosisInput] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const param = searchParams.get('role') as 'THERAPIST' | 'CLIENT' | null;
    if (param === 'THERAPIST' || param === 'CLIENT') {
      setRole(param);
    }
  }, [searchParams]);

  // Invite flow: lock role to CLIENT and prefill name + diagnosis from the invite.
  useEffect(() => {
    if (!inviteToken) return;
    setRole('CLIENT');
    apiFetch(`/api/invites/${inviteToken}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.invite) {
          setFirstName(data.invite.firstName || '');
          setLastName(data.invite.lastName || '');
          setDiagnosisInput((data.invite.diagnosis || []).join(', '));
        }
      })
      .catch(() => {});
  }, [inviteToken]);

  useEffect(() => {
    if (!uid) {
      router.push('/auth');
    }
  }, [uid, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const specialty = specialtyInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const diagnosis = diagnosisInput.split(',').map(d => d.trim()).filter(d => d.length > 0);

    try {
      const response = await apiFetch('/api/users/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid,
          email,
          role,
          firstName,
          lastName,
          specialty,
          dateOfBirth: dob || undefined,
          diagnosis,
          inviteToken: inviteToken || undefined,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to save onboarding details');
      }

      const data = await response.json();
      setRoleAndProfile(role, data.profile);
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Onboarding registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12" style={{ background: 'var(--page-bg)' }}>
      <Card className="w-full max-w-lg border shadow-[var(--glass-shadow)] rounded-2xl bg-white dark:bg-[#16221e]" style={{ borderColor: 'var(--glass-border)' }}>
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-3xl font-bold" style={{ color: 'var(--ink)' }}>Complete Your Profile</CardTitle>
          <CardDescription className="font-medium" style={{ color: 'var(--ink-muted)' }}>
            Setup your role and profile to start therapy sessions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {inviteToken ? (
              <div className="rounded-xl p-3 text-sm font-medium" style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)', border: '1px solid var(--glass-border)' }}>
                Joining as a patient — your name and diagnosis were set by your therapist. Just add your date of birth below.
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="font-medium" style={{ color: 'var(--ink-muted)' }}>Select Your Account Type</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('THERAPIST')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                      role === 'THERAPIST'
                        ? 'text-white shadow-sm'
                        : 'text-[var(--ink-muted)] border-[var(--glass-border)] hover:border-[var(--sage)]/40'
                    }`}
                    style={role === 'THERAPIST' ? { background: 'var(--sage)', borderColor: 'var(--sage)' } : { background: 'var(--glass-bg)' }}
                  >
                    Therapist
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('CLIENT')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                      role === 'CLIENT'
                        ? 'text-white shadow-sm'
                        : 'text-[var(--ink-muted)] border-[var(--glass-border)] hover:border-[var(--sage)]/40'
                    }`}
                    style={role === 'CLIENT' ? { background: 'var(--sage)', borderColor: 'var(--sage)' } : { background: 'var(--glass-bg)' }}
                  >
                    Client / Student
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="firstName" className="font-medium" style={{ color: 'var(--ink-muted)' }}>First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  readOnly={!!inviteToken}
                  placeholder="John"
                  className="rounded-xl border"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)', opacity: inviteToken ? 0.7 : 1 }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lastName" className="font-medium" style={{ color: 'var(--ink-muted)' }}>Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  readOnly={!!inviteToken}
                  placeholder="Doe"
                  className="rounded-xl border"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)', opacity: inviteToken ? 0.7 : 1 }}
                />
              </div>
            </div>

            {role === 'THERAPIST' ? (
              <div className="space-y-1 animate-fadeIn">
                <Label htmlFor="specialty" className="font-medium" style={{ color: 'var(--ink-muted)' }}>Specialties (comma-separated)</Label>
                <Input 
                  id="specialty" 
                  value={specialtyInput} 
                  onChange={(e) => setSpecialtyInput(e.target.value)} 
                  placeholder="ADHD, SLD, Autism, Dyslexia"
                  className="rounded-xl border"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)' }}
                />
              </div>
            ) : (
              <div className="space-y-4 animate-fadeIn">
                <div className="space-y-1">
                  <Label htmlFor="dob" className="font-medium" style={{ color: 'var(--ink-muted)' }}>Date of Birth</Label>
                  <Input 
                    id="dob" 
                    type="date" 
                    value={dob} 
                    onChange={(e) => setDob(e.target.value)} 
                    required
                    className="rounded-xl border"
                    style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)' }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="diagnosis" className="font-medium" style={{ color: 'var(--ink-muted)' }}>Diagnosis / Learning Needs (comma-separated)</Label>
                  <Input
                    id="diagnosis"
                    value={diagnosisInput}
                    onChange={(e) => setDiagnosisInput(e.target.value)}
                    readOnly={!!inviteToken}
                    placeholder="ADHD, Anxiety, Dyslexia"
                    className="rounded-xl border"
                    style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)', opacity: inviteToken ? 0.7 : 1 }}
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 font-medium text-center">{error}</p>
            )}

            <Button 
              type="submit" 
              disabled={loading}
              className="w-full transition-all rounded-xl py-5 font-semibold"
              style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}
            >
              {loading ? 'Setting up account...' : 'Save Profile'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingForm />
    </Suspense>
  );
}
