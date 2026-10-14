// Device-aware adaptive UI — the single source of truth for how the app
// classifies the user's screen, and for the layout decisions that follow from
// that classification.
//
// PURE MODULE: it never touches window/navigator, at import time or at any
// other point, so it is safe from server rendering, from tests, and from build
// tooling (tailwind.config.ts imports BREAKPOINTS from here so the Tailwind
// `md:` / `lg:` media queries and the runtime classification can never drift
// apart).
//
// Layering — deliberately kept apart from the vision pipeline:
//
//   DeviceProfile          (here: what screen do we have?)
//        ↓
//   deriveSessionLayout    (here: which layout constraints follow?)
//        ↓
//   video rendering        (RemoteVideoArea: cover vs contain, sizing)
//        ↓
//   face detection         (useAttentionScoring — untouched by this system)
//
// Device detection never feeds attention/face detection. They answer different
// questions — "how much room is there" versus "is the client looking at the
// camera" — and the two must stay independent.

/** Viewport thresholds, in CSS pixels. The ONE place these numbers live. */
export const BREAKPOINTS = {
  /** Widest "mobile" viewport. Tablet starts at `mobileMax + 1` (Tailwind `md`). */
  mobileMax: 767,
  /** Narrowest "desktop/laptop" viewport (Tailwind `lg`). */
  desktopMin: 1024,
  /**
   * Maximum short dimension (min(width, height)) of a phone.
   * Covers all current phones in both portrait and landscape:
   * iPhone SE (375), 12/13/14 (390), 12/13/14 Pro Max (428), XR/11 (414),
   * Galaxy S23 (360), S23 Ultra (384), etc.
   * Used to identify "phone-like" viewports regardless of orientation.
   */
  mobileMaxShortDimension: 430,
} as const

export type DeviceType = 'mobile' | 'tablet' | 'desktop'
export type DeviceOrientation = 'portrait' | 'landscape'

/** Everything the adaptive UI knows about the current screen/device. */
export interface DeviceProfile {
  /** Primary classification, driven purely by available viewport width. */
  type: DeviceType
  width: number
  height: number
  /** width / height, rounded to 4dp so float noise cannot trigger re-renders. */
  aspectRatio: number
  orientation: DeviceOrientation
  /** navigator.maxTouchPoints > 0 or a coarse pointer — NOT the user-agent. */
  isTouchDevice: boolean
  /** Whether the primary input mechanism can hover (media query `(hover: hover)`). */
  hasHover: boolean
}

export interface DeviceViewport {
  width: number
  height: number
}

