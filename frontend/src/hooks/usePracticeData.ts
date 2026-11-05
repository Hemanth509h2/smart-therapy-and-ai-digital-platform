'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import type { PracticeBooking, PracticeClient, PracticeInvite, PracticeSession } from '@/lib/practice';
import { apiFetch } from '@/lib/api';
import { apiErrorMessage, networkErrorMessage } from '@/lib/apiError';

type Part = 'sessions' | 'bookings' | 'clients' | 'invites';

interface PracticeSnapshot {
  sessions: PracticeSession[];
  bookings: PracticeBooking[];
  clients: PracticeClient[];
  invites: PracticeInvite[];
  /** Which parts have arrived at least once, so pages can show each section
   *  as soon as its own data is in instead of waiting for all four. */
  ready: Record<Part, boolean>;
  error: string | null;
  /** When the last complete fetch finished; 0 = never (or it failed). */
  at: number;
}

const NOT_READY: Record<Part, boolean> = { sessions: false, bookings: false, clients: false, invites: false };

// Shared across every page/component that calls the hook, so navigating
// between pages reuses the data instead of re-requesting it. Data younger than
// FRESH_MS is shown without any request; older data is shown immediately and
// refreshed in the background. `refresh()` (called after any mutation) always
// fetches.
const FRESH_MS = 60_000;
const cache = new Map<string, PracticeSnapshot>();
const inflight = new Map<string, Promise<PracticeSnapshot>>();
const listeners = new Set<(key: string) => void>();

/** Merges one part into the cached snapshot (a new object, so React re-renders) and tells every hook. */
function update(key: string, patch: Partial<PracticeSnapshot>) {
  const prev = cache.get(key);
  cache.set(key, {
    sessions: [],
    bookings: [],
    clients: [],
    invites: [],
    error: null,
    at: 0,
    ...prev,
    ...patch,
    ready: { ...NOT_READY, ...prev?.ready, ...patch.ready },
  });
  listeners.forEach((fn) => fn(key));
}

// The four requests run in parallel and each one is stored and shown the
// moment it arrives. A failed part keeps its previous data.
async function fetchSnapshot(key: string, profileId: string, isTherapist: boolean): Promise<PracticeSnapshot> {
  const running = inflight.get(key);
  if (running) return running; // TopBar + page mount together: one set of requests
  const param = isTherapist ? `therapistId=${profileId}` : `clientId=${profileId}`;

  let failed = false;
  const load = async (part: Part, url: string, what: string) => {
    try {
      const res = await apiFetch(url);
      if (!res.ok) {
        failed = true;
        // Only the sessions error is shown, as before; the rest keep old data quietly.
        const patch: Partial<PracticeSnapshot> = { ready: { [part]: true } as Record<Part, boolean> };
        if (part === 'sessions') patch.error = await apiErrorMessage(res, what);
        update(key, patch);
        return;
      }
      const body = await res.json();
      update(key, {
        [part]: body[part] ?? [],
        ready: { [part]: true } as Record<Part, boolean>,
        ...(part === 'sessions' ? { error: null } : {}),
      });
    } catch {
      failed = true;
      update(key, {
        ready: { [part]: true } as Record<Part, boolean>,
        ...(part === 'sessions' ? { error: networkErrorMessage(what) } : {}),
      });
    }
  };

  const job = (async () => {
    try {
      await Promise.all([
        load('sessions', `/api/sessions?${param}`, 'load your sessions'),
        load('bookings', `/api/bookings?${param}`, 'load your bookings'),
        isTherapist ? load('clients', `/api/clients?therapistId=${profileId}`, 'load your clients') : update(key, { ready: { clients: true } as Record<Part, boolean> }),
        isTherapist ? load('invites', `/api/invites?therapistId=${profileId}`, 'load your invites') : update(key, { ready: { invites: true } as Record<Part, boolean> }),
      ]);
      // A failed fetch must not count as fresh.
      if (!failed) update(key, { at: Date.now() });
      return cache.get(key)!;
    } finally {
      inflight.delete(key);
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
  }, [profile?.id, role]);

  useEffect(() => {
    if (!key) return;
    const cached = cache.get(key);
    setSnap(cached);
    if (!cached || Date.now() - cached.at > FRESH_MS) refresh();
  }, [key, refresh]);

  const ready = snap?.ready ?? NOT_READY;

  return {
    uid,
    role,
    profile,
    sessions: snap?.sessions ?? EMPTY_SESSIONS,
    bookings: snap?.bookings ?? EMPTY_BOOKINGS,
    clients: snap?.clients ?? EMPTY_CLIENTS,
    invites: snap?.invites ?? EMPTY_INVITES,
    /** True until all four parts have arrived once. Prefer `ready`, which
     *  lets a section show as soon as the data it needs is in. */
    loading: !ready.sessions || !ready.bookings || !ready.clients || !ready.invites,
    ready,
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
