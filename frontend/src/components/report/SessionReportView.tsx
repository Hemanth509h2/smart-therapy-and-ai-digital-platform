'use client'

import { Printer } from 'lucide-react'
import { reportStatsToHtml, REPORT_STATS_CSS } from './reportStatsHtml'
import type { ReportStats } from '@/lib/report/stats'

// The session report is stored as a small, controlled Markdown subset produced
// by the LLM (see src/lib/report/generate.ts): "## Section" headings, "-" /
// "1." lists, and **bold** inline. We render that to a branded, read-friendly
// document — both on screen and in a print/PDF window — without pulling in a
// heavy markdown or PDF dependency.

const LOGO_PATH = '/assests/staad-logo-horizontal.svg'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Inline formatting: **bold** and *italic* (bold takes precedence).
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
}

// Convert the controlled Markdown subset into HTML. Shared by the on-screen
// view and the print window so they always match.
export function reportMarkdownToHtml(md: string): string {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let para: string[] = []

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null }
  }
  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = [] }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) { flushPara(); closeList(); continue }

    const h3 = /^###\s+(.*)$/.exec(trimmed)
    const h2 = /^##\s+(.*)$/.exec(trimmed)
    const h1 = /^#\s+(.*)$/.exec(trimmed)
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed)

    if (h3 || h2 || h1) {
      flushPara(); closeList()
      const tag = h3 ? 'h3' : h2 ? 'h2' : 'h1'
      const txt = (h3 || h2 || h1)![1]
      out.push(`<${tag}>${inline(txt)}</${tag}>`)
    } else if (bullet) {
      flushPara()
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul' }
      out.push(`<li>${inline(bullet[1])}</li>`)
    } else if (ordered) {
      flushPara()
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol' }
      out.push(`<li>${inline(ordered[1])}</li>`)
    } else {
      closeList()
      para.push(trimmed)
    }
  }
  flushPara(); closeList()
  return out.join('\n')
}

export interface ReportMeta {
  clientName?: string
  dateLabel?: string
  sessionLabel?: string
  statusLabel?: string
}

// Shared CSS for both the on-screen card and the print document. Kept as a
// string so the print window (a separate document) can reuse it verbatim.
const REPORT_CSS = `
  .staad-report { font-family: 'DM Sans', system-ui, sans-serif; color: #1f2a26; }
  .staad-report .sr-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; padding-bottom: 16px; margin-bottom: 20px;
    border-bottom: 2px solid #4a7c6f;
  }
  .staad-report .sr-logo { height: 34px; width: auto; }
  .staad-report .sr-title { font-size: 20px; font-weight: 700; color: #2c3a35; margin: 0; letter-spacing: -0.01em; }
  .staad-report .sr-meta { margin-top: 4px; font-size: 12px; color: #5b6b64; line-height: 1.6; }
  .staad-report .sr-meta strong { color: #2c3a35; font-weight: 600; }
  .staad-report .sr-body { font-size: 14px; line-height: 1.7; }
  .staad-report .sr-body h2 {
    font-size: 15px; font-weight: 700; color: #2c3a35; margin: 22px 0 6px;
    padding-left: 10px; border-left: 3px solid #4a7c6f;
  }
  .staad-report .sr-body h2:first-child { margin-top: 0; }
  .staad-report .sr-body h3 { font-size: 13px; font-weight: 700; color: #3c4d47; margin: 14px 0 4px; }
  .staad-report .sr-body p { margin: 0 0 10px; }
  .staad-report .sr-body ul, .staad-report .sr-body ol { margin: 0 0 12px; padding-left: 20px; }
  .staad-report .sr-body li { margin: 0 0 4px; }
  .staad-report .sr-body strong { color: #2c3a35; font-weight: 650; }
  .staad-report .sr-foot {
    margin-top: 28px; padding-top: 12px; border-top: 1px solid #e0e6e3;
    font-size: 10px; color: #8a978f; text-align: center;
  }
${REPORT_STATS_CSS}
`

interface SessionReportViewProps {
  content: string
  meta?: ReportMeta
  /** Measured session statistics; omitted for older reports generated before
   *  stats existed, in which case the section is simply not rendered. */
  stats?: ReportStats | null
  /** Show the Print / Download PDF button (default true). */
  showPrint?: boolean
  /** Logo origin override for absolute URLs (not normally needed on-screen). */
  className?: string
}

export default function SessionReportView({
  content,
  meta,
  stats,
  showPrint = true,
  className,
}: SessionReportViewProps) {
  const html = reportMarkdownToHtml(content)
  const statsHtml = reportStatsToHtml(stats)

  return (
    <div className={`staad-report ${className ?? ''}`}>
      <style>{REPORT_CSS}</style>

      <div className="sr-head">
        <div>
          <h1 className="sr-title">Session Report</h1>
          <div className="sr-meta">
            {meta?.clientName && <div><strong>Client:</strong> {meta.clientName}</div>}
            {meta?.sessionLabel && <div>{meta.sessionLabel}</div>}
            {meta?.dateLabel && <div>{meta.dateLabel}</div>}
            {meta?.statusLabel && <div>{meta.statusLabel}</div>}
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_PATH} alt="STAAD" className="sr-logo" />
      </div>

      {statsHtml && <div className="sr-body" dangerouslySetInnerHTML={{ __html: statsHtml }} />}
      <div className="sr-body" dangerouslySetInnerHTML={{ __html: html }} />

      {showPrint && (
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => printSessionReport(content, meta, stats)}
            className="btn-press flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white"
            style={{ background: 'var(--sage)', border: 'none' }}
          >
            <Printer className="h-3.5 w-3.5" /> Download / Print PDF
          </button>
        </div>
      )}
    </div>
  )
}

// Opens a clean, branded print window for the report and triggers the browser's
// print dialog (which can "Save as PDF"). Self-contained so it never prints the
// surrounding app chrome.
export function printSessionReport(
  content: string,
  meta?: ReportMeta,
  stats?: ReportStats | null
) {
  if (typeof window === 'undefined') return
  const html = reportMarkdownToHtml(content)
  const statsHtml = reportStatsToHtml(stats)
  const logoUrl = `${window.location.origin}${LOGO_PATH}`
  const metaRows = [
    meta?.clientName ? `<div><strong>Client:</strong> ${escapeHtml(meta.clientName)}</div>` : '',
    meta?.sessionLabel ? `<div>${escapeHtml(meta.sessionLabel)}</div>` : '',
    meta?.dateLabel ? `<div>${escapeHtml(meta.dateLabel)}</div>` : '',
    meta?.statusLabel ? `<div>${escapeHtml(meta.statusLabel)}</div>` : '',
  ].join('')

  const doc = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>STAAD Session Report${meta?.clientName ? ` — ${escapeHtml(meta.clientName)}` : ''}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { margin: 0; }
  ${REPORT_CSS}
  .staad-report { max-width: 720px; margin: 0 auto; padding: 8px; }
  @media print { .staad-report { max-width: none; } }
</style></head>
<body>
  <div class="staad-report">
    <div class="sr-head">
      <div>
        <h1 class="sr-title">Session Report</h1>
        <div class="sr-meta">${metaRows}</div>
      </div>
      <img src="${logoUrl}" alt="STAAD" class="sr-logo" />
    </div>
    ${statsHtml ? `<div class="sr-body">${statsHtml}</div>` : ''}
    <div class="sr-body">${html}</div>
    <div class="sr-foot">Generated by STAAD Therapy · Confidential clinical document</div>
  </div>
  <script>
    window.onload = function () {
      // Give the logo a moment to load before printing.
      setTimeout(function () { window.focus(); window.print(); }, 350);
    };
    window.onafterprint = function () { window.close(); };
  </script>
</body></html>`

  const w = window.open('', '_blank', 'width=820,height=1000')
  if (!w) return
  w.document.open()
  w.document.write(doc)
  w.document.close()
}
