/**
 * Base URL of the standalone backend API. Empty string means same-origin
 * (used when a rewrite/proxy puts the API on the same host).
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Drop-in replacement for `fetch` for calls to the backend's `/api/*`
 * routes. Prepends NEXT_PUBLIC_API_URL so the frontend and backend can run
 * on different origins.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof input === 'string' && input.startsWith('/')) {
    return fetch(`${API_URL}${input}`, init);
  }
  return fetch(input, init);
}
