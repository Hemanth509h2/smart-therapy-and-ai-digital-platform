import { auth } from '@/lib/firebase';
import { trackBusy } from '@/lib/buttonBusy';

/**
 * Base URL of the standalone backend API. Empty string means same-origin
 * (used when a rewrite/proxy puts the API on the same host).
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');

/** Fired on window when the backend refuses an action because the therapist has no active plan. */
export const PLAN_REQUIRED_EVENT = 'staad:plan-required';

/** Fired on window when the backend says the profile id a page sent isn't the
 *  signed-in user's (code PROFILE_MISMATCH) — the page is using a stale cached
 *  profile. AuthProvider reloads the profile in response. */
export const PROFILE_MISMATCH_EVENT = 'staad:profile-mismatch';

// The backend answers therapist actions with 402 + code PLAN_REQUIRED when
// there is no active plan, and 403 + PROFILE_MISMATCH when the page sent
// another profile's id. Announce them so the app can react, whichever page
// made the call. Reads a clone so the caller still gets the body.
function announce(res: Response) {
  if (typeof window === 'undefined') return;
  res
    .clone()
    .json()
    .then((body) => {
      if (body?.code === 'PLAN_REQUIRED') {
        window.dispatchEvent(new CustomEvent(PLAN_REQUIRED_EVENT, { detail: body.error }));
      } else if (body?.code === 'PROFILE_MISMATCH') {
        window.dispatchEvent(new CustomEvent(PROFILE_MISMATCH_EVENT));
      }
    })
    .catch(() => {});
}

/**
 * Drop-in replacement for `fetch` for calls to the backend's `/api/*`
 * routes. Prepends NEXT_PUBLIC_API_URL so the frontend and backend can run
 * on different origins.
 *
 * When a user is signed in, their Firebase ID token is attached as
 * `Authorization: Bearer <token>` so the backend can verify the caller.
 * Callers that already set their own Authorization header are left as-is,
 * and non-API URLs pass through untouched.
 *
 * A request started by a button click shows that button as loading until it
 * settles (see lib/buttonBusy.ts).
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  return trackBusy(request(input, init));
}

async function request(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof input === 'string' && input.startsWith('/')) {
    const headers = new Headers(init?.headers);
    // Pages can render from the cached session (AuthProvider) before Firebase
    // has restored the signed-in user; wait for it so the token is attached.
    await auth.authStateReady();
    const user = auth.currentUser;
    if (user) {
      if (!headers.has('Authorization')) {
        // Tolerate token-refresh failures on flaky networks; the backend
        // decides whether a token is required (AUTH_DISABLED bypass) or not.
        const token = await user.getIdToken().catch(() => null);
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        }
      }
      // Only honored by the backend when AUTH_DISABLED=true (local dev);
      // ignored otherwise — identity comes from the verified token.
      headers.set('x-dev-uid', user.uid);
      if (user.email) headers.set('x-dev-email', user.email);
    }
    const method = (init?.method || 'GET').toUpperCase();
    // Any write may change what a cached read returned — drop them all.
    if (method !== 'GET' && method !== 'HEAD') apiCache.clear();
    const res = await fetch(`${API_URL}${input}`, { ...init, headers });
    if (res.status === 402 || res.status === 403) announce(res);
    return res;
  }
  return fetch(input, init);
}

// ---- Cached GETs -----------------------------------------------------------
// Pages that load the same read-only data on every visit (plans, notes, admin
// lists…) use apiFetchCached so moving between pages doesn't re-request it.
// Entries are per signed-in user, expire after `ttlMs`, are shared by
// concurrent callers, and are cleared by any write made through apiFetch.
interface CachedResponse {
  at: number
  status: number
  statusText: string
  body: string
}
const apiCache = new Map<string, CachedResponse>()
const apiInflight = new Map<string, Promise<CachedResponse>>()

export async function apiFetchCached(url: string, ttlMs = 60_000): Promise<Response> {
  const key = `${auth.currentUser?.uid ?? 'anon'}:${url}`
  const hit = apiCache.get(key)
  let entry: CachedResponse
  if (hit && Date.now() - hit.at < ttlMs) {
    entry = hit
  } else {
    let job = apiInflight.get(key)
    if (!job) {
      job = (async () => {
        const res = await apiFetch(url)
        const out = { at: Date.now(), status: res.status, statusText: res.statusText, body: await res.text() }
        if (res.ok) apiCache.set(key, out) // never cache failures
        return out
      })().finally(() => apiInflight.delete(key))
      apiInflight.set(key, job)
    }
    entry = await job
  }
  return new Response(entry.body, { status: entry.status, statusText: entry.statusText })
}

/** Forget cached reads (e.g. on sign-out). */
export const clearApiCache = () => apiCache.clear()
