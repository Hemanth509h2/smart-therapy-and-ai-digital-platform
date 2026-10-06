'use client'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTracks, VideoTrack } from '@livekit/components-react'
import type { TrackReference } from '@livekit/components-react'
import { Track } from 'livekit-client'
import {
  Hand, MousePointer2, Type, Square, StickyNote, Maximize2,
  Pen, Highlighter, Shapes, Eraser, Undo2, Redo2, MoreHorizontal,
  Plus, Minus, Users, X, Lock,
} from 'lucide-react'
import { RC } from './roomTheme'

// Whiteboard mode — the LAYOUT SHELL.
//
// This file owns the layout takeover (whiteboard fills the main canvas, both
// video feeds shrink to small side-by-side tiles top-left) plus all the toolbar
// chrome. The chrome itself is unchanged from the layout conversion; what changed
// is that the buttons are no longer no-ops — the shell is now CONTROLLED, and
// StaadWhiteboard drives it against a real Excalidraw canvas passed in as
// `children`. Left uncontrolled (no handlers), it still renders the inert
// placeholder it always did.
//
// LiveKit is read the same way SkillDevLayout/RemoteVideoArea already read it —
// via useTracks() on the surrounding room context. No connection or track logic
// is touched here; only the size and position of the video elements.

function VideoTile({
  trackRef,
  name,
  width = 120,
  height = 82,
}: {
  trackRef: TrackReference | undefined
  name: string
  width?: number
  height?: number
}) {
  return (
    <div style={{ flexShrink: 0 }}>
      <div
        style={{
          width,
          height,
          borderRadius: 12,
          overflow: 'hidden',
          background: '#1a2a25',
          border: `2px solid ${RC.green}`,
          boxShadow: '0 6px 18px rgba(20,40,30,0.18)',
        }}
      >
        {trackRef ? (
          <VideoTrack trackRef={trackRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.75)',
              fontSize: Math.round(height * 0.27),
              fontWeight: 600,
            }}
          >
            {name?.charAt(0)?.toUpperCase() || '?'}
          </div>
        )}
      </div>
      <div style={{ marginTop: 3, textAlign: 'center', fontSize: 9, fontWeight: 600, color: RC.inkMuted }}>
        {name}
      </div>
    </div>
  )
}

export interface WhiteboardStageProps {
  selfName: string
  otherName: string
  onClose: () => void
  /** The drawing surface. Omitted -> the inert dot-grid placeholder. */
  children?: ReactNode
  /** Controlled tool selection. Ids match the button ids below. */
  activeTool?: string
  onToolSelect?: (toolId: string) => void
  activeColor?: string
  onColorSelect?: (color: string) => void
  onUndo?: () => void
  onRedo?: () => void
  /** Confirmed clear — the inline "Clear for everyone?" step is handled here. */
  onClear?: () => void
  /** Zoom percentage to display. */
  zoom?: number
  onZoomIn?: () => void
  onZoomOut?: () => void
  onFullscreen?: () => void
  /** false -> drawing controls are disabled and a read-only notice is shown. */
  canEdit?: boolean
  /** Small status chip next to the top-right controls, e.g. Shared / Private. */
  statusChip?: ReactNode
}

