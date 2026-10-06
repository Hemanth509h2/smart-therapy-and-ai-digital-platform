import { auth } from '@/lib/firebase';

/**
 * Base URL of the standalone backend API. Empty string means same-origin
 * (used when a rewrite/proxy puts the API on the same host).
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

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
    if (!headers.has('Authorization')) {
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }
    return fetch(`${API_URL}${input}`, { ...init, headers });
  }
  return fetch(input, init);
}
