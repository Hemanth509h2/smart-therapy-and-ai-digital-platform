// Renders session statistics as a self-contained HTML string.
//
// Returns HTML rather than JSX for the same reason reportMarkdownToHtml does:
// the print window is a separate document, so screen and print must share one
// renderer or they drift apart. Charts are hand-drawn inline SVG — no chart
// dependency, nothing to load, and it prints correctly because there is no
// canvas or client-side layout involved.

import type { ReportStats } from '@/lib/report/stats'

const INK = '#2c3a35'
const MUTED = '#5b6b64'
const THERAPIST = '#4a7c6f'
const CLIENT = '#c8853f'
const RULE = '#e0e6e3'

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Stat tile: a single headline number with a caption. */
function tile(value: string, label: string, sub?: string): string {
  return `<div class="sr-tile">
    <div class="sr-tile-v">${esc(value)}</div>
    <div class="sr-tile-l">${esc(label)}</div>
    ${sub ? `<div class="sr-tile-s">${esc(sub)}</div>` : ''}
  </div>`
}

/** Horizontal split bar showing who did the talking. */
function talkBar(therapistPct: number, clientPct: number): string {
  const w = 460
  const tW = Math.round((therapistPct / 100) * w)
  const cW = w - tW
  return `<svg class="sr-svg" viewBox="0 0 ${w} 44" width="100%" height="44" role="img"
      aria-label="Talk balance: therapist ${therapistPct} percent, client ${clientPct} percent">
    <rect x="0" y="8" width="${tW}" height="20" rx="4" fill="${THERAPIST}" />
    <rect x="${tW}" y="8" width="${cW}" height="20" rx="4" fill="${CLIENT}" />
    ${tW > 46 ? `<text x="8" y="22" font-size="11" font-weight="700" fill="#ffffff">${therapistPct}%</text>` : ''}
    ${cW > 46 ? `<text x="${tW + 8}" y="22" font-size="11" font-weight="700" fill="#ffffff">${clientPct}%</text>` : ''}
    <text x="0" y="41" font-size="10" fill="${MUTED}">Therapist</text>
    <text x="${w}" y="41" font-size="10" fill="${MUTED}" text-anchor="end">Client</text>
  </svg>`
}

/** Grouped column chart: words spoken per minute of session time. */
function timelineChart(stats: ReportStats): string {
  const buckets = stats.timeline
  if (buckets.length === 0) return ''
  const w = 460
  const h = 130
  const padB = 18
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.therapistWords, b.clientWords)))
  const slot = w / buckets.length
  const barW = Math.max(2, Math.min(9, slot / 2 - 1))

  const bars = buckets
    .map((b, i) => {
      const x = i * slot + slot / 2
      const tH = Math.round(((h - padB) * b.therapistWords) / max)
      const cH = Math.round(((h - padB) * b.clientWords) / max)
      return (
        `<rect x="${(x - barW - 0.5).toFixed(1)}" y="${h - padB - tH}" width="${barW}" height="${tH}" fill="${THERAPIST}" rx="1.5" />` +
        `<rect x="${(x + 0.5).toFixed(1)}" y="${h - padB - cH}" width="${barW}" height="${cH}" fill="${CLIENT}" rx="1.5" />`
      )
    })
    .join('')

  // Label roughly every fifth column so the axis stays readable.
  const step = Math.max(1, Math.ceil(buckets.length / 6))
  const labels = buckets
    .map((b, i) =>
      i % step === 0
        ? `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${h - 4}" font-size="9" fill="${MUTED}" text-anchor="middle">${b.minute}m</text>`
        : ''
    )
    .join('')

  return `<svg class="sr-svg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img"
      aria-label="Words spoken per minute by therapist and client">
    <line x1="0" y1="${h - padB}" x2="${w}" y2="${h - padB}" stroke="${RULE}" stroke-width="1" />
    ${bars}${labels}
  </svg>`
}

/** Horizontal bars for module activity counts. */
function activityChart(stats: ReportStats): string {
  if (stats.activities.length === 0) return ''
  const rows = stats.activities.slice(0, 6)
  const max = Math.max(...rows.map((r) => r.count))
  return `<div class="sr-actlist">${rows
    .map((r) => {
      const pct = Math.round((r.count / max) * 100)
      return `<div class="sr-actrow">
        <div class="sr-actname">${esc(r.name)}</div>
        <div class="sr-acttrack"><div class="sr-actfill" style="width:${pct}%"></div></div>
        <div class="sr-actcount">${r.count}</div>
      </div>`
    })
    .join('')}</div>`
}

/**
 * Build the statistics section. Returns '' when there is nothing measured at
 * all, so the report simply omits the section rather than showing empty charts.
 */
