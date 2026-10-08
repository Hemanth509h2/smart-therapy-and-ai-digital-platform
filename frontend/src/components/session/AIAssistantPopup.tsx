'use client'

import { Activity, Gauge, AudioLines, Sparkles, Lock, AlertTriangle, X, GripHorizontal } from 'lucide-react'
import type { AIInsight } from '@/lib/rag/types'
import { GLASS } from './roomTheme'
import { moduleName } from '@/lib/modules'
import { useState, useRef, useEffect } from 'react'

interface AIAssistantPopupProps {
  insight: AIInsight | null
  live: boolean
  analyseLoading: boolean
  analyseDisabled: boolean
  onAnalyse: () => void
  onLaunchModule: (moduleSlug: string) => void
  onClose: () => void
  initialPosition?: { x: number; y: number }
}

export default function AIAssistantPopup({
  insight,
  live,
  analyseLoading,
  analyseDisabled,
  onAnalyse,
  onLaunchModule,
  onClose,
  initialPosition = { x: 400, y: 120 },
}: AIAssistantPopupProps) {
  const [position, setPosition] = useState(initialPosition)
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDragging) return
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      })
    }
    const handleUp = () => setIsDragging(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging])

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    setIsDragging(true)
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    }
  }

  const emotionalTone = insight?.emotions?.length
    ? insight.emotions.join(', ')
    : '—'

  const rows: Array<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = [
    { icon: <Activity size={13} />, label: 'Emotional Tone', value: emotionalTone },
    {
      icon: <Gauge size={13} />,
      label: 'Engagement',
      value: insight ? (insight.riskFlag ? 'Needs attention' : 'High') : '—',
    },
    {
      icon: <AudioLines size={13} />,
      label: 'Speech Pace',
      value: insight
        ? `Moderate · ${insight.transcriptWindowMinutes ?? 0} min window`
        : '—',
    },
    {
      icon: <Sparkles size={13} />,
      label: 'Recommendations',
      value: insight?.module ? (
        <button
          onClick={() => onLaunchModule(insight.module!)}
          style={{
            padding: '3px 10px',
            borderRadius: 12,
            border: `1px solid ${GLASS.accentInk}40`,
            background: GLASS.accent,
            color: GLASS.accentInk,
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {moduleName(insight.module)} →
        </button>
      ) : (
        '—'
      ),
    },
  ]

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 50,
        width: 380,
        minHeight: 200,
        maxHeight: 'calc(100vh - 40px)',
        background: 'rgba(28, 28, 28, 0.95)',
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        border: `1px solid ${GLASS.border}`,
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onMouseDown={handleDragStart}
    >
      {/* Drag Handle / Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: `1px solid ${GLASS.border}`,
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: GLASS.accent }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: GLASS.ink }}>AI Assistant</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 8px',
              borderRadius: 20,
              background: live ? 'rgba(76,175,134,0.18)' : GLASS.fill,
              border: `1px solid ${live ? 'rgba(76,175,134,0.45)' : GLASS.fillBorder}`,
              fontSize: 9,
              fontWeight: 600,
              color: live ? '#4caf86' : GLASS.inkFaint,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: live ? '#4caf86' : GLASS.inkFaint,
                animation: live ? 'pulse 1.4s ease infinite' : 'none',
              }}
            />
            Live
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GripHorizontal size={14} color={GLASS.inkMuted} style={{ cursor: 'grab' }} />
          <button onClick={onClose} title="Close" style={{ background: 'transparent', border: 'none', color: GLASS.inkMuted, cursor: 'pointer', padding: 4, display: 'flex' }}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* AI Session Insights card */}
        <div
          style={{
            background: GLASS.fill,
            border: `1px solid ${GLASS.fillBorder}`,
            borderRadius: 14,
            padding: 14,
          }}
        >
          <p style={{ fontSize: 11, color: GLASS.inkMuted, lineHeight: 1.55, marginBottom: 12 }}>
            AI is analysing session in real-time and generating insights to support therapy progress.
          </p>

          {insight?.riskFlag && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 7,
                background: 'rgba(232,137,122,0.18)',
                border: '1px solid rgba(232,137,122,0.4)',
                borderRadius: 10,
                padding: '8px 10px',
                marginBottom: 10,
                fontSize: 11,
                color: '#E8897A',
                fontWeight: 500,
                lineHeight: 1.45,
              }}
            >
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              Risk indicator detected — review transcript and consider crisis protocol if appropriate.
            </div>
          )}

          {/* Insight rows */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map((r, i) => (
              <div
                key={r.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '9px 0',
                  borderTop: i === 0 ? 'none' : `1px solid ${GLASS.fillBorder}`,
                }}
              >
                <span style={{ color: GLASS.accent, display: 'flex', flexShrink: 0 }}>{r.icon}</span>
                <span style={{ fontSize: 11, color: GLASS.inkMuted, flex: 1 }}>{r.label}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: GLASS.ink,
                    textAlign: 'right',
                    maxWidth: 190,
                  }}
                >
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Narrative summary + suggested steps */}
        {insight && (
          <div
            style={{
              background: GLASS.fill,
              border: `1px solid ${GLASS.fillBorder}`,
              borderRadius: 14,
              padding: 14,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: GLASS.ink, marginBottom: 6 }}>
              Session summary
            </div>
            <p style={{ fontSize: 11, color: GLASS.inkMuted, lineHeight: 1.6, fontStyle: 'italic' }}>
              {insight.summary}
            </p>
            {insight.steps?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {insight.steps.map((step, i) => (
                  <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 5 }}>
                    <span style={{ fontSize: 10, color: GLASS.accent, flexShrink: 0 }}>{i + 1}.</span>
                    <span style={{ fontSize: 11, color: GLASS.inkMuted, lineHeight: 1.5 }}>{step}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Analyse trigger */}
        <button
          onClick={onAnalyse}
          disabled={analyseDisabled}
          title={analyseDisabled ? 'Both parties must consent first' : 'Analyse session now'}
          style={{
            padding: '9px 0',
            borderRadius: 12,
            border: `1px solid ${GLASS.accentInk}40`,
            background: GLASS.accent,
            color: GLASS.accentInk,
            fontSize: 11,
            fontWeight: 600,
            cursor: analyseDisabled ? 'not-allowed' : 'pointer',
            opacity: analyseDisabled ? 0.45 : 1,
          }}
        >
          {analyseLoading ? 'Analysing…' : insight ? 'Refresh insights' : 'Analyse session'}
        </button>

        {/* Footer note */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10,
            color: GLASS.inkFaint,
            justifyContent: 'center',
          }}
        >
          <Lock size={10} />
          AI insights are private and secure
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}