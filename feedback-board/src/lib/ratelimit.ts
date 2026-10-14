// In-memory counters (the design uses Redis; swap this module for Redis in a multi-instance deploy).
// Keys are salted IP hashes; no content is held.
const g = globalThis as unknown as { __rl?: Map<string, { n: number; reset: number }> };
const store = (g.__rl ??= new Map());

export function hit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (store.size > 50_000) for (const [k, v] of store) if (v.reset < now) store.delete(k);
  const cur = store.get(key);
  if (!cur || cur.reset < now) {
    store.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  cur.n += 1;
  return cur.n <= max;
}
