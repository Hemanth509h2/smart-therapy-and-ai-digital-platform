'use client'

// Wide session-room canvas for an ACTIVE therapy module.
//
// This is the second of the two intentional module layouts:
//   - SkillDevLayout — the 4 Skill Development modules. Full-screen, chrome-free,
//     deliberately immersive. Not touched by this component, and not legacy.
//   - ModuleStage (here) — the other 21 modules. They are tools used *during* a
//     therapy conversation, so the room keeps its top bar, bottom bar and
//     sidebar panels while the module takes the wide canvas.
//
// Video handling reuses the pattern proven by WhiteboardStage: both feeds shrink
// to small labelled tiles at the top, and LiveKit is only read — no connection or
// track logic is touched, exactly as before.

import type { ReactNode } from 'react'
import { useTracks, VideoTrack } from '@livekit/components-react'
import type { TrackReference } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { X, Lock, Unlock } from 'lucide-react'
import { RC } from './roomTheme'
import { MODULE_CATEGORIES } from '@/lib/modules'

function VideoTile({
  trackRef,
  name,
  width = 232,
  height = 138,
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
          // `relative` anchors the per-tile online dot below; the tile is
          // otherwise unchanged.
          position: 'relative',
          overflow: 'hidden',
          background: '#1a2a25',
          border: `2px solid ${RC.green}`,
          boxShadow: '0 6px 18px rgba(20,40,30,0.18)',
        }}
      >
        {/* Per-tile online indicator, distinct from the shared "N online" pill
            in the header row. White ring so it stays legible over both a live
            video feed and the dark placeholder. */}
        <span
          style={{
            position: 'absolute',
            bottom: 6,
            right: 6,
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: RC.green,
            border: '1.5px solid rgba(255,255,255,0.9)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            zIndex: 2,
          }}
        />
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
              color: 'rgba(255,255,255,0.85)',
              fontSize: Math.round(height * 0.28),
              fontWeight: 600,
            }}
          >
            {name?.charAt(0)?.toUpperCase() || '?'}
          </div>
        )}
      </div>
      <div style={{ marginTop: 5, textAlign: 'center', fontSize: 18.5, fontWeight: 600, color: RC.inkMuted }}>
        {name}
      </div>
    </div>
  )
}

/** Floor for the activity canvas; below this the stage scrolls instead of squeezing.
    Kept low enough that the whole stage — video row, header, canvas and the
    session room's own bars — fits a laptop viewport at 100% zoom. The canvas
    still grows to fill a taller window; this is only the point at which it stops
    shrinking.

    Raised from 360 alongside the larger camera tiles and type: the activity
    body now needs more room before it starts clipping its own controls. */
const MODULE_MIN_HEIGHT = 450

/** Registry lookup: the module's display identity and its category tint. */
function moduleIdentity(moduleId: string | null) {
  for (const cat of MODULE_CATEGORIES) {
    const found = cat.modules.find((m) => m.id === moduleId)
    if (found) {
      return {
        name: found.name,
        emoji: found.emoji,
        desc: found.desc,
        catName: cat.name,
        iconBg: cat.iconBg,
        iconBorder: cat.iconBorder,
        accent: cat.accent,
      }
    }
  }
  return null
}

export interface ModuleStageProps {
  activeModule: string | null
  selfName: string
  otherName: string
  timerStr: string
  onlineCount: number
  isTherapist: boolean
  isLocked: boolean
  onLockToggle: () => void
  onClose: () => void
  /** The module tree itself — the same <ModuleContent/> the sidebar panel uses. */
  children: ReactNode
}

