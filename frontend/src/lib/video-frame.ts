/**
 * Dynamic Responsive Video Frame Resizing Algorithm
 *
 * Five properties:
 *  1. Responsive Design        — frames derive their size from the live
 *                                container/viewport, never fixed px.
 *  2. Dynamic Resizing         — width & height recompute whenever the
 *                                available space changes (ResizeObserver).
 *  3. Aspect Ratio Preservation— one dimension drives the other through a
 *                                fixed ratio (16:9 video, 5:3 popup tile).
 *  4. object-fit: cover/contain — `cover` fills the frame (crop),
 *                                `contain` letterboxes (never crop).
 *  5. Viewport-based sizing    — pure CSS fallback uses min()/max()/vw/vh so
 *                                the frame adapts even before JS measures it.
 */

export type ObjectFitMode = 'cover' | 'contain'

export interface FrameSize {
  width: number
  height: number
}

export interface FrameConstraints {
  /** Width ÷ height the frame must keep (e.g. 16/9 for video, 5/3 for tiles). */
  aspect?: number
  /** Hard pixel bounds for the frame. */
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  /** How the video pixels map into the frame. */
  fit?: ObjectFitMode
}

/** Default aspect ratios. */
export const VIDEO_ASPECT = 16 / 9   // LiveKit capture 1280×720
export const TILE_ASPECT = 5 / 3     // Popup tiles — height = width × 0.6

/** Clamp a number between min and max. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/** Round a frame size to whole pixels. */
function roundFrame(f: FrameSize): FrameSize {
  return { width: Math.round(f.width), height: Math.round(f.height) }
}

/**
 * Step 1: Fit the largest `aspect`-ratio rectangle inside `box`.
 * This is the "contain" geometry — the whole frame is visible.
 */
export function fitInBox(box: FrameSize, aspect: number): FrameSize {
  if (box.width <= 0 || box.height <= 0) return { width: 0, height: 0 }
  const byWidth = { width: box.width, height: box.width / aspect }
  if (byWidth.height <= box.height) return roundFrame(byWidth)
  return roundFrame({ width: box.height * aspect, height: box.height })
}

/**
 * Step 2: Clamp frame to hard bounds while preserving aspect ratio.
 * Two-pass: clamp width, derive height; then clamp height, re-derive width.
 */
export function clampFrame(
  frame: FrameSize,
  aspect: number,
  { minWidth = 0, maxWidth = Infinity, minHeight = 0, maxHeight = Infinity }: FrameConstraints
): FrameSize {
  let w = clamp(frame.width, minWidth, maxWidth)
  let h = w / aspect
  if (h < minHeight) { h = minHeight; w = h * aspect }
  if (h > maxHeight) { h = maxHeight; w = h * aspect }
  return roundFrame({ width: w, height: h })
}

/**
 * Core algorithm: resolve the final frame size from available space + constraints.
 * - fit = 'contain': frame is the largest aspect-correct rect inside available.
 * - fit = 'cover': frame IS the available box (video crops inside via object-fit).
 */
export function resolveFrame(
  available: FrameSize,
  constraints: FrameConstraints = {}
): FrameSize {
  const { aspect = VIDEO_ASPECT, fit = 'contain' } = constraints
  const base = fit === 'cover' ? available : fitInBox(available, aspect)
  return clampFrame(base, aspect, constraints)
}

/**
 * Step 5: Generate viewport-based CSS that adapts without JS.
 * Use on elements that should scale with the viewport immediately.
 */
export function viewportFrameCss(opts: {
  /** Design width cap (px or string like '200px'). */
  maxWidth: number | string
  /** Minimum height floor. */
  minHeight?: number | string
  /** Aspect ratio width/height (e.g. 5/3). */
  aspect: number
  /** Breathing room on left+right (e.g. '2rem'). */
  gutter?: string
}): React.CSSProperties {
  const gutter = opts.gutter ?? '1rem'
  const maxW = typeof opts.maxWidth === 'number' ? `${opts.maxWidth}px` : opts.maxWidth
  const minH = opts.minHeight ? `min-height: ${typeof opts.minHeight === 'number' ? `${opts.minHeight}px` : opts.minHeight};` : ''
  return {
    width: `min(${maxW}, calc(100vw - ${gutter}))`,
    aspectRatio: `${opts.aspect}`,
    height: 'auto',
    maxWidth: '100%',
    ...(minH ? { style: { minHeight: opts.minHeight } as React.CSSProperties } : {}),
  } as React.CSSProperties
}

/**
 * Generate a CSS `aspect-ratio` value from width/height numbers.
 */
export function aspectRatioCss(width: number, height: number): string {
  return `${width} / ${height}`
}