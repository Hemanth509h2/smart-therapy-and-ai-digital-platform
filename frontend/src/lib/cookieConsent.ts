/**
 * Cookie / analytics consent, kept in the visitor's own browser.
 *
 * Strictly necessary storage (Firebase sign-in, theme and layout preferences)
 * needs no consent. Anything optional, today only Vercel Web Analytics, stays
 * off until the visitor chooses "Accept analytics" in <CookieConsent>.
 *
 * Bump CONSENT_VERSION when a new optional tool is added, so everyone is asked
 * again instead of an old "accept" silently covering it.
 */

export const CONSENT_VERSION = 1;
const STORAGE_KEY = 'staad-cookie-consent';

/** Dispatch on window to open the cookie settings again (e.g. a footer link). */
export const COOKIE_SETTINGS_EVENT = 'staad:cookie-settings';
/** Fired on window after the visitor saves a choice. */
export const COOKIE_CHANGE_EVENT = 'staad:cookie-consent-change';

export interface CookieChoice {
  v: number;
  analytics: boolean;
  at: string; // ISO time the choice was made
}

/** The saved choice, or null when the visitor hasn't chosen (or it's outdated). */
export function readCookieChoice(): CookieChoice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookieChoice;
    if (parsed?.v !== CONSENT_VERSION || typeof parsed.analytics !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCookieChoice(analytics: boolean): void {
  const choice: CookieChoice = { v: CONSENT_VERSION, analytics, at: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Storage blocked (private mode, site data off): the choice holds for this
    // page only, and analytics stays off on the next visit.
  }
  window.dispatchEvent(new CustomEvent(COOKIE_CHANGE_EVENT, { detail: choice }));
}

/** True only when the visitor has accepted analytics. */
export function analyticsAllowed(): boolean {
  return readCookieChoice()?.analytics === true;
}

/** Re-open the cookie banner so the visitor can change their choice. */
export function openCookieSettings(): void {
  window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT));
}
