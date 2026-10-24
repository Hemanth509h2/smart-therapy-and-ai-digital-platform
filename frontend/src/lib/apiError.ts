import { toast } from '@/components/practice/ui';

/**
 * Plain-language reasons for failed API calls, shown in toasts.
 *
 * The backend's own `error` text is used whenever it's a real sentence (plan
 * required, validation, suspended account…). Bare HTTP words such as
 * "Forbidden" or "Internal server error" are replaced with an explanation of
 * what went wrong and what to do, naming the action that failed.
 */

// Server messages that only restate the status code; never shown as-is.
const GENERIC = new Set([
  'forbidden',
  'unauthorized',
  'not found',
  'conflict',
  'bad request',
  'internal server error',
  'invalid request body',
  'invalid authentication token',
  'invalid or expired authentication token',
]);

const isTechnical = (msg: string) =>
  GENERIC.has(msg.trim().toLowerCase().replace(/\.$/, '')) ||
  /^(missing authorization|auth_disabled|[a-z]+id (and [a-z]+ )?(is|are) required)/i.test(msg);

function byStatus(status: number, action: string): string {
  if (status === 401) return 'Your sign-in has expired. Please sign in again.';
  if (status === 402) return `You don't have an active plan, so you can't ${action}. Choose a plan on the Plans page to continue.`;
  if (status === 403) return `Your account isn't allowed to ${action}. If you recently switched accounts, refresh the page or sign in again.`;
  if (status === 404) return `We couldn't ${action} because it no longer exists. It may have been deleted.`;
  if (status === 409) return `We couldn't ${action} because it clashes with something that already exists.`;
  if (status === 413) return `We couldn't ${action} because the file or text is too large.`;
  if (status === 429) return 'Too many requests in a short time. Wait a moment and try again.';
  if (status === 503) return "The server can't be reached right now. Please try again in a minute.";
  if (status >= 500) return `Something went wrong on our side while trying to ${action}. Please try again.`;
  return `We couldn't ${action}. Please check the details and try again.`;
}

/**
 * The message to show for a failed response. `action` completes the sentence
 * "you can't …", e.g. "add a client", "load your sessions".
 * Reads a clone, so the caller can still read the body.
 */
export async function apiErrorMessage(res: Response, action: string): Promise<string> {
  const body = await res.clone().json().catch(() => null);
  const msg = typeof body?.error === 'string' ? body.error.trim() : '';
  const base = msg && !isTechnical(msg) ? msg : byStatus(res.status, action);
  // Local dev: append the server's internal detail so failures are diagnosable.
  const detail = process.env.NODE_ENV !== 'production' && typeof body?.detail === 'string' ? body.detail : '';
  return detail ? `${base} (${detail.split('\n')[0].slice(0, 200)})` : base;
}

/** For a thrown fetch (no response at all). */
export const networkErrorMessage = (action: string) =>
  `We couldn't reach the server to ${action}. Check your internet connection and try again.`;

// Firestore/Firebase errors carry a `code` ("permission-denied", "auth/…") and
// a developer-facing message, so they're translated rather than shown.
function firebaseMessage(code: string, action: string): string {
  const c = code.replace(/^(firestore|auth)\//, '');
  if (c === 'permission-denied') return `Your account isn't allowed to ${action}. Try refreshing the page or signing in again.`;
  if (c === 'unauthenticated' || c === 'user-token-expired' || c === 'requires-recent-login')
    return 'Your sign-in has expired. Please sign in again.';
  if (c === 'unavailable' || c === 'deadline-exceeded' || c === 'network-request-failed')
    return `We couldn't reach the server to ${action}. Check your internet connection and try again.`;
  if (c === 'not-found') return `We couldn't ${action} because it no longer exists.`;
  if (c === 'resource-exhausted' || c === 'too-many-requests') return 'Too many requests in a short time. Wait a moment and try again.';
  return `Something went wrong while trying to ${action}. Please try again.`;
}

/** Message for anything caught around an API call (or a Firestore write). */
export function caughtErrorMessage(e: unknown, action: string) {
  if (e instanceof TypeError) return networkErrorMessage(action); // fetch network failure
  const code = (e as { code?: unknown; name?: unknown } | null)?.code;
  if (typeof code === 'string' && ((e as any).name === 'FirebaseError' || /^(auth|firestore)\/|^[a-z]+(-[a-z]+)+$/.test(code)))
    return firebaseMessage(code, action);
  if (e instanceof Error && e.message && !isTechnical(e.message) && !/^firebase:/i.test(e.message)) return e.message;
  return `Something went wrong while trying to ${action}. Please try again.`;
}

/** Shows an error toast for a failed response. */
export async function toastApiError(res: Response, action: string) {
  toast(await apiErrorMessage(res, action), res.status === 402 || res.status === 429 ? 'warning' : 'error');
}

// ─── WhatsApp results ───────────────────────────────────────────────────────

/** Mirrors the backend's WhatsAppOutcome (lib/sessions/session-whatsapp.ts). */
export type WhatsAppOutcome =
  | { status: 'SENT'; to: string }
  | { status: 'FAILED'; to: string; reason: string }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'NOT_CONFIGURED'; reason: string }
  | { status: 'NO_PHONE' }
  | { status: 'ALREADY_SENT'; to: string };

/**
 * Tells the therapist whether the patient was messaged on WhatsApp.
 * `what` is the message, e.g. "the session link" or "the booking confirmation".
 * SENT means WhatsApp accepted it; delivery to the phone isn't tracked.
 */
export function toastWhatsApp(outcome: WhatsAppOutcome | undefined | null, name: string, what: string) {
  if (!outcome) return;
  const who = name || 'the client';
  switch (outcome.status) {
    case 'SENT':
      toast(`${capitalize(what)} was sent to ${who} on WhatsApp (${outcome.to}).`, 'success', { title: 'WhatsApp sent' });
      break;
    case 'ALREADY_SENT':
      toast(`${capitalize(what)} was already sent to ${who} on WhatsApp (${outcome.to}).`, 'info', { title: 'Already sent' });
      break;
    case 'FAILED':
      toast(
        `${capitalize(what)} could not be sent to ${who} on WhatsApp (${outcome.to}) because ${outcome.reason}. Share it with them yourself for now.`,
        'error',
        { title: 'WhatsApp not sent', duration: 10000 }
      );
      break;
    case 'SKIPPED':
      toast(`${capitalize(what)} was not sent to ${who}: ${outcome.reason} Share it with them yourself.`, 'warning', {
        title: 'WhatsApp not sent',
        duration: 9000,
      });
      break;
    case 'NOT_CONFIGURED':
      toast(`${capitalize(what)} was not sent to ${who}. ${outcome.reason} Until then, share it with them yourself.`, 'warning', {
        title: 'WhatsApp not set up',
        duration: 10000,
      });
      break;
    case 'NO_PHONE':
      toast(`${who} has no WhatsApp number on file, so ${what} was not sent. Add their number on the client page, or share it yourself.`, 'warning', {
        title: 'WhatsApp not sent',
        duration: 9000,
      });
      break;
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
