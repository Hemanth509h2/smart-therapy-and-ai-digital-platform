// Shared style tokens for the session room chrome.
//
// These values are NOT new — they are the exact palette/glass treatment already
// in use by the session room page (light chrome) and GlassModulePanel (dark
// glass sidebar). They were lifted into one module so the top bar, bottom bar
// and the four swappable sidebar panels all reference the same source instead of
// each re-declaring them.

import type { CSSProperties } from 'react'

/* ===== Room colour palette — unchanged, moved out of the page ===== */
export const RC = {
  pageBg: '#eef1f4',
  panel: '#ffffff',
  green: '#3fae6a',
  greenDark: '#2f9457',
  greenSoft: 'rgba(63,174,106,0.12)',
  greenGlow: 'rgba(63,174,106,0.30)',
  border: '#e7eaef',
  ink: '#2b2f33',
  inkMuted: '#9aa0a6',
  tile: '#f3f5f8',
  tileActive: 'rgba(63,174,106,0.14)',
  red: '#ff5a5f',
  redSoft: 'rgba(255,90,95,0.12)',
  videoBg: '#ffffff',
} as const

/* ===== Dark glass treatment — same values GlassModulePanel already uses ===== */
export const GLASS = {
  bg: 'rgba(28, 28, 28, 0.55)',
  blur: 'blur(20px) saturate(1.4)',
  border: 'rgba(255, 255, 255, 0.14)',
  shadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
  radius: 20,
  ink: '#FFFFFF',
  inkMuted: 'rgba(255,255,255,0.6)',
  inkFaint: 'rgba(255,255,255,0.35)',
  fill: 'rgba(255,255,255,0.06)',
  fillBorder: 'rgba(255,255,255,0.1)',
  accent: '#A8C9BE',
  accentInk: '#1E3530',
} as const

export const glassSurface = (): CSSProperties => ({
  background: GLASS.bg,
  backdropFilter: GLASS.blur,
  WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`,
  borderRadius: GLASS.radius,
  boxShadow: GLASS.shadow,
})

/** The width established by the existing module panel — shared by all 4 panels. */
export const SIDEBAR_WIDTH = 420
