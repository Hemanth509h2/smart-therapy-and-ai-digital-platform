'use client'

// "On" / "Off" button used instead of a tick box: filled with the accent colour
// when on, outlined grey when off. Exposed to screen readers as a switch.
//   variant="glass"  dark session / module panels (default)
//   variant="page"   regular app pages, follows the light/dark theme variables

import type { CSSProperties } from 'react'

export function OnOffButton({
  on,
  onChange,
  label,
  disabled,
  accent = '#4caf86',
  variant = 'glass',
}: {
  on: boolean
  onChange: (on: boolean) => void
  /** What the button switches, for screen readers (the visible text is only On/Off). */
  label: string
  disabled?: boolean
  accent?: string
  variant?: 'glass' | 'page'
}) {
  const offStyle: CSSProperties =
    variant === 'glass'
      ? { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.6)' }
      : { background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--ink-muted)' }
  const onStyle: CSSProperties = { background: accent, border: `1px solid ${accent}`, color: '#fff' }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        flexShrink: 0,
        minWidth: 42,
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
        ...(on ? onStyle : offStyle),
      }}
    >
      {on ? 'On' : 'Off'}
    </button>
  )
}
