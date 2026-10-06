'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider 
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Heart, Sparkles, Video, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';

function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'THERAPIST' | 'CLIENT'>('THERAPIST');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const { uid } = useAuthStore();

  const [inviteInfo, setInviteInfo] = useState<{ firstName: string; therapistName: string; status: string } | null>(null);

  useEffect(() => {
    if (uid) {
      router.push('/');
    }
  }, [uid, router]);

  // When arriving via an invite link, switch to signup as a CLIENT and load the invite.
  useEffect(() => {
    if (!inviteToken) return;
    setIsLogin(false);
    setRole('CLIENT');
    apiFetch(`/api/invites/${inviteToken}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.invite) {
          setInviteInfo({
            firstName: data.invite.firstName,
            therapistName: data.invite.therapistName,
            status: data.invite.status,
          });
        }
      })
      .catch(() => {});
  }, [inviteToken]);

  const onboardingUrl = (r: 'THERAPIST' | 'CLIENT') =>
    `/onboarding?role=${r}${inviteToken ? `&invite=${inviteToken}` : ''}`;

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        router.push('/');
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        router.push(onboardingUrl(role));
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError(null);
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const checkProfile = await apiFetch(`/api/users/profile?uid=${result.user.uid}`);
      if (checkProfile.ok) {
        router.push('/');
      } else {
        router.push(onboardingUrl(inviteToken ? 'CLIENT' : role));
      }
    } catch (err: any) {
      setError(err.message || 'Google Auth failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden" style={{ background: 'var(--page-bg)' }}>
      {/* Decorative animated background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="blob animate-blob"
          style={{ top: '-12%', left: '-8%', width: '42vw', height: '42vw', background: 'radial-gradient(circle at 30% 30%, rgba(200, 96, 42, 0.18), transparent 70%)' }}
        />
        <div
          className="blob animate-blob"
          style={{ bottom: '-16%', right: '-10%', width: '46vw', height: '46vw', background: 'radial-gradient(circle at 70% 70%, rgba(156, 125, 89, 0.22), transparent 70%)', animationDelay: '-7s' }}
        />
        <div
          className="blob animate-blob"
          style={{ top: '28%', right: '22%', width: '28vw', height: '28vw', background: 'radial-gradient(circle at 50% 50%, rgba(179, 152, 115, 0.16), transparent 70%)', animationDelay: '-14s' }}
        />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        {/* Brand hero */}
        <div className="relative flex flex-1 flex-col justify-center px-8 py-12 lg:px-16 xl:px-24">
          <div className="mx-auto w-full max-w-lg animate-fade-up">
            <div
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider"
              style={{ background: 'var(--sage-light)', color: 'var(--sage)', border: '1px solid var(--glass-border)' }}
            >
              <Sparkles className="h-3.5 w-3.5" /> Collaborative therapy
            </div>
            <img
              src="/assests/staad-logo-horizontal.svg"
              alt="STAAD"
              className="mt-6"
              style={{ height: 132, width: 'auto', display: 'block' }}
            />
            <p className="mt-4 max-w-md text-lg font-medium" style={{ color: 'var(--ink-muted)' }}>
              A calm, emotionally safe, and interactive space for neurodivergent learners and their therapists.
            </p>

            <div className="mt-10 space-y-3">
              {[
                { icon: Video, title: 'Live, collaborative sessions', desc: 'Real-time video with shared interactive modules.' },
                { icon: Heart, title: 'Calming, playful tools', desc: 'Gentle activities designed to ease anxiety.' },
                { icon: ShieldCheck, title: 'Private & consent-first', desc: 'AI insights only with explicit consent.' },
              ].map(({ icon: Icon, title, desc }, i) => (
                <div
                  key={title}
                  className={`flex items-start gap-3 rounded-2xl p-4 hover-lift animate-fade-up stagger-${i + 1}`}
                  style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)', backdropFilter: 'blur(8px)' }}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: 'var(--sage-light)', color: 'var(--sage)' }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
                    <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Auth column */}
        <div className="flex flex-1 items-center justify-center px-4 py-10 lg:py-12">
      <Card className="w-full max-w-md border shadow-[var(--glass-shadow)] rounded-2xl bg-white dark:bg-[#16221e] animate-scale-in" style={{ borderColor: 'var(--glass-border)' }}>
        <CardHeader className="space-y-2 text-center pb-4">
          <CardTitle className="flex justify-center">
            <img
              src="/assests/staad-logo-horizontal.svg"
              alt="STAAD"
              style={{ height: 64, width: 'auto', display: 'block' }}
            />
          </CardTitle>
          <CardDescription className="font-medium" style={{ color: 'var(--ink-muted)' }}>
            {isLogin ? 'Welcome back to your calming space' : 'Begin your journey with dynamic therapy tools'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {inviteInfo && (
            <div className="rounded-xl p-3 text-sm font-medium" style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)', border: '1px solid var(--glass-border)' }}>
              {inviteInfo.status === 'CLAIMED'
                ? 'This invite has already been used. Please log in instead.'
                : <>You've been invited by <strong>{inviteInfo.therapistName}</strong>. Create your account to join your session.</>}
            </div>
          )}
          <form onSubmit={handleAuth} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email" className="font-medium" style={{ color: 'var(--ink-muted)' }}>Email</Label>
              <Input 
                id="email" 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                required 
                placeholder="you@domain.com"
                className="rounded-xl border focus-visible:ring-[var(--sage)]/40"
                style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)' }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password" className="font-medium" style={{ color: 'var(--ink-muted)' }}>Password</Label>
              <Input 
                id="password" 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
                className="rounded-xl border focus-visible:ring-[var(--sage)]/40"
                style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)' }}
              />
            </div>
            
            {!isLogin && !inviteToken && (
              <div className="space-y-2">
                <Label className="font-medium text-sm" style={{ color: 'var(--ink-muted)' }}>I am a...</Label>
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

            {error && (
              <p className="text-sm text-red-600 font-medium text-center">{error}</p>
            )}

            <Button 
              type="submit" 
              disabled={loading}
              className="w-full transition-all rounded-xl py-5 font-semibold"
              style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}
            >
              {loading ? 'Please wait...' : isLogin ? 'Login' : 'Create Account'}
            </Button>
          </form>

          <div className="relative flex items-center justify-center my-4">
            <span className="absolute w-full border-t" style={{ borderColor: 'var(--glass-border)' }}></span>
            <span className="relative bg-white dark:bg-[#16221e] px-3 text-xs font-medium uppercase" style={{ color: 'var(--ink-muted)' }}>Or continue with</span>
          </div>

          <Button 
            type="button" 
            variant="outline" 
            onClick={handleGoogleAuth} 
            disabled={loading}
            className="w-full transition-all rounded-xl py-5 flex items-center justify-center gap-2"
            style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)', color: 'var(--ink)' }}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Google Auth
          </Button>
        </CardContent>
        <CardFooter className="justify-center pt-2 pb-6">
          <button 
            onClick={() => setIsLogin(!isLogin)} 
            className="text-sm font-semibold transition-all rounded-lg px-3 py-1.5"
            style={{ color: 'var(--sage)' }}
          >
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Login'}
          </button>
        </CardFooter>
      </Card>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm />
    </Suspense>
  );
}
