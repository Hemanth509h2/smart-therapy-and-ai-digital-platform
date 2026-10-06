'use client'
import { Activity, Gauge, AudioLines, Sparkles, Lock, AlertTriangle } from 'lucide-react'
import type { AIInsight } from '@/lib/rag/types'
import { GLASS } from './roomTheme'
import PanelShell from './PanelShell'
import { moduleName } from '@/lib/modules'

// Live AI insight view — distinct from the AI Notes editor.
//
// No new data plumbing: `insight` is the exact same `sessions/{id}.aiInsight`
// document the page already subscribes to for the AI Copilot, and
// `onLaunchModule` is the same launch handler AIInsightBar used. This component
// only re-skins that data into the card layout.
export default function AIAssistantPanel({
  insight,
  live,
  analyseLoading,
  analyseDisabled,
  onAnalyse,
  onLaunchModule,
  onClose,
}: {
  insight: AIInsight | null
  live: boolean
  analyseLoading: boolean
  analyseDisabled: boolean
  onAnalyse: () => void
  onLaunchModule: (moduleSlug: string) => void
  onClose: () => void
}) {
  // Emotion tags → "Emotional Tone"; steps/summary → the other rows.
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
          onClick={() => onLaunchModule(insight.module)}
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
    <PanelShell title="AI Assistant" onClose={onClose}>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* AI Session Insights card */}
        <div
          style={{
            background: GLASS.fill,
            border: `1px solid ${GLASS.fillBorder}`,
            borderRadius: 14,
            padding: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: GLASS.ink, flex: 1 }}>
              AI Session Insights
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 9px',
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

          <p style={{ fontSize: 11, color: GLASS.inkMuted, lineHeight: 1.55, marginBottom: 12 }}>
            AI is analysing session in real-time and generating insights to support therapy
            progress.
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
              Risk indicator detected — review transcript and consider crisis protocol if
              appropriate.
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

        {/* Narrative summary + suggested steps (existing copilot payload) */}
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

        {/* Analyse trigger — same handler the old AI Copilot toolbar button used */}
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
    </PanelShell>
  )
}
