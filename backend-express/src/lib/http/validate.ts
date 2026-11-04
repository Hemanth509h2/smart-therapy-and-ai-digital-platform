import { PublicError } from '@/lib/http/apiError';

/**
 * Small input checks for request bodies and query strings. Each throws a
 * PublicError (400) with a plain-language message, which errorResponse passes
 * to the client, so a route can validate inline inside its try/catch:
 *
 *   const content = reqStr(req.body.content, 'The note', 20_000);
 *
 * Strings are trimmed. Limits are in characters.
 */

export function reqStr(value: unknown, label: string, max: number): string {
  const s = optStr(value, label, max);
  if (!s) throw new PublicError(`${label} is required.`);
  return s;
}

/** undefined when absent/empty; throws when present but not a string or too long. */
export function optStr(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new PublicError(`${label} must be text.`);
  const s = value.trim();
  if (s.length > max) throw new PublicError(`${label} is too long (at most ${max.toLocaleString('en-IN')} characters).`);
  return s || undefined;
}

/** A list of short strings, e.g. diagnoses or specialties. */
export function strList(value: unknown, label: string, maxItems: number, maxLen: number): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new PublicError(`${label} must be a list.`);
  if (value.length > maxItems) throw new PublicError(`${label} can have at most ${maxItems} items.`);
  return value.map((v) => reqStr(v, `Each item in ${label.toLowerCase()}`, maxLen));
}

/** A value from a fixed set. */
export function oneOf<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new PublicError(`${label} is not valid.`);
  }
  return value as T;
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** A date string that parses; returns the Date. */
export function reqDate(value: unknown, label: string): Date {
  if (!isIsoDate(value)) throw new PublicError(`${label} is not a valid date.`);
  return new Date(value);
}

export function optDate(value: unknown, label: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return reqDate(value, label);
}

/** A finite number within [min, max]. */
export function reqNumber(value: unknown, label: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw new PublicError(`${label} must be a number between ${min} and ${max}.`);
  }
  return n;
}

export function optNumber(value: unknown, label: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return reqNumber(value, label, min, max);
}

/** Basic shape check for an email address (the real check is delivery). */
export function optEmail(value: unknown, label = 'Email'): string | undefined {
  const s = optStr(value, label, 254);
  if (s && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s)) throw new PublicError(`${label} is not a valid email address.`);
  return s;
}
