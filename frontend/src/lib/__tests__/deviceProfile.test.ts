import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BREAKPOINTS,
  classifyViewport,
  orientationOf,
  buildDeviceProfile,
  profilesEqual,
  DEFAULT_DEVICE_PROFILE,
  resolveVideoFit,
  deriveSessionLayout,
  SOURCE_VIDEO_ASPECT,
  MIN_COVER_ASPECT,
} from '../deviceProfile'
import { createDeviceStore, type DeviceEnvironment } from '../deviceStore'

/* ===== Breakpoint classification ===== */

describe('classifyViewport', () => {
  it('treats everything up to 767px as mobile', () => {
    expect(classifyViewport(0)).toBe('mobile')
    expect(classifyViewport(375)).toBe('mobile')
    expect(classifyViewport(BREAKPOINTS.mobileMax)).toBe('mobile')
  })

  it('treats 768–1023px as tablet', () => {
    expect(classifyViewport(BREAKPOINTS.mobileMax + 1)).toBe('tablet')
    expect(classifyViewport(834)).toBe('tablet')
    expect(classifyViewport(BREAKPOINTS.desktopMin - 1)).toBe('tablet')
  })

  it('treats 1024px and up as desktop', () => {
    expect(classifyViewport(BREAKPOINTS.desktopMin)).toBe('desktop')
    expect(classifyViewport(1920)).toBe('desktop')
    expect(classifyViewport(3840)).toBe('desktop')
  })
})

describe('orientationOf', () => {
  it('is width vs height, not a device class', () => {
    expect(orientationOf({ width: 375, height: 812 })).toBe('portrait')
    expect(orientationOf({ width: 812, height: 375 })).toBe('landscape')
    // Square defaults to landscape rather than flickering between the two.
    expect(orientationOf({ width: 800, height: 800 })).toBe('landscape')
  })
})

describe('buildDeviceProfile', () => {
  it('rounds sub-pixel viewports so zoom/DPR jitter cannot churn renders', () => {
    const a = buildDeviceProfile({ width: 800.4, height: 600.6 }, { isTouchDevice: false, hasHover: true }, 'desktop')
    expect(a.width).toBe(800)
    expect(a.height).toBe(601)
    // aspectRatio is computed from the ROUNDED dimensions: 800/601, to 4dp.
    expect(a.aspectRatio).toBe(1.3311)
  })

  it('never reports a zero-sized viewport', () => {
    const p = buildDeviceProfile({ width: 0, height: -10 }, { isTouchDevice: true, hasHover: false }, 'mobile')
    expect(p.width).toBe(1)
    expect(p.height).toBe(1)
  })

  it('takes touch/hover from capabilities, not from the viewport', () => {
    const p = buildDeviceProfile({ width: 1366, height: 768 }, { isTouchDevice: true, hasHover: false }, 'desktop')
    expect(p.type).toBe('desktop')
    expect(p.isTouchDevice).toBe(true)
    expect(p.hasHover).toBe(false)
  })
})

describe('profilesEqual', () => {
  const base = buildDeviceProfile({ width: 800, height: 600 }, { isTouchDevice: false, hasHover: true }, 'desktop')

  it('is true only when every field matches', () => {
    expect(profilesEqual(base, { ...base })).toBe(true)
    expect(profilesEqual(base, { ...base, width: 801 })).toBe(false)
    expect(profilesEqual(base, { ...base, type: 'mobile' })).toBe(false)
    expect(profilesEqual(base, { ...base, isTouchDevice: true })).toBe(false)
    expect(profilesEqual(base, { ...base, hasHover: false })).toBe(false)
  })

  it('catches a pure orientation flip (same type, same size values)', () => {
    const rotated = buildDeviceProfile({ width: 600, height: 800 }, { isTouchDevice: false, hasHover: true }, 'tablet')
    expect(profilesEqual(base, rotated)).toBe(false)
  })
})

describe('DEFAULT_DEVICE_PROFILE', () => {
  it('is a frozen mobile-portrait snapshot the server can render with', () => {
    expect(Object.isFrozen(DEFAULT_DEVICE_PROFILE)).toBe(true)
    expect(DEFAULT_DEVICE_PROFILE.type).toBe('mobile')
    expect(DEFAULT_DEVICE_PROFILE.orientation).toBe('portrait')
    expect(DEFAULT_DEVICE_PROFILE.width).toBeLessThanOrEqual(BREAKPOINTS.mobileMax)
  })
})

/* ===== Video fit ===== */