export default function ModuleStage({
  activeModule,
  selfName,
  otherName,
  timerStr,
  onlineCount,
  isTherapist,
  isLocked,
  onLockToggle,
  onClose,
  children,
}: ModuleStageProps) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }], { onlySubscribed: false })
  const selfTrack = tracks.find((t) => t.participant.isLocal) as TrackReference | undefined
  const otherTrack = tracks.find(
    (t) => !t.participant.isLocal && t.publication?.isSubscribed
  ) as TrackReference | undefined

  const id = moduleIdentity(activeModule)

  const headerBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    borderRadius: 10,
    border: `1px solid ${RC.border}`,
    background: RC.panel,
    color: RC.ink,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 20,
        overflow: 'hidden',
        // Light canvas. Modules migrated to moduleMode have their internal
        // colours inverted to dark-on-light to match; they no longer appear in
        // the dark sidebar panel, so there is no second context to satisfy.
        //
        // Deliberately no heavy coloured outline here — a thin neutral border
        // and a soft shadow, matching the top/bottom bar chrome, so the canvas
        // reads as part of the page rather than a boxed-in card.
        background: '#ffffff',
        border: `1px solid ${RC.border}`,
        boxShadow: '0 6px 18px rgba(20,30,40,0.05)',
        display: 'flex',
        flexDirection: 'column',
        // Light-theme overrides for the shared design tokens. Nine modules style
        // controls with `var(--ink-muted)` / `var(--glass-border)`, which are
        // defined globally as translucent WHITE for the dark sidebar panel — on
        // this white canvas those controls rendered invisible (white on white).
        // Scoping the overrides here fixes every one of them at once and leaves
        // the global dark values untouched everywhere else.
        ['--ink-muted' as string]: '#6b7280',
        ['--ink-faint' as string]: '#8b9096',
        ['--glass-border' as string]: 'rgba(0,0,0,0.10)',
      } as React.CSSProperties}
    >
      {/* ---- Header: self video (left) · module identity (centre) · other
          participant + controls (right). The module's own title lives here,
          so modules render only their activity body. ---- */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          padding: '9px 14px 7px',
          borderBottom: `1px solid ${RC.border}`,
        }}
      >
        {/* LEFT: self */}
        <VideoTile trackRef={selfTrack} name={selfName} width={232} height={138} />

        {/* CENTRE: title, then the live status line */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24.5,
                background: id?.iconBg ?? RC.tile,
                border: `1px solid ${id?.iconBorder ?? RC.border}`,
              }}
            >
              {id?.emoji ?? '🎯'}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 29,
                  fontWeight: 800,
                  letterSpacing: -0.4,
                  lineHeight: 1.15,
                  color: id?.accent ?? RC.ink,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {id?.name ?? 'Activity'}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  color: RC.inkMuted,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {id ? `${id.catName} · ${id.desc}` : ''}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: RC.red, display: 'inline-block' }} />
            <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: RC.ink, fontFamily: 'monospace' }}>
              {timerStr}
            </span>
            <span style={{ width: 1, height: 11, background: RC.border, display: 'inline-block' }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 600, color: RC.greenDark }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: RC.green, display: 'inline-block' }} />
              {onlineCount} online
            </span>
          </div>
        </div>

        {/* RIGHT: other participant */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7, flexShrink: 0 }}>
          <VideoTile trackRef={otherTrack} name={otherName} width={232} height={138} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {isTherapist && (
              <button
                onClick={onLockToggle}
                title={isLocked ? 'Client interaction locked' : 'Client can interact'}
                style={{
                  ...headerBtn,
                  background: isLocked ? RC.tile : RC.tileActive,
                  color: isLocked ? RC.inkMuted : RC.greenDark,
                  borderColor: isLocked ? RC.border : RC.green,
                }}
              >
                {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
                {isLocked ? 'Locked' : 'Unlocked'}
              </button>
            )}
            {isTherapist && (
              <button onClick={onClose} title="Close activity" style={{ ...headerBtn, padding: 6 }}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---- The module itself, full canvas width ---- */}
      <div
        className="module-stage-body"
        style={{
          flex: 1,
          minHeight: 0,
          // Scrolls rather than compresses. Modules fill their container, so a
          // short window used to squeeze every panel until the layout looked
          // packed. The inner sizer below keeps a comfortable canvas and this
          // scrolls past it instead.
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '10px 16px 12px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Grows to fill a tall window, but never shrinks below a workable
            height — that floor is what stops the packed-in look. */}
        <div style={{ flex: '1 0 auto', minHeight: MODULE_MIN_HEIGHT, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
