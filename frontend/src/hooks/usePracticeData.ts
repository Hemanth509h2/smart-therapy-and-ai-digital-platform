'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import type { PracticeBooking, PracticeClient, PracticeInvite, PracticeSession } from '@/lib/practice';
import { apiFetch } from '@/lib/api';
import { apiErrorMessage, networkErrorMessage } from '@/lib/apiError';

interface PracticeSnapshot {
  sessions: PracticeSession[];
  bookings: PracticeBooking[];
  clients: PracticeClient[];
  invites: PracticeInvite[];
  error: string | null;
  at: number;
}

// Shared across every page/component that calls the hook, so navigating
// between pages reuses the data instead of re-requesting it. Data younger than
// FRESH_MS is shown without any request; older data is shown immediately and
// refreshed in the background. `refresh()` (called after any mutation) always
// fetches.
const FRESH_MS = 60_000;
const cache = new Map<string, PracticeSnapshot>();
const inflight = new Map<string, Promise<PracticeSnapshot>>();
const listeners = new Set<(key: string) => void>();

async function fetchSnapshot(key: string, profileId: string, isTherapist: boolean): Promise<PracticeSnapshot> {
  const running = inflight.get(key);
  if (running) return running; // TopBar + page mount together: one set of requests
  const param = isTherapist ? `therapistId=${profileId}` : `clientId=${profileId}`;
  const job = (async () => {
    const prev = cache.get(key);
    try {
      const [sRes, bRes, cRes, iRes] = await Promise.all([
        apiFetch(`/api/sessions?${param}`),
        apiFetch(`/api/bookings?${param}`),
        isTherapist ? apiFetch(`/api/clients?therapistId=${profileId}`) : null,
        isTherapist ? apiFetch(`/api/invites?therapistId=${profileId}`) : null,
      ]);
      const snap: PracticeSnapshot = {
        sessions: sRes.ok ? (await sRes.json()).sessions ?? [] : prev?.sessions ?? [],
        bookings: bRes.ok ? (await bRes.json()).bookings ?? [] : prev?.bookings ?? [],
        clients: cRes?.ok ? (await cRes.json()).clients ?? [] : prev?.clients ?? [],
        invites: iRes?.ok ? (await iRes.json()).invites ?? [] : prev?.invites ?? [],
        error: sRes.ok ? null : await apiErrorMessage(sRes, 'load your sessions'),
        at: Date.now(),
      };
      cache.set(key, snap);
      return snap;
    } catch {
      const snap: PracticeSnapshot = {
        sessions: prev?.sessions ?? [],
        bookings: prev?.bookings ?? [],
        clients: prev?.clients ?? [],
        invites: prev?.invites ?? [],
        error: networkErrorMessage('load your sessions'),
        at: prev?.at ?? 0, // a failed fetch must not count as fresh
      };
      cache.set(key, snap);
      return snap;
    } finally {
      inflight.delete(key);
      listeners.forEach((fn) => fn(key));
    }
  })();
  inflight.set(key, job);
  return job;
}

/** Forget the shared data, so the next page to mount fetches it fresh. */
export function clearPracticeData() {
  cache.clear();
}

/**
 * Loads everything the practice pages show — sessions, bookings and, for
 * therapists, clients and pending invites — and exposes `refresh` so any
 * action (book, cancel, add note…) can re-sync the page.
 */
export function usePracticeData() {
  const { uid, role, profile } = useAuthStore();
  const key = profile?.id && role ? `${role}:${profile.id}` : '';
  const [snap, setSnap] = useState<PracticeSnapshot | undefined>(() => (key ? cache.get(key) : undefined));
  const [loading, setLoading] = useState(() => !(key && cache.get(key)));

  // Signed out: drop every cached record so the next account starts clean.
  useEffect(() => {
    if (!uid) {
      cache.clear();
      inflight.clear();
    }
  }, [uid]);

  // Pick up results fetched by another component using the same hook.
  useEffect(() => {
    if (!key) return;
    const onUpdate = (updated: string) => {
      if (updated === key) setSnap(cache.get(key));
    };
    listeners.add(onUpdate);
    return () => {
      listeners.delete(onUpdate);
    };
  }, [key]);

  const refresh = useCallback(async () => {
    if (!profile?.id || !role) return;
    const next = await fetchSnapshot(`${role}:${profile.id}`, profile.id, role === 'THERAPIST');
    setSnap(next);
    setLoading(false);
  }, [profile?.id, role]);

  useEffect(() => {
    if (!key) return;
    const cached = cache.get(key);
    setSnap(cached);
    setLoading(!cached);
    if (!cached || Date.now() - cached.at > FRESH_MS) refresh();
  }, [key, refresh]);

  return {
    uid,
    role,
    profile,
    sessions: snap?.sessions ?? EMPTY_SESSIONS,
    bookings: snap?.bookings ?? EMPTY_BOOKINGS,
    clients: snap?.clients ?? EMPTY_CLIENTS,
    invites: snap?.invites ?? EMPTY_INVITES,
    loading,
    error: snap?.error ?? null,
    refresh,
  };
}

// Stable references so consumers' effects/memos don't re-run on every render.
const EMPTY_SESSIONS: PracticeSession[] = [];
const EMPTY_BOOKINGS: PracticeBooking[] = [];
const EMPTY_CLIENTS: PracticeClient[] = [];
const EMPTY_INVITES: PracticeInvite[] = [];

/** Redirect signed-out users to /auth and non-therapists to their home. */
export function useTherapistGuard() {
  const { uid, role } = useAuthStore();
  const router = useRouter();
  useEffect(() => {
    if (!uid) router.push('/auth');
    else if (role && role !== 'THERAPIST') router.push(role === 'ADMIN' ? '/admin' : '/');
  }, [uid, role, router]);
}

/** Re-renders every `intervalMs` so countdowns and "missed" states stay current. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