describe('resolveVideoFit', () => {
  it('covers a wide container (desktop behaviour)', () => {
    expect(resolveVideoFit(1600, 900)).toBe('cover') // 1.78
    expect(resolveVideoFit(1200, 900)).toBe('cover') // 1.33 (== threshold, not below)
  })

  it('contains a tall container so a portrait crop never cuts the person out', () => {
    expect(resolveVideoFit(400, 700)).toBe('contain') // 0.57
    expect(resolveVideoFit(768, 700)).toBe('contain') // 1.09
    expect(resolveVideoFit(1000, 800)).toBe('contain') // 1.25 < 1.3
  })

  it('defaults to cover for degenerate measurements', () => {
    expect(resolveVideoFit(0, 0)).toBe('cover')
    expect(resolveVideoFit(500, 0)).toBe('cover')
  })

  it('keeps the 16:9 camera source above the cover threshold', () => {
    expect(SOURCE_VIDEO_ASPECT).toBeGreaterThan(MIN_COVER_ASPECT)
  })
})

/* ===== Session layout derivation ===== */

// Helper that mimics the browser's matchMedia-based classification for test purposes.
// In the real browser, type comes from matchMedia('(min-width: 768px)') and matchMedia('(min-width: 1024px)').
const typeForWidth = (width: number): 'mobile' | 'tablet' | 'desktop' =>
  width <= BREAKPOINTS.mobileMax ? 'mobile' : width < BREAKPOINTS.desktopMin ? 'tablet' : 'desktop'

const profile = (width: number, height: number, caps = { isTouchDevice: false, hasHover: true }) =>
  buildDeviceProfile({ width, height }, caps, typeForWidth(width))

const VIEWPORTS = [
  { name: 'phone portrait', width: 375, height: 812, type: 'mobile', orientation: 'portrait', shape: 'phone' },
  // 812px wide clears the tablet line, but at 375px tall its vertical budget is
  // still a phone's → compact layout (phone-like: min dimension ≤ 430).
  { name: 'phone landscape', width: 812, height: 375, type: 'tablet', orientation: 'landscape', shape: 'phone' },
  { name: 'tablet portrait', width: 768, height: 1024, type: 'tablet', orientation: 'portrait', shape: 'tablet' },
  { name: 'tablet landscape', width: 1024, height: 768, type: 'desktop', orientation: 'landscape', shape: 'desktop' },
  { name: 'laptop', width: 1366, height: 768, type: 'desktop', orientation: 'landscape', shape: 'desktop' },
  { name: 'desktop', width: 1920, height: 1080, type: 'desktop', orientation: 'landscape', shape: 'desktop' },
] as const

describe('deriveSessionLayout across the required viewports', () => {
  it.each(VIEWPORTS)('$name ($width×$height → $type/$orientation)', (v) => {
    const p = profile(v.width, v.height)
    expect(p.type).toBe(v.type)
    expect(p.orientation).toBe(v.orientation)

    const l = deriveSessionLayout(p)
    if (v.shape === 'phone') {
      expect(l).toMatchObject({
        overlaySidebar: true,
        compact: true,
        wrapControls: true,
        iconOnlyControls: true,
        touchFriendly: true,
        autoOpenParticipants: false,
        videoRadius: 14,
        participantTileWidth: 160,
      })
      // Phones show the video at a sensible size inside the popup tiles.
      expect(l.participantTileWidth).toBeLessThan(200)
    } else if (v.shape === 'tablet') {
      expect(l).toMatchObject({
        overlaySidebar: true,
        compact: false,
        wrapControls: true,
        iconOnlyControls: false,
        touchFriendly: true,
        autoOpenParticipants: true,
        videoRadius: 20,
      })
    } else {
      // 1024 is the narrowest desktop: the inline sidebar must never eat more
      // than ~40% of the canvas, which is exactly why 420px is safe here but
      // not on a 768px tablet.
      expect(l.overlaySidebar).toBe(false)
      expect(l.compact).toBe(false)
      expect(l.wrapControls).toBe(false)
      expect(l.iconOnlyControls).toBe(false)
      expect(l.autoOpenParticipants).toBe(true)
      expect(l.videoRadius).toBe(24)
      expect(l.participantTileWidth).toBe(200)
      expect(l.contentPadding).toEqual({ x: 16, y: 12 })
    }
  })

  it('tablet never reserves the 420px sidebar (overlay instead)', () => {
    expect(deriveSessionLayout(profile(768, 1024)).overlaySidebar).toBe(true)
    expect(deriveSessionLayout(profile(1024, 768)).overlaySidebar).toBe(false)
  })

  it('portrait phones keep more vertical room than landscape ones', () => {
    const portrait = deriveSessionLayout(profile(375, 812))
    const landscape = deriveSessionLayout(profile(812, 375))
    expect(landscape.contentPadding.y).toBeLessThan(portrait.contentPadding.y)
    expect(landscape.contentGap).toBeLessThan(portrait.contentGap)
  })

  it('a touch laptop still gets finger-sized controls', () => {
    const l = deriveSessionLayout(profile(1440, 900, { isTouchDevice: true, hasHover: true }))
    expect(l.overlaySidebar).toBe(false)
    expect(l.touchFriendly).toBe(true)
  })

  it('a mouse-only desktop does not inflate hit areas', () => {
    expect(deriveSessionLayout(profile(1920, 1080)).touchFriendly).toBe(false)
  })
})

