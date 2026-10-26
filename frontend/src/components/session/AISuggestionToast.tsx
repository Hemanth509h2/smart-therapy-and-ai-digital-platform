'use client'

// Toast for a new AI insight (therapist only), shown over the video whenever
// the therapist presses "Analyse". Shows the gist and the first next steps, with the suggested
// module one click away. Risk changes its colour; an urgent risk stays until
// the therapist closes it, anything else fades after AUTO_HIDE_MS (paused while
// the pointer is over it).

import { useEffect, useState } from 'react'
import { AlertTriangle, Play, Sparkles, X } from 'lucide-react'
import type { AIInsight } from '@/lib/rag/types'
import { moduleName } from '@/lib/modules'
import { GLASS } from './roomTheme'

const AUTO_HIDE_MS = 15_000
const STEPS_SHOWN = 2

const TONES = {
  none: { edge: GLASS.border, icon: GLASS.accent, label: 'AI suggestion' },
  watch: { edge: 'rgba(245,176,65,0.75)', icon: '#f5b041', label: 'AI suggestion · watch' },
  urgent: { edge: 'rgba(255,90,95,0.9)', icon: '#ff5a5f', label: 'Risk alert' },
}

export default function AISuggestionToast({
  insight,
  onLaunchModule,
  onOpenDetails,
  onDismiss,
}: {
  insight: AIInsight
  onLaunchModule: (moduleSlug: string) => void
  onOpenDetails: () => void
  onDismiss: () => void
}) {
  const level = insight.riskLevel ?? (insight.riskFlag ? 'watch' : 'none')
  const tone = TONES[level]
  const sticky = level === 'urgent'
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (sticky || hovered) return
    const t = setTimeout(onDismiss, AUTO_HIDE_MS)
    return () => clearTimeout(t)
  }, [sticky, hovered, insight.generatedAt, onDismiss])

  const steps = insight.steps.slice(0, STEPS_SHOWN)
  const button = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 26,
    padding: '0 10px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  } as const

  return (
    <div
      role={sticky ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 60,
        width: 'min(340px, calc(100% - 32px))',
        padding: '12px 14px',
        display: 'grid',
        gap: 8,
        background: GLASS.bg,
        backdropFilter: GLASS.blur,
        WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${tone.edge}`,
        borderRadius: 14,
        boxShadow: GLASS.shadow,
        color: GLASS.ink,
        animation: 'aiToastIn 0.25s ease',
      }}
    >
      <style>{'@keyframes aiToastIn { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }'}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {level === 'none' ? <Sparkles size={14} color={tone.icon} /> : <AlertTriangle size={14} color={tone.icon} />}
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: level === 'none' ? GLASS.ink : tone.icon }}>
          {tone.label}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          style={{ background: 'transparent', border: 'none', color: GLASS.inkMuted, cursor: 'pointer', padding: 2, display: 'flex' }}
        >
          <X size={14} />
        </button>
      </div>

      {level !== 'none' && insight.riskDetail && (
        <div style={{ fontSize: 12, lineHeight: 1.4, color: tone.icon }}>{insight.riskDetail}</div>
      )}

      {insight.summary && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            color: GLASS.inkMuted,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {insight.summary}
        </div>
      )}

      {steps.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 3, fontSize: 12, lineHeight: 1.4 }}>
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {insight.module && (
          <button
            type="button"
            onClick={() => {
              onLaunchModule(insight.module)
              onDismiss()
            }}
            title="Launch this module for the client"
            style={{ ...button, border: `1px solid ${GLASS.accentInk}40`, background: GLASS.accent, color: GLASS.accentInk }}
          >
            <Play size={11} />
            {moduleName(insight.module)}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onOpenDetails()
            onDismiss()
          }}
          style={{ ...button, border: `1px solid ${GLASS.fillBorder}`, background: GLASS.fill, color: GLASS.ink }}
        >
          Details
        </button>
      </div>
    </div>
  )
}