export function reportStatsToHtml(stats: ReportStats | null | undefined): string {
  if (!stats) return ''
  const { talk, activities, activityTotal, durationMinutes, noteCount } = stats
  const hasAnything = talk.captured || activityTotal > 0 || noteCount > 0
  if (!hasAnything) return ''

  const clientPct = talk.clientSharePct
  const therapistPct = clientPct == null ? null : 100 - clientPct
  // Transcript speakers are assigned by audio track, not diarised: the local mic
  // is the therapist and each remote participant is a client. Zero client words
  // alongside therapist speech therefore means no client audio was ever piped —
  // a solo session. Drawing that as a 100/0 bar reads like a broken chart, so we
  // say what actually happened instead.
  const soloSession = talk.captured && talk.clientWords === 0 && talk.therapistWords > 0

  const tiles = [
    durationMinutes != null ? tile(`${durationMinutes}`, 'Minutes of talk', 'first to last utterance') : '',
    talk.captured ? tile(`${talk.clientWords + talk.therapistWords}`, 'Words spoken', `${talk.totalLines} utterances`) : '',
    !soloSession && clientPct != null
      ? tile(`${clientPct}%`, 'Client share of talk', `${talk.clientWords} client words`)
      : '',
    tile(`${activityTotal}`, 'Activity events', `${activities.length} module${activities.length === 1 ? '' : 's'} used`),
  ]
    .filter(Boolean)
    .join('')

  const talkSection = soloSession
    ? `<h3 class="sr-sh">Talk balance</h3>
       <p class="sr-note sr-warn">Solo session — no client audio was recorded, so talk balance cannot be reported. ${talk.therapistWords} words were captured from the therapist across ${talk.therapistLines} utterances.</p>`
    : clientPct != null && therapistPct != null
      ? `<h3 class="sr-sh">Talk balance</h3>
         ${talkBar(therapistPct, clientPct)}
         <p class="sr-note">Measured by words spoken. Therapist ${talk.therapistWords} words across ${talk.therapistLines} utterances; client ${talk.clientWords} words across ${talk.clientLines}.</p>`
      : ''

  const timelineSection = talk.captured
    ? `<h3 class="sr-sh">Participation over the session</h3>
       ${timelineChart(stats)}
       <p class="sr-note">${soloSession
         ? '<span class="sr-key sr-key-t"></span>Therapist — words per minute of session time.'
         : '<span class="sr-key sr-key-t"></span>Therapist <span class="sr-key sr-key-c"></span>Client — words per minute of session time.'}</p>`
    : ''

  const activitySection =
    activities.length > 0
      ? `<h3 class="sr-sh">Activities used</h3>
         ${activityChart(stats)}
         <p class="sr-note">Logged in-session activity events per module.</p>`
      : ''

  // Stated plainly rather than drawn as an empty chart — transcripts are deleted
  // 24h after the session, and consent may have been declined.
  const noTranscript = !talk.captured
    ? `<p class="sr-note sr-warn">No transcript was captured for this session, so talk-balance and participation figures are unavailable. Activity counts above are unaffected.</p>`
    : ''

  return `<div class="sr-stats">
    <h2>Session at a Glance</h2>
    <div class="sr-tiles">${tiles}</div>
    ${talkSection}
    ${timelineSection}
    ${activitySection}
    ${noTranscript}
  </div>`
}

/** CSS for the statistics block, appended to the shared report stylesheet. */
export const REPORT_STATS_CSS = `
  .staad-report .sr-stats { margin: 0 0 24px; }
  .staad-report .sr-stats h2 {
    font-size: 15px; font-weight: 700; color: ${INK}; margin: 0 0 12px;
    padding-left: 10px; border-left: 3px solid ${THERAPIST};
  }
  .staad-report .sr-sh { font-size: 12px; font-weight: 700; color: #3c4d47; margin: 16px 0 6px; }
  .staad-report .sr-tiles { display: flex; flex-wrap: wrap; gap: 8px; }
  .staad-report .sr-tile {
    flex: 1 1 110px; min-width: 110px; padding: 10px 12px;
    border: 1px solid ${RULE}; border-radius: 10px; background: #f7faf9;
  }
  .staad-report .sr-tile-v { font-size: 20px; font-weight: 700; color: ${THERAPIST}; line-height: 1.1; }
  .staad-report .sr-tile-l { font-size: 11px; font-weight: 600; color: ${INK}; margin-top: 3px; }
  .staad-report .sr-tile-s { font-size: 10px; color: ${MUTED}; margin-top: 1px; }
  .staad-report .sr-svg { display: block; max-width: 100%; }
  .staad-report .sr-note { font-size: 10px; color: ${MUTED}; margin: 4px 0 0; line-height: 1.5; }
  .staad-report .sr-warn { color: #a8632a; }
  .staad-report .sr-key {
    display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin: 0 4px 0 0;
  }
  .staad-report .sr-key-t { background: ${THERAPIST}; }
  .staad-report .sr-key-c { background: ${CLIENT}; margin-left: 10px; }
  .staad-report .sr-actlist { display: flex; flex-direction: column; gap: 5px; }
  .staad-report .sr-actrow { display: flex; align-items: center; gap: 8px; }
  .staad-report .sr-actname { flex: 0 0 132px; font-size: 11px; color: ${INK}; }
  .staad-report .sr-acttrack { flex: 1; height: 12px; background: #eef3f1; border-radius: 3px; overflow: hidden; }
  .staad-report .sr-actfill { height: 100%; background: ${THERAPIST}; border-radius: 3px; }
  .staad-report .sr-actcount { flex: 0 0 24px; font-size: 11px; font-weight: 700; color: ${MUTED}; text-align: right; }
  @media print { .staad-report .sr-stats { break-inside: avoid; } }
`
