'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/practice/ui';

function OnboardingForm() {
  const { uid, setRoleAndProfile } = useAuthStore();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const router = useRouter();

  // Therapist profile fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [specialtyInput, setSpecialtyInput] = useState('');
  const [phone, setPhone] = useState('');

  const [loading, setLoading] = useState(false);

  // Patients don't have accounts any more: an old invite link goes to the guest join page.
  useEffect(() => {
    if (inviteToken) router.replace(`/join/${encodeURIComponent(inviteToken)}`);
  }, [inviteToken, router]);

  useEffect(() => {
    if (!uid) {
      router.push('/auth');
    }
  }, [uid, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const specialty = specialtyInput.split(',').map(s => s.trim()).filter(s => s.length > 0);

    try {
      const response = await apiFetch('/api/users/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'THERAPIST',
          firstName,
          lastName,
          specialty,
          phoneNumber: phone,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Could not save your profile details.');
      }

      const data = await response.json();
      setRoleAndProfile('THERAPIST', data.profile);
      toast('Profile created — welcome to STAAD.');
      router.push('/');
    } catch (err: any) {
      toast(err.message || 'Could not complete your profile. Please try again.', 'error');
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
            Set up your therapist profile to start running sessions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="firstName" className="font-medium" style={{ color: 'var(--ink-muted)' }}>First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  placeholder="John"
                  className="rounded-xl border"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)' }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lastName" className="font-medium" style={{ color: 'var(--ink-muted)' }}>Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  className="rounded-xl border"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)' }}
                />
              </div>
            </div>

            <div className="space-y-4 animate-fadeIn">
              <div className="space-y-1">
                <Label htmlFor="phone" className="font-medium" style={{ color: 'var(--ink-muted)' }}>WhatsApp Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  required
                  className="rounded-xl border"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)' }}
                />
              </div>
              <div className="space-y-1">
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
              </div>


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
