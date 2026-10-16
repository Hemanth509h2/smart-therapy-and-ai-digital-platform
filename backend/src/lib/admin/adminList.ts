// Shared query-string handling for admin list endpoints:
// ?page=1&pageSize=25&q=search&sort=createdAt&dir=desc&from=2026-01-01&to=2026-02-01

export function listParams(request: Request, opts: { sortable: string[]; defaultSort: string }) {
  const sp = new URL(request.url).searchParams;
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize')) || 25));
  const sortParam = sp.get('sort') || '';
  const sort = opts.sortable.includes(sortParam) ? sortParam : opts.defaultSort;
  const dir: 'asc' | 'desc' = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const q = (sp.get('q') || '').trim().slice(0, 100);
  const from = parseDate(sp.get('from'));
  const to = parseDate(sp.get('to'), true);
  return { sp, page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sort, dir, q, from, to };
}

// `endOfDay` makes a bare date (2026-02-01) inclusive of that whole day.
function parseDate(value: string | null, endOfDay = false) {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function dateRange(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
export const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
