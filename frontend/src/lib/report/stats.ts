// Session statistics derived from the same inputs the narrative report uses.
//
// WHY THESE ARE COMPUTED AND STORED AT GENERATION TIME
// Transcripts are deleted 24 hours after the session (see
// src/app/api/cleanup-transcripts/route.ts). Anything derived from the
// transcript therefore has to be calculated while it still exists and saved
// alongside the report — computing on read would silently return zeros for
// every session older than a day.
//
// Every figure here is measured from real session data. Nothing is estimated or
// inferred: if the transcript was never captured (consent declined, or STT off)
// the transcript block is marked `captured: false` and the UI says so rather
// than drawing an empty chart.

import { moduleName } from '@/lib/modules'
import type { ReportInputs } from './session-data'

export interface TalkStats {
  captured: boolean
  totalLines: number
  therapistLines: number
  clientLines: number
  therapistWords: number
  clientWords: number
  /** Client share of total words spoken, 0-100. null when nothing was captured. */
  clientSharePct: number | null
}

export interface TimelineBucket {
  minute: number
  therapistWords: number
  clientWords: number
}

export interface ActivityStat {
  module: string
  name: string
  count: number
}

export interface ReportStats {
  version: 1
  computedAt: string
  /** Session length in minutes inferred from transcript timing; null if unknown. */
  durationMinutes: number | null
  talk: TalkStats
  /** Words per minute of session time, per speaker. Empty when no transcript. */
  timeline: TimelineBucket[]
  activities: ActivityStat[]
  activityTotal: number
  noteCount: number
}

function countWords(s: string): number {
  const t = (s ?? '').trim()
  if (!t) return 0
  return t.split(/\s+/).length
}

/**
 * Collapse the timeline to at most `maxBuckets` columns so a 50-minute session
 * still renders legibly. Buckets stay whole minutes wide where possible.
 */
function compress(buckets: TimelineBucket[], maxBuckets = 20): TimelineBucket[] {
  if (buckets.length <= maxBuckets) return buckets
  const factor = Math.ceil(buckets.length / maxBuckets)
  const out: TimelineBucket[] = []
  for (let i = 0; i < buckets.length; i += factor) {
    const slice = buckets.slice(i, i + factor)
    out.push({
      minute: slice[0].minute,
      therapistWords: slice.reduce((a, b) => a + b.therapistWords, 0),
      clientWords: slice.reduce((a, b) => a + b.clientWords, 0),
    })
  }
  return out
}

export function computeReportStats(inputs: ReportInputs): ReportStats {
  const { transcript, moduleEvents, therapistNotes } = inputs

  let therapistLines = 0
  let clientLines = 0
  let therapistWords = 0
  let clientWords = 0

  // minute -> words, built sparse then filled so quiet minutes show as gaps.
  const byMinute = new Map<number, { t: number; c: number }>()
  let maxMinute = 0

  for (const line of transcript) {
    const words = countWords(line.text)
    // `speaker` is 'therapist' | 'client' | 'unknown'; unknown counts toward
    // totals but is not attributed to either side.
    const isTherapist = line.speaker === 'therapist'
    const isClient = line.speaker === 'client'
    if (isTherapist) {
      therapistLines++
      therapistWords += words
    } else if (isClient) {
      clientLines++
      clientWords += words
    }

    const minute = Math.max(0, Math.floor(line.sessionMinute ?? 0))
    if (minute > maxMinute) maxMinute = minute
    const slot = byMinute.get(minute) ?? { t: 0, c: 0 }
    if (isTherapist) slot.t += words
    else if (isClient) slot.c += words
    byMinute.set(minute, slot)
  }

  const captured = transcript.length > 0
  const spokenWords = therapistWords + clientWords

  const timeline: TimelineBucket[] = []
  if (captured) {
    for (let m = 0; m <= maxMinute; m++) {
      const slot = byMinute.get(m) ?? { t: 0, c: 0 }
      timeline.push({ minute: m, therapistWords: slot.t, clientWords: slot.c })
    }
  }

  // Activity counts per module, most used first.
  const activityMap = new Map<string, number>()
  for (const e of moduleEvents) {
    const key = e.module || 'unknown'
    activityMap.set(key, (activityMap.get(key) ?? 0) + 1)
  }
  // Array.from rather than spread: the project's TS target predates
  // downlevelIteration, so spreading a Map iterator does not compile.
  const activities: ActivityStat[] = Array.from(activityMap, ([module, count]) => ({
    module,
    name: moduleName(module),
    count,
  })).sort((a, b) => b.count - a.count)

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    // maxMinute is the last minute that had speech, so +1 gives elapsed minutes.
    durationMinutes: captured ? maxMinute + 1 : null,
    talk: {
      captured,
      totalLines: transcript.length,
      therapistLines,
      clientLines,
      therapistWords,
      clientWords,
      clientSharePct: spokenWords > 0 ? Math.round((clientWords / spokenWords) * 100) : null,
    },
    timeline: compress(timeline),
    activities,
    activityTotal: moduleEvents.length,
    noteCount: therapistNotes.length,
  }
}
