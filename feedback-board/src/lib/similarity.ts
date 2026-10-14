// Client-side similar-comment matching (design: trigram Jaccard, threshold 0.45, top 3).
const STOP = new Set(
  "a an the is are was were am be been to of in on at for and or but it its this that i me my we you your with as so do does did have has had just very really".split(" ")
);

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(" ");
}

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

export function similarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

export function findSimilar<T extends { body: string }>(draft: string, items: T[], threshold = 0.45, max = 3): T[] {
  const d = normalise(draft);
  if (!d) return [];
  return items
    .map((it) => ({ it, score: similarity(d, normalise(it.body)) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((r) => r.it);
}