export interface DeviceCapabilities {
  isTouchDevice: boolean
  hasHover: boolean
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Mobile < 768 ≤ Tablet < 1024 ≤ Desktop. Width-only, per the design spec. */
export function classifyViewport(width: number): DeviceType {
  if (width <= BREAKPOINTS.mobileMax) return 'mobile'
  if (width < BREAKPOINTS.desktopMin) return 'tablet'
  return 'desktop'
}

export function orientationOf(viewport: DeviceViewport): DeviceOrientation {
  return viewport.width >= viewport.height ? 'landscape' : 'portrait'
}

/** Turns raw window/navigator readings into a comparable DeviceProfile. */
export function buildDeviceProfile(
  viewport: DeviceViewport,
  capabilities: DeviceCapabilities,
  type: DeviceType
): DeviceProfile {
  // Round so browser zoom / fractional DPR sizes cannot churn the store.
  const width = Math.max(1, Math.round(viewport.width))
  const height = Math.max(1, Math.round(viewport.height))
  return {
    type,
    width,
    height,
    aspectRatio: round4(width / height),
    orientation: width >= height ? 'landscape' : 'portrait',
    isTouchDevice: capabilities.isTouchDevice,
    hasHover: capabilities.hasHover,
  }
}

/** Every field matters — a partial change must produce a new object. */
export function profilesEqual(a: DeviceProfile, b: DeviceProfile): boolean {
  return (
    a.type === b.type &&
    a.width === b.width &&
    a.height === b.height &&
    a.aspectRatio === b.aspectRatio &&
    a.orientation === b.orientation &&
    a.isTouchDevice === b.isTouchDevice &&
    a.hasHover === b.hasHover
  )
}

/**
 * Snapshot used for server rendering AND for the hydration pass, so the markup
 * React produces on the server matches the markup it reconciles on the client
 * (no hydration mismatch). The client re-renders with the real profile right
 * after hydration.
 *
 * Deliberately the NARROWEST supported viewport, touch-first: server markup
 * never assumes more room than a phone has, which is the safe direction to be
 * wrong in (nothing overflows; the desktop layout appears one frame later).
 * This also matches Tailwind's mobile-first cascade.
 */
export const DEFAULT_DEVICE_PROFILE: DeviceProfile = Object.freeze({
  type: 'mobile',
  width: 375,
  height: 812,
  aspectRatio: round4(375 / 812),
  orientation: 'portrait',
  isTouchDevice: true,
  hasHover: false,
})

/* ===== Video rendering configuration =====
   The device/layout layer decides HOW a video is drawn into its box; it does
   not touch the MediaStream, the capture settings or the detection pipeline. */

/** Camera tracks published by the room are 16:9. */
export const SOURCE_VIDEO_ASPECT = 16 / 9

/**
 * Below this container aspect ratio, `cover` would crop away more than roughly
 * a quarter of the frame's width (portrait phone / tablet canvases), which
 * cuts the person out of the picture. Above it, `cover` crops the usual small
 * amount of top/bottom — the behaviour the desktop layout has always had.
 */
export const MIN_COVER_ASPECT = 1.3

export type VideoFit = 'cover' | 'contain'

/**
 * Chooses how a video fills its (already responsive) container:
 *   - wide container  → cover (fills edge to edge, current desktop behaviour)
 *   - tall container   → contain (keeps the whole person, letterboxed)
 */
export function resolveVideoFit(containerWidth: number, containerHeight: number): VideoFit {
  if (containerWidth <= 0 || containerHeight <= 0) return 'cover'
  return containerWidth / containerHeight < MIN_COVER_ASPECT ? 'contain' : 'cover'
}

/* ===== Adaptive layout derivation ===== */

/**
 * Layout constraints the session UI consumes. Derived from the profile in one
 * place so components never re-implement breakpoint maths themselves.
 */
export interface SessionLayout {
  /** Below the desktop breakpoint the sidebar floats over the canvas as a drawer
      instead of pushing the video down to ~350px. */
  overlaySidebar: boolean
  /** Mobile: trimmed chrome, tighter spacing, stacked controls. */
  compact: boolean
  /** Controls wrap onto extra rows rather than scrolling sideways. */
  wrapControls: boolean
  /** Buttons show icon only; their labels stay in the a11y tree (`sr-only`). */
  iconOnlyControls: boolean
  /** Hit areas are sized for fingers — touch screens, tablets and phones. */
  touchFriendly: boolean
  /** Main-column padding, in px. */
  contentPadding: { x: number; y: number }
  /** Main-column gap between chrome rows, in px. */
  contentGap: number
  /** Corner radius of the main video card. */
  videoRadius: number
  /** Default tile width for the participants popup. */
  participantTileWidth: number
  /** Whether the therapist's participants popup should open itself. */
  autoOpenParticipants: boolean
}

export function deriveSessionLayout(profile: DeviceProfile): SessionLayout {
  if (profile.type === 'desktop') {
    return {
      overlaySidebar: false,
      compact: false,
      wrapControls: false,
      iconOnlyControls: false,
      // A touch-capable laptop still needs finger-sized hit areas.
      touchFriendly: profile.isTouchDevice || !profile.hasHover,
      contentPadding: { x: 16, y: 12 },
      contentGap: 12,
      videoRadius: 24,
      participantTileWidth: 200,
      autoOpenParticipants: true,
    }
  }

  // A viewport is "phone-like" when its shorter dimension is ≤ a phone's
  // max short dimension. This covers:
  //   - portrait phones (width ≤ 767, min = width)
  //   - landscape phones (width ≥ 768, but min = height ≤ 430)
  //   - small tablets in portrait are NOT included (min = 768)
  const phoneLike = Math.min(profile.width, profile.height) <= BREAKPOINTS.mobileMaxShortDimension

  if (profile.type === 'tablet' && !phoneLike) {
    return {
      overlaySidebar: true,
      compact: false,
      // Labels survive, but ~10 labelled buttons no longer fit one row.
      wrapControls: true,
      iconOnlyControls: false,
      touchFriendly: true,
      contentPadding: { x: 10, y: 8 },
      contentGap: 8,
      videoRadius: 20,
      participantTileWidth: 200,
      autoOpenParticipants: true,
    }
  }

  // Phone-like: real phones (portrait or landscape), plus tablets held sideways.
  const landscape = profile.orientation === 'landscape'
  return {
    overlaySidebar: true,
    compact: true,
    wrapControls: true,
    iconOnlyControls: true,
    touchFriendly: true,
    // Landscape phones are height-starved: claw back every vertical pixel.
    contentPadding: landscape ? { x: 6, y: 4 } : { x: 8, y: 8 },
    contentGap: landscape ? 6 : 8,
    videoRadius: 14,
    participantTileWidth: 160,
    // The main canvas already shows the remote feed on a phone; a floating
    // popup over it would just cover the video. Modules still open it.
    autoOpenParticipants: false,
  }
}
