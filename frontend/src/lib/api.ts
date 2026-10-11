import { auth } from '@/lib/firebase';

/**
 * Base URL of the standalone backend API. Empty string means same-origin
 * (used when a rewrite/proxy puts the API on the same host).
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

/** Fired on window when the backend refuses an action because the therapist has no active plan. */
export const PLAN_REQUIRED_EVENT = 'staad:plan-required';

// The backend answers therapist actions with 402 + code PLAN_REQUIRED when
// there is no active plan. Announce it so the dashboard can say why, whichever
// page made the call. Reads a clone so the caller still gets the body.
function notifyPlanRequired(res: Response) {
  if (typeof window === 'undefined') return;
  res
    .clone()
    .json()
    .then((body) => {
      if (body?.code === 'PLAN_REQUIRED') {
        window.dispatchEvent(new CustomEvent(PLAN_REQUIRED_EVENT, { detail: body.error }));
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
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof input === 'string' && input.startsWith('/')) {
    const headers = new Headers(init?.headers);
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
    const res = await fetch(`${API_URL}${input}`, { ...init, headers });
    if (res.status === 402) notifyPlanRequired(res);
    return res;
  }
  return fetch(input, init);
}
