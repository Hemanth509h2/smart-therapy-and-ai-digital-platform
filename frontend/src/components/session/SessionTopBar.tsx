'use client'
import { useState } from 'react'
import Image from 'next/image'
import { ShieldCheck, Clock, ChevronDown, ChevronUp, Users, Maximize2, Minimize2 } from 'lucide-react'
import { RC } from './roomTheme'

interface TimerActionButtonProps {
  onClick: () => void
  title: string
  active?: boolean
  icon: React.ReactNode
  label?: string
}

function TimerActionButton({ onClick, title, active, icon, label }: TimerActionButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '0 10px',
        height: 32,
        borderRadius: 8,
        border: `1px solid ${active ? RC.green : RC.border}`,
        background: active ? RC.greenSoft : RC.tile,
        color: active ? RC.greenDark : RC.ink,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.12s ease',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = RC.tileActive
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = RC.tile
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>
      {label && <span style={{ whiteSpace: 'nowrap' }}>{label}</span>}
    </button>
  )
}

export default function SessionTopBar({
  timerStr,
  sessionType = 'Individual Therapy',
  startedAt,
  sessionId,
  onlineCount,
  transcriptLine,
  // Handlers for timer actions
  onToggleParticipants,
  showParticipants,
  onToggleFullscreen,
  isFullscreen,
  isTherapist,
  participantsPopupAvailable,
  participantsCount,
}: {
  timerStr: string
  sessionType?: string
  startedAt: number
  sessionId: string
  onlineCount: number
  transcriptLine?: React.ReactNode
  onToggleParticipants?: () => void
  showParticipants?: boolean
  onToggleFullscreen?: () => void
  isFullscreen?: boolean
  isTherapist?: boolean
  participantsPopupAvailable?: boolean
  participantsCount?: number
}) {
  const [infoOpen, setInfoOpen] = useState(false)

  const started = new Date(startedAt)
  const dateLabel = started.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const timeLabel = started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  const microLabel: React.CSSProperties = {
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: RC.inkMuted,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  }

  const count = participantsCount ?? onlineCount

  return (
    <div style={{ flexShrink: 0, position: 'relative' }}>
      <div
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 16px',
          borderRadius: 14,
          background: RC.panel,
          border: `1px solid ${RC.border}`,
          boxShadow: '0 2px 12px rgba(20,30,40,0.04), 0 0 0 1px rgba(0,0,0,0.02) inset',
        }}
      >
        {/* Logo */}
        <div style={{ flexShrink: 0 }}>
          <Image src="/assests/staad-logo-horizontal.svg" alt="STAAD" width={88} height={22} priority />
        </div>

        {/* Security badge - compact */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 10px',
              borderRadius: 16,
              background: RC.greenSoft,
              border: `1px solid ${RC.green}`,
              color: RC.greenDark,
              fontSize: 12.5,
              fontWeight: 600,
            }}
            title="End-to-end encrypted"
          >
            <ShieldCheck size={12} />
            <span style={{ whiteSpace: 'nowrap' }}>Encrypted</span>
          </div>
        </div>

        {/* Center: transcript line or spacer */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {transcriptLine}
        </div>

        {/* Right cluster: Timer + Actions + Session Info */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14 }}>

          {/* Session Timer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
              <div style={{ ...microLabel, justifyContent: 'flex-end' }}>
                <Clock size={9.5} />
                Timer
              </div>
              <div
                style={{
                  fontSize: 18.5,
                  fontWeight: 700,
                  color: RC.ink,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: -0.2,
                }}
              >
                {timerStr}
              </div>
            </div>

            {/* Divider */}
            <div style={{ width: 1, height: 26, background: RC.border, flexShrink: 0 }} />

            {/* Timer Actions (Participants + Fullscreen) */}
            {participantsPopupAvailable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {isTherapist && onToggleParticipants && (
                  <TimerActionButton
                    onClick={onToggleParticipants}
                    title={showParticipants ? 'Hide participants' : 'Show participants'}
                    active={showParticipants}
                    icon={<Users size={14} />}
                    label={String(count)}
                  />
                )}
                {!isTherapist && onToggleParticipants && (
                  <TimerActionButton
                    onClick={onToggleParticipants}
                    title={showParticipants ? 'Hide participants' : 'Show participants'}
                    active={showParticipants}
                    icon={<Users size={14} />}
                    label={String(count)}
                  />
                )}
                {onToggleFullscreen && (
                  <TimerActionButton
                    onClick={onToggleFullscreen}
                    title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                    icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  />
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 26, background: RC.border, flexShrink: 0 }} />

          {/* Session Info — clickable dropdown */}
          <button
            onClick={() => setInfoOpen((o) => !o)}
            title={infoOpen ? 'Hide session info' : 'Show session info'}
            style={{
              padding: '6px 12px',
              borderRadius: 10,
              border: `1px solid ${RC.border}`,
              background: infoOpen ? RC.tileActive : 'transparent',
              color: RC.ink,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { if (!infoOpen) e.currentTarget.style.background = RC.tile }}
            onMouseLeave={(e) => { if (!infoOpen) e.currentTarget.style.background = 'transparent' }}
          >
            <div style={{ textAlign: 'right', minWidth: 0 }}>
              <div style={{ ...microLabel, justifyContent: 'flex-end', fontSize: 11 }}>Session</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: RC.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
                {dateLabel} · {timeLabel}
              </div>
              <div style={{ fontSize: 11.5, color: RC.inkMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
                {sessionType}
              </div>
            </div>
            {infoOpen ? <ChevronUp size={13} style={{ color: RC.greenDark }} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Expanded info dropdown */}
      {infoOpen && (
        <div
          style={{
            position: 'absolute',
            top: 58,
            right: 0,
            zIndex: 60,
            width: 300,
            padding: '10px 12px',
            borderRadius: 12,
            background: RC.panel,
            border: `1px solid ${RC.border}`,
            boxShadow: '0 16px 40px rgba(20,30,40,0.16), 0 0 0 1px rgba(0,0,0,0.04)',
            animation: 'fadeInDown 0.12s ease-out',
          }}
        >
          {[
            ['Session type', sessionType],
            ['Started', `${dateLabel} · ${timeLabel}`],
            ['Elapsed', timerStr],
            ['Participants online', String(onlineCount)],
            ['Session ID', sessionId],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 4px' }}>
              <span style={{ fontSize: 12.5, color: RC.inkMuted, fontWeight: 500 }}>{k}</span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: RC.ink,
                  maxWidth: 180,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textAlign: 'right',
                }}
                title={v}
              >
                {v}
              </span>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}