/* ===== Store (createDeviceStore) ===== */

/** Environment the store can be driven by — no DOM, no timers. */
function fakeEnvironment(initial: { width: number; height: number }) {
  let viewport = initial
  let capabilities = { isTouchDevice: false, hasHover: true }
  let type = typeForWidth(initial.width)
  let listener: (() => void) | null = null
  let attachCount = 0
  let detachCount = 0

  const env: DeviceEnvironment = {
    getViewport: () => viewport,
    getCapabilities: () => capabilities,
    getType: () => type,
    subscribe: (onChange) => {
      listener = onChange
      attachCount++
      return () => {
        listener = null
        detachCount++
      }
    },
  }

  return {
    env,
    resize(width: number, height: number) {
      viewport = { width, height }
      type = typeForWidth(width)
      listener?.()
    },
    setCapabilities(next: { isTouchDevice: boolean; hasHover: boolean }) {
      capabilities = next
      listener?.()
    },
    /** Notify without any actual change (what a noisy resize event looks like). */
    poke() {
      listener?.()
    },
    get attachCount() {
      return attachCount
    },
    get detachCount() {
      return detachCount
    },
    get attached() {
      return listener !== null
    },
  }
}

describe('createDeviceStore', () => {
  it('serves the frozen default on the server, without touching the environment', () => {
    const fake = fakeEnvironment({ width: 1920, height: 1080 })
    const store = createDeviceStore(fake.env)
    expect(store.getServerSnapshot()).toBe(DEFAULT_DEVICE_PROFILE)
    // No subscribe() → no environment listener was ever attached.
    expect(fake.attachCount).toBe(0)
  })

  it('reads the live viewport on demand, and only attaches on first subscribe', () => {
    const fake = fakeEnvironment({ width: 1920, height: 1080 })
    const store = createDeviceStore(fake.env)
    // getSnapshot may read straight away (client-side navigation mounts with a
    // real value rather than flashing the server's phone-sized default), but
    // nothing is listening until React subscribes.
    expect(store.getSnapshot().type).toBe('desktop')
    expect(fake.attachCount).toBe(0)

    const unsubscribe = store.subscribe(() => {})
    expect(fake.attachCount).toBe(1)
    unsubscribe()
  })

  it('keeps snapshot identity stable across no-op notifies', () => {
    const fake = fakeEnvironment({ width: 1200, height: 800 })
    const store = createDeviceStore(fake.env)
    store.subscribe(() => {})

    const before = store.getSnapshot()
    fake.poke() // same viewport, same capabilities → must not build a new object
    fake.poke()
    expect(store.getSnapshot()).toBe(before)
  })

  it('publishes exactly once per real change and reuses nothing across it', () => {
    const fake = fakeEnvironment({ width: 1200, height: 800 })
    const store = createDeviceStore(fake.env)
    const listener = vi.fn()
    store.subscribe(listener)

    const before = store.getSnapshot()
    listener.mockClear()

    fake.resize(700, 900)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).not.toBe(before)
    expect(store.getSnapshot().type).toBe('mobile')

    // Same dimensions reported again: no render.
    listener.mockClear()
    fake.poke()
    expect(listener).not.toHaveBeenCalled()
  })

  it('re-renders on a capability flip even at an unchanged size', () => {
    const fake = fakeEnvironment({ width: 1440, height: 900 })
    const store = createDeviceStore(fake.env)
    const listener = vi.fn()
    // Subscribing flushes a pending change, which also populates the cache for
    // the first time — clear it so what follows measures only the flip itself.
    store.subscribe(listener)
    listener.mockClear()

    fake.setCapabilities({ isTouchDevice: true, hasHover: true })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().isTouchDevice).toBe(true)
    expect(store.getSnapshot().type).toBe('desktop')
  })

  it('shares one environment subscription across many listeners', () => {
    const fake = fakeEnvironment({ width: 1000, height: 700 })
    const store = createDeviceStore(fake.env)
    const a = vi.fn()
    const b = vi.fn()

    const unsubA = store.subscribe(a)
    const unsubB = store.subscribe(b)
    expect(fake.attachCount).toBe(1)

    fake.resize(500, 800)
    expect(a).toHaveBeenCalled()
    expect(b).toHaveBeenCalled()

    unsubA()
    expect(fake.attached).toBe(true) // b still listening
    unsubB()
    expect(fake.detachCount).toBe(1)
    expect(fake.attached).toBe(false)
  })

  it('re-attaches after the last listener unsubscribes', () => {
    const fake = fakeEnvironment({ width: 1000, height: 700 })
    const store = createDeviceStore(fake.env)
    const unsub = store.subscribe(() => {})
    unsub()
    store.subscribe(() => {})
    expect(fake.attachCount).toBe(2)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})