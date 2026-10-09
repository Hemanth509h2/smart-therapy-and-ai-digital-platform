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
// Video feeds are NOT drawn here: the session page shows them in its movable
// participants popup, so the module gets the full canvas.

import type { ReactNode } from 'react'
import { X, Lock, Unlock, PhoneOff } from 'lucide-react'
import { RC } from './roomTheme'
import { MODULE_CATEGORIES } from '@/lib/modules'

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
  /** No longer rendered (feeds moved to the page's participants popup); kept so callers don't break. */
  selfName?: string
  otherName?: string
  timerStr: string
  onlineCount: number
  isTherapist: boolean
  isLocked: boolean
  onLockToggle: () => void
  onClose: () => void
  /** End the whole session from inside the module view. */
  onEndCall?: () => void
  /** The module tree itself — the same <ModuleContent/> the sidebar panel uses. */
  children: ReactNode
}

export default function ModuleStage({
  activeModule,
  timerStr,
  onlineCount,
  isTherapist,
  isLocked,
  onLockToggle,
  onClose,
  onEndCall,
  children,
}: ModuleStageProps) {
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
        overflowY: 'auto',
        overflowX: 'hidden',
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
      {/* ---- Header: module identity (left) · controls (right). The module's
          own title lives here, so modules render only their activity body.
          Video feeds live in the page's movable participants popup. ---- */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '9px 14px 7px',
          borderBottom: `1px solid ${RC.border}`,
        }}
      >
        {/* LEFT: title, then the live status line */}
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

        {/* RIGHT: controls */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7, flexShrink: 0 }}>
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
            {onEndCall && (
              <button onClick={onEndCall} title="End call" style={{ ...headerBtn, padding: 6, color: '#e05252', borderColor: 'rgba(224,82,82,0.4)' }}>
                <PhoneOff size={14} />
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
