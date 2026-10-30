// Everything the automation API says about "today" or a time of day is Indian
// Standard Time (UTC+05:30, no daylight saving), the same zone the WhatsApp
// booking messages already use.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const TZ = 'Asia/Kolkata'

/** YYYY-MM-DD of `now` in IST. */
export function istDateString(now = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  // Impossible dates are an Invalid Date; ones like 2026-02-31 roll over, so also require a round trip.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** [start, end) as UTC instants covering the IST days from `from` to `to`, both inclusive. */
export function istRange(from: string, to: string = from): { start: Date; end: Date } {
  const [y, m, d] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS)
  const end = new Date(Date.UTC(y2, m2 - 1, d2) - IST_OFFSET_MS + DAY_MS)
  return { start, end }
}

export function daysBetween(from: string, to: string): number {
  return Math.round((istRange(to).start.getTime() - istRange(from).start.getTime()) / DAY_MS) + 1
}

export const addDays = (date: string, n: number): string =>
  istDateString(new Date(istRange(date).start.getTime() + n * DAY_MS + 60_000))

export const timeLabel = (d: Date): string =>
  d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: TZ })

export const dateLabel = (date: string): string =>
  istRange(date).start.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })

export const dateTimeLabel = (d: Date): string =>
  d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ })
