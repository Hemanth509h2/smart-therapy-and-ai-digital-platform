'use client'
import { useState } from 'react'
import Image from 'next/image'
import { ShieldCheck, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { RC } from './roomTheme'

// Session room top bar.
//   [ staad logo ] [ End-to-End Encrypted ] ---------- [ Session Timer ] [ Session Info ▾ ]
// The logo is the same brand asset the dashboard already renders
// (/assests/staad-logo-horizontal.svg) — used as-is, unchanged.
//
// Deliberately no "HIPAA Compliant" badge — excluded by design.
export default function SessionTopBar({
  timerStr,
  sessionType = 'Individual Therapy',
  startedAt,
  sessionId,
  onlineCount,
  transcriptLine,
}: {
  timerStr: string
  sessionType?: string
  startedAt: number
  sessionId: string
  onlineCount: number
  /** Optional right-aligned status line (transcription chip) — kept from before. */
  transcriptLine?: React.ReactNode
}) {
  const [infoOpen, setInfoOpen] = useState(false)

  const started = new Date(startedAt)
  const dateLabel = started.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const timeLabel = started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  const microLabel: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: RC.inkMuted,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  }

  return (
    <div style={{ flexShrink: 0, position: 'relative' }}>
      <div
        style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 14px',
          borderRadius: 16,
          background: RC.panel,
          border: `1px solid ${RC.border}`,
          boxShadow: '0 6px 18px rgba(20,30,40,0.05)',
        }}
      >
        {/* Logo — untouched brand asset */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <Image src="/assests/staad-logo-horizontal.svg" alt="STAAD" width={92} height={24} priority />
        </div>

        {/* End-to-End Encrypted badge — same pill treatment as the other room pills */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 11px',
              borderRadius: 20,
              background: RC.greenSoft,
              border: `1px solid ${RC.green}`,
              color: RC.greenDark,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            <ShieldCheck size={13} />
            End-to-End Encrypted
          </div>
          <div style={{ fontSize: 13, color: RC.inkMuted, marginTop: 2, paddingLeft: 2 }}>
            Your session is secure
          </div>
        </div>

        {/* Flexible spacer */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
          {transcriptLine}
        </div>

        {/* Session Timer */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <div style={{ ...microLabel, justifyContent: 'flex-end' }}>
            <Clock size={10} />
            Session Timer
          </div>
          <div
            style={{
              fontSize: 17.5,
              fontWeight: 600,
              color: RC.ink,
              fontFamily: 'monospace',
              fontVariantNumeric: 'tabular-nums',
              marginTop: 1,
            }}
          >
            {timerStr}
          </div>
        </div>

        <div style={{ width: 1, height: 28, background: RC.border, flexShrink: 0 }} />

        {/* Session Info + expand toggle */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ ...microLabel, justifyContent: 'flex-end' }}>Session Info</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: RC.ink, marginTop: 1 }}>
              {dateLabel} · {timeLabel}
            </div>
            <div style={{ fontSize: 13, color: RC.inkMuted }}>{sessionType}</div>
          </div>
          <button
            onClick={() => setInfoOpen((o) => !o)}
            title={infoOpen ? 'Hide session info' : 'Show session info'}
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              border: `1px solid ${RC.border}`,
              background: infoOpen ? RC.tileActive : RC.tile,
              color: infoOpen ? RC.greenDark : RC.ink,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {infoOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded info dropdown */}
      {infoOpen && (
        <div
          style={{
            position: 'absolute',
            top: 62,
            right: 0,
            zIndex: 60,
            width: 280,
            padding: '12px 14px',
            borderRadius: 14,
            background: RC.panel,
            border: `1px solid ${RC.border}`,
            boxShadow: '0 12px 32px rgba(20,30,40,0.14)',
          }}
        >
          {[
            ['Session type', sessionType],
            ['Started', `${dateLabel} · ${timeLabel}`],
            ['Elapsed', timerStr],
            ['Participants online', String(onlineCount)],
            ['Session ID', sessionId],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
              <span style={{ fontSize: 13, color: RC.inkMuted }}>{k}</span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: RC.ink,
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={v}
              >
                {v}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
