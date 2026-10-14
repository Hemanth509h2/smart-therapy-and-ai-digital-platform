'use client'

// The single entry point components use to know what screen they are on.
//
//   const device = useDeviceProfile()   // full profile
//   const type   = useDeviceType()      // re-renders only at breakpoints
//   const layout = useSessionLayout()   // profile → session layout constraints
//
// SSR/Next.js safety:
//   - no window/navigator access during server rendering — React reads
//     getServerSnapshot() there, which is a frozen constant;
//   - the client hydrates against that same constant, so there is no
//     hydration mismatch, then re-renders once with the real profile;
//   - components mounted later (client-side navigation) read the live value on
//     their first render, so nothing flashes.
//
// Breakpoint detection uses matchMedia so JavaScript and CSS (Tailwind md:/lg:)
// make identical decisions — no drift at 768/1024px from scrollbar differences.
//
// Resize/orientation listeners are coalesced into one requestAnimationFrame
// callback and the store only publishes when the profile actually changed, so
// dragging a window edge cannot flood React with renders.

import { useSyncExternalStore, useMemo } from 'react'
import {
  DEFAULT_DEVICE_PROFILE,
  deriveSessionLayout,
  type DeviceProfile,
  type DeviceType,
  type SessionLayout,
} from '@/lib/deviceProfile'
import { createDeviceStore, type DeviceEnvironment, type DeviceStore } from '@/lib/deviceStore'

const MD_QUERY = '(min-width: 768px)'   // Tailwind `md:` — tablet and up
const LG_QUERY = '(min-width: 1024px)'  // Tailwind `lg:` — desktop and up
const HOVER_QUERY = '(hover: hover)'
const COARSE_POINTER_QUERY = '(any-pointer: coarse)'

/**
 * The browser half of the system: reads window/navigator, and turns
 * resize / orientation / pointer-capability changes into a single change
 * signal (rAF-coalesced so several resize events in one frame cost one read).
 *
 * Breakpoint detection uses matchMedia so JavaScript and CSS (Tailwind md:/lg:)
 * make identical decisions — no drift at 768/1024px from scrollbar differences.
 */
export function createBrowserEnvironment(): DeviceEnvironment {
  const supportsMatchMedia =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'

  const media = (query: string): MediaQueryList | null =>
    supportsMatchMedia ? window.matchMedia(query) : null

  const attachMedia = (query: string, onChange: () => void): (() => void) => {
    const mq = media(query)
    if (!mq) return () => {}
    // Safari < 14 only has the deprecated addListener/removeListener pair.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    const legacy = mq as unknown as {
      addListener: (cb: () => void) => void
      removeListener: (cb: () => void) => void
    }
    legacy.addListener(onChange)
    return () => legacy.removeListener(onChange)
  }

  const mdMQ = media(MD_QUERY)
  const lgMQ = media(LG_QUERY)

  const getType = (): DeviceType => {
    if (!mdMQ?.matches) return 'mobile'
    if (!lgMQ?.matches) return 'tablet'
    return 'desktop'
  }

  return {
    getViewport: () => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }),

    getCapabilities: () => {
      const touchPoints =
        typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number'
          ? navigator.maxTouchPoints
          : 0
      const coarse = media(COARSE_POINTER_QUERY)?.matches ?? false
      return {
        isTouchDevice: touchPoints > 0 || coarse,
        hasHover: media(HOVER_QUERY)?.matches ?? true,
      }
    },

    getType,

    subscribe: (onChange) => {
      let frame: number | null = null
      const flush = () => {
        frame = null
        onChange()
      }
      const schedule = () => {
        if (frame !== null) return // already queued for this frame
        if (typeof requestAnimationFrame !== 'function') {
          onChange()
          return
        }
        frame = requestAnimationFrame(flush)
      }

      // Subscribe to breakpoint changes via matchMedia — this matches CSS exactly.
      const detachMD = mdMQ ? attachMedia(MD_QUERY, schedule) : () => {}
      const detachLG = lgMQ ? attachMedia(LG_QUERY, schedule) : () => {}
      const detachHover = attachMedia(HOVER_QUERY, schedule)
      const detachPointer = attachMedia(COARSE_POINTER_QUERY, schedule)

      // Also listen for orientation changes (rotation) which may change layout
      // without crossing breakpoint boundaries.
      window.addEventListener('orientationchange', schedule)

      return () => {
        if (frame !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(frame)
        }
        detachMD()
        detachLG()
        detachHover()
        detachPointer()
        window.removeEventListener('orientationchange', schedule)
      }
    },
  }
}

// One store for the whole app. Created lazily so importing this module on the
// server never constructs anything that could reach for `window`.
let browserStore: DeviceStore | null = null
function getBrowserStore(): DeviceStore {
  if (!browserStore) browserStore = createDeviceStore(createBrowserEnvironment())
  return browserStore
}

// Module-level functions: useSyncExternalStore needs referentially stable
// callbacks, and recreating them per render would resubscribe every render.
const subscribe = (listener: () => void) => getBrowserStore().subscribe(listener)
const getSnapshot = () => getBrowserStore().getSnapshot()
const getServerSnapshot = () => DEFAULT_DEVICE_PROFILE
const getTypeSnapshot = () => getBrowserStore().getSnapshot().type
const getTypeServerSnapshot = () => DEFAULT_DEVICE_PROFILE.type

/** Full device profile: viewport, orientation, touch and hover capabilities. */
export function useDeviceProfile(): DeviceProfile {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Device type only. Because the snapshot is a primitive, React skips the
 * re-render when a resize does not cross a breakpoint — use this in components
 * that only care about mobile/tablet/desktop.
 */
export function useDeviceType(): DeviceType {
  return useSyncExternalStore(subscribe, getTypeSnapshot, getTypeServerSnapshot)
}

/**
 * Profile → session layout constraints (see deriveSessionLayout). This is what
 * session components should consume: breakpoint maths lives in one place.
 */
export function useSessionLayout(): SessionLayout {
  const device = useDeviceProfile()
  return useMemo(() => deriveSessionLayout(device), [device])
}
