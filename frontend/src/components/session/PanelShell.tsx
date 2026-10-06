'use client'
import { useState, type ReactNode } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { GLASS, glassSurface } from './roomTheme'

// Shared chrome for every swappable sidebar panel (AI Assistant, AI Notes,
// Whiteboard, Therapy Modules). Gives each panel the same dark-glass surface,
// the same header row (title + subtitle + collapse chevron + close X) and the
// same scrollable body, so switching between them never shifts the layout.
export default function PanelShell({
  title,
  subtitle,
  onClose,
  headerExtra,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  /** Optional controls rendered between the title and the chevron/X pair. */
  headerExtra?: ReactNode
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)

  const iconBtn = {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: `1px solid ${GLASS.border}`,
    background: 'transparent',
    color: GLASS.inkMuted,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  } as const

  return (
    <div style={{ ...glassSurface(), width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`
        .panel-scroll::-webkit-scrollbar { width: 4px; }
        .panel-scroll::-webkit-scrollbar-track { background: transparent; }
        .panel-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
      `}</style>

      {/* Header row */}
      <div
        style={{
          minHeight: 56,
          padding: '10px 14px',
          borderBottom: `1px solid ${GLASS.border}`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17.5, fontWeight: 500, color: GLASS.ink }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 14, color: GLASS.inkMuted, marginTop: 1 }}>{subtitle}</div>
          )}
        </div>
        {headerExtra}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={iconBtn}
        >
          {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
        <button onClick={onClose} title="Close panel" style={iconBtn}>
          <X size={13} />
        </button>
      </div>

      {/* Body */}
      {!collapsed && (
        <div
          className="panel-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.12) transparent',
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