export default function WhiteboardStage({
  selfName,
  otherName,
  onClose,
  children,
  activeTool: activeToolProp,
  onToolSelect,
  activeColor: activeColorProp,
  onColorSelect,
  onUndo,
  onRedo,
  onClear,
  zoom: zoomProp,
  onZoomIn,
  onZoomOut,
  onFullscreen,
  canEdit = true,
  statusChip,
}: WhiteboardStageProps) {
  // Uncontrolled fallbacks keep the shell renderable on its own (and keep the
  // placeholder behaviour intact) while the controlled props drive Excalidraw.
  const [zoomLocal, setZoomLocal] = useState(100)
  const [toolLocal, setToolLocal] = useState('select')
  const [colorLocal, setColorLocal] = useState('#2b2f33')
  const [confirmClear, setConfirmClear] = useState(false)
  const colorInputRef = useRef<HTMLInputElement>(null)

  const zoom = zoomProp ?? zoomLocal
  const activeTool = activeToolProp ?? toolLocal
  const activeColor = activeColorProp ?? colorLocal

  const pickTool = (id: string) => {
    if (!canEdit) return
    if (onToolSelect) onToolSelect(id)
    else setToolLocal(id)
  }
  const pickColor = (c: string) => {
    if (!canEdit) return
    if (onColorSelect) onColorSelect(c)
    else setColorLocal(c)
  }
  const zoomIn = () => (onZoomIn ? onZoomIn() : setZoomLocal((z) => Math.min(400, z + 25)))
  const zoomOut = () => (onZoomOut ? onZoomOut() : setZoomLocal((z) => Math.max(25, z - 25)))

  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }], { onlySubscribed: false })
  const selfTrack = tracks.find((t) => t.participant.isLocal) as TrackReference | undefined
  const otherTrack = tracks.find(
    (t) => !t.participant.isLocal && t.publication?.isSubscribed
  ) as TrackReference | undefined

  const noop = () => {}

  const railBtn = (id: string): React.CSSProperties => ({
    width: 34,
    height: 34,
    borderRadius: 10,
    border: `1px solid ${activeTool === id ? RC.green : RC.border}`,
    background: activeTool === id ? RC.tileActive : RC.panel,
    color: activeTool === id ? RC.greenDark : RC.ink,
    cursor: canEdit ? 'pointer' : 'not-allowed',
    opacity: canEdit ? 1 : 0.45,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  })

  const barBtn = (id?: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 10px',
    borderRadius: 10,
    border: `1px solid ${id && activeTool === id ? RC.green : RC.border}`,
    background: id && activeTool === id ? RC.tileActive : RC.tile,
    color: id && activeTool === id ? RC.greenDark : RC.ink,
    fontSize: 10,
    fontWeight: 600,
    cursor: canEdit ? 'pointer' : 'not-allowed',
    opacity: canEdit ? 1 : 0.45,
    whiteSpace: 'nowrap',
  })

  const topBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    borderRadius: 10,
    border: `1px solid ${RC.border}`,
    background: RC.panel,
    color: RC.ink,
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
  }

  const COLORS = ['#2b2f33', '#2f80ed', '#27ae60', '#9b51e0', '#f2994a']

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 20,
        overflow: 'hidden',
        // Thin neutral border + soft shadow, matching ModuleStage's canvas
        // chrome and the top/bottom bars — no heavy coloured outline.
        background: RC.panel,
        border: `1px solid ${RC.border}`,
        boxShadow: '0 6px 18px rgba(20,30,40,0.05)',
      }}
    >
      {/* Drawing surface. `children` is the real Excalidraw canvas; without it
          the shell falls back to the original inert dot-grid placeholder. */}
      {children ? (
        <div style={{ position: 'absolute', inset: 0 }}>{children}</div>
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `radial-gradient(${RC.border} 1px, transparent 1px)`,
            backgroundSize: '22px 22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 12, color: RC.inkMuted, fontWeight: 600 }}>
            Whiteboard · drawing tools coming soon
          </span>
        </div>
      )}

      {/* Shrunken video feeds — side by side, top-left */}
      <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 30, display: 'flex', gap: 8 }}>
        <VideoTile trackRef={selfTrack} name={selfName} width={140} height={96} />
        <VideoTile trackRef={otherTrack} name={otherName} width={140} height={96} />
      </div>

      {/* Top-right controls */}
      <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 30, display: 'flex', alignItems: 'center', gap: 7 }}>
        {statusChip}

        {/* Clear is destructive and affects both participants, so it takes an
            inline confirm step rather than firing straight away. */}
        {confirmClear ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px', borderRadius: 10, background: RC.redSoft, border: `1px solid ${RC.red}` }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: RC.ink }}>Clear for everyone?</span>
            <button
              onClick={() => { setConfirmClear(false); onClear?.() }}
              style={{ padding: '4px 9px', borderRadius: 8, border: 'none', background: RC.red, color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
            >
              Clear
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              style={{ padding: '4px 8px', borderRadius: 8, border: `1px solid ${RC.border}`, background: RC.panel, color: RC.inkMuted, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => canEdit && setConfirmClear(true)}
            style={{ ...topBtn, cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.45 }}
          >
            Clear Whiteboard
          </button>
        )}

        <button onClick={noop} title="More" style={{ ...topBtn, padding: 6 }}>
          <MoreHorizontal size={14} />
        </button>
        <button onClick={() => onFullscreen?.()} title="Full screen" style={{ ...topBtn, padding: 6 }}>
          <Maximize2 size={14} />
        </button>
        <button onClick={onClose} title="Close whiteboard" style={{ ...topBtn, padding: 6 }}>
          <X size={14} />
        </button>
      </div>

      {/* Left vertical tool rail */}
      <div
        style={{
          position: 'absolute',
          left: 14,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: 7,
          borderRadius: 16,
          background: RC.panel,
          border: `1px solid ${RC.border}`,
          boxShadow: '0 6px 18px rgba(20,30,40,0.08)',
        }}
      >
        {[
          { id: 'pan', icon: <Hand size={15} />, title: 'Pan' },
          { id: 'select', icon: <MousePointer2 size={15} />, title: 'Select' },
          { id: 'text', icon: <Type size={15} />, title: 'Text' },
          { id: 'rect', icon: <Square size={15} />, title: 'Rectangle' },
          { id: 'sticky', icon: <StickyNote size={15} />, title: 'Sticky note' },
          { id: 'expand', icon: <Maximize2 size={15} />, title: 'Fullscreen' },
        ].map((t) => (
          <button
            key={t.id}
            title={t.title}
            /* 'expand' is a view action, not a drawing tool — it must not take
               the active-tool highlight. */
            onClick={() => (t.id === 'expand' ? onFullscreen?.() : pickTool(t.id))}
            style={t.id === 'expand' ? { ...railBtn(t.id), cursor: 'pointer', opacity: 1 } : railBtn(t.id)}
          >
            {t.icon}
          </button>
        ))}
      </div>

      {/* Read-only notice — client while the therapist holds control */}
      {!canEdit && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 12px',
            borderRadius: 20,
            background: RC.panel,
            border: `1px solid ${RC.border}`,
            boxShadow: '0 4px 14px rgba(20,30,40,0.10)',
          }}
        >
          <Lock size={12} color={RC.inkMuted} />
          <span style={{ fontSize: 10, fontWeight: 600, color: RC.inkMuted }}>
            View only — your therapist has control
          </span>
        </div>
      )}

      {/* Bottom toolbar */}
      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: 14,
          right: 14,
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 9px',
            borderRadius: 16,
            background: RC.panel,
            border: `1px solid ${RC.border}`,
            boxShadow: '0 6px 18px rgba(20,30,40,0.08)',
            overflowX: 'auto',
          }}
        >
          <button onClick={() => pickTool('pen')} style={barBtn('pen')}><Pen size={13} /> Pen</button>
          <button onClick={() => pickTool('highlighter')} style={barBtn('highlighter')}><Highlighter size={13} /> Highlighter</button>
          <button onClick={() => pickTool('shapes')} style={barBtn('shapes')}><Shapes size={13} /> Shapes</button>
          <button onClick={() => pickTool('sticky')} style={barBtn('sticky')}><StickyNote size={13} /> Sticky Notes</button>
          <button onClick={() => pickTool('eraser')} style={barBtn('eraser')}><Eraser size={13} /> Eraser</button>
          <span style={{ width: 1, height: 20, background: RC.border, flexShrink: 0 }} />
          <button onClick={() => canEdit && onUndo?.()} title="Undo" style={{ ...barBtn(), padding: 6 }}><Undo2 size={13} /></button>
          <button onClick={() => canEdit && onRedo?.()} title="Redo" style={{ ...barBtn(), padding: 6 }}><Redo2 size={13} /></button>
          <span style={{ width: 1, height: 20, background: RC.border, flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => pickColor(c)}
                title={c}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: c,
                  border: activeColor === c ? `2px solid ${RC.green}` : `1px solid ${RC.border}`,
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
            {/* Excalidraw's own colour popover lives in the native UI chrome we
                hide, so "+" opens a plain colour input instead. */}
            <button
              onClick={() => canEdit && colorInputRef.current?.click()}
              title="More colours"
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: COLORS.includes(activeColor) ? RC.tile : activeColor,
                border: COLORS.includes(activeColor) ? `1px solid ${RC.border}` : `2px solid ${RC.green}`,
                color: RC.ink,
                cursor: canEdit ? 'pointer' : 'not-allowed',
                opacity: canEdit ? 1 : 0.45,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              {COLORS.includes(activeColor) && <Plus size={12} />}
            </button>
            <input
              ref={colorInputRef}
              type="color"
              value={activeColor}
              onChange={(e) => pickColor(e.target.value)}
              style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
              tabIndex={-1}
              aria-hidden
            />
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Zoom control */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 7px',
            borderRadius: 16,
            background: RC.panel,
            border: `1px solid ${RC.border}`,
            boxShadow: '0 6px 18px rgba(20,30,40,0.08)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={zoomOut}
            title="Zoom out"
            style={{ ...barBtn(), padding: 5, border: 'none', background: 'transparent' }}
          >
            <Minus size={13} />
          </button>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: RC.ink,
              minWidth: 34,
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {zoom}%
          </span>
          <button
            onClick={zoomIn}
            title="Zoom in"
            style={{ ...barBtn(), padding: 5, border: 'none', background: 'transparent' }}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ===== SHARE WHITEBOARD CONFIRMATION ===== */
export function ShareWhiteboardModal({
  onKeepPrivate,
  onShare,
}: {
  onKeepPrivate: () => void
  onShare: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: 'min(92vw, 380px)',
          background: RC.panel,
          border: `1px solid ${RC.border}`,
          borderRadius: 20,
          padding: '22px 24px',
          textAlign: 'center',
          boxShadow: '0 20px 50px rgba(20,30,40,0.24)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: RC.ink, marginBottom: 6 }}>
          Share Whiteboard?
        </div>
        <p style={{ fontSize: 12, color: RC.inkMuted, lineHeight: 1.55, marginBottom: 18 }}>
          Would you like the client to collaborate on this whiteboard?
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            onClick={onKeepPrivate}
            style={{
              padding: '9px 18px',
              borderRadius: 10,
              border: `1px solid ${RC.border}`,
              background: 'transparent',
              color: RC.inkMuted,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Keep Private
          </button>
          <button
            onClick={onShare}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 18px',
              borderRadius: 10,
              border: 'none',
              background: RC.green,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: `0 6px 16px ${RC.greenGlow}`,
            }}
          >
            <Users size={14} />
            Share Whiteboard
          </button>
        </div>
      </div>
    </div>
  )
}
