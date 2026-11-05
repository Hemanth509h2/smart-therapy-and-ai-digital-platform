'use client';

// Opened from the "Reset your STAAD password" email (sent by the backend via
// POST /api/auth/password-reset). The link carries Firebase's one-time code
// (?oobCode=…); this page checks it, then sets the new password with it.
// Public: the person is signed out.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { KeyRound, Loader2 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MIN_LENGTH = 8;

type State = 'checking' | 'ready' | 'invalid' | 'done';

function codeMessage(code: string | undefined) {
  switch (code) {
    case 'auth/expired-action-code':
      return 'This reset link has expired. Links work for about an hour.';
    case 'auth/invalid-action-code':
      return 'This reset link has already been used or is not valid.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support for help.';
    case 'auth/user-not-found':
      return 'This account no longer exists.';
    case 'auth/network-request-failed':
      return 'No internet connection. Check your connection and reload this page.';
    default:
      return "We couldn't check this reset link.";
  }
}

export default function ResetPasswordPage() {
  const [state, setState] = useState<State>('checking');
  const [oobCode, setOobCode] = useState('');
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('oobCode') || '';
    setOobCode(code);
    if (!code) {
      setProblem('This page needs the link from your reset email.');
      setState('invalid');
      return;
    }
    verifyPasswordResetCode(auth, code)
      .then((addr) => {
        setEmail(addr);
        setState('ready');
      })
      .catch((e) => {
        setProblem(codeMessage((e as { code?: string })?.code));
        setState('invalid');
      });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setSaving(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setState('done');
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
        setError('Choose a stronger password: longer, and not easy to guess.');
      } else if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
        setProblem(codeMessage(code));
        setState('invalid');
      } else {
        setError(codeMessage(code).replace('check this reset link', 'save your new password'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center px-4 py-12" style={{ background: 'var(--page-bg)' }}>
      <Card className="w-full max-w-md">
        <CardHeader>
          <div
            className="mb-2 flex h-11 w-11 items-center justify-center rounded-full"
            style={{ background: 'var(--sage-light)', color: 'var(--sage)' }}
          >
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle>
            {state === 'done' ? 'Password changed' : state === 'invalid' ? 'Link not valid' : 'Choose a new password'}
          </CardTitle>
          <CardDescription>
            {state === 'checking' && 'Checking your reset link…'}
            {state === 'ready' && <>For {email}</>}
            {state === 'invalid' && problem}
            {state === 'done' && 'You can now sign in with your new password.'}
          </CardDescription>
        </CardHeader>

        {state === 'checking' && (
          <CardContent className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--sage)' }} />
          </CardContent>
        )}

        {state === 'ready' && (
          <form onSubmit={submit}>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rp-new">New password</Label>
                <Input
                  id="rp-new"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={MIN_LENGTH}
                  required
                  autoFocus
                />
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  At least {MIN_LENGTH} characters.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-confirm">Repeat new password</Label>
                <Input
                  id="rp-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p role="alert" className="text-sm" style={{ color: 'var(--ds-red, #b3261e)' }}>
                  {error}
                </p>
              )}
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save new password
              </Button>
            </CardFooter>
          </form>
        )}

        {(state === 'done' || state === 'invalid') && (
          <CardFooter className="flex flex-col gap-2">
            <Link href="/auth" className="w-full">
              <Button type="button" className="w-full">
                {state === 'done' ? 'Sign in' : 'Back to sign in'}
              </Button>
            </Link>
            {state === 'invalid' && (
              <p className="text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
                On the sign-in page, enter your email and choose “Forgot password?” to get a new link.
              </p>
            )}
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
