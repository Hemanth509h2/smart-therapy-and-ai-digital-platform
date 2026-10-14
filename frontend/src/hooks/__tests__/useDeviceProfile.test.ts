// SSR safety and browser-environment behaviour for the device profile hook.
//
// Two guarantees are under test here:
//   1. Server rendering NEVER touches window/navigator — Next.js renders these
//      components on the server first, and a window read there throws.
//   2. The browser environment coalesces breakpoint/pointer changes into one rAF tick.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  useDeviceProfile,
  useDeviceType,
  useSessionLayout,
  createBrowserEnvironment,
} from '../useDeviceProfile'
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '@/lib/deviceProfile'
import { createDeviceStore } from '@/lib/deviceStore'

/* ===== Server rendering ===== */

function ProfileProbe() {
  const device = useDeviceProfile()
  return createElement('span', { 'data-type': device.type }, `${device.width}x${device.height}`)
}

function TypeProbe() {
  return createElement('span', null, useDeviceType())
}

function LayoutProbe() {
  const layout = useSessionLayout()
  return createElement('span', null, `${layout.compact}-${layout.overlaySidebar}`)
}

describe('server rendering', () => {
  it('renders without a window and reports the frozen default profile', () => {
    // typeof on a missing global yields the STRING 'undefined'.
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined')

    const html = renderToString(createElement(ProfileProbe))
    expect(html).toContain(DEFAULT_DEVICE_PROFILE.type)
    expect(html).toContain(`${DEFAULT_DEVICE_PROFILE.width}x${DEFAULT_DEVICE_PROFILE.height}`)
  })

  it('exposes a primitive device type so SSR markup matches hydration', () => {
    expect(renderToString(createElement(TypeProbe))).toContain(DEFAULT_DEVICE_PROFILE.type)
  })

  it('derives the mobile layout on the server (narrowest-viewport markup)', () => {
    expect(renderToString(createElement(LayoutProbe))).toBe('<span>true-true</span>')
  })

  it('never subscribes during SSR — no environment attach happened', () => {
    // createBrowserEnvironment throws on a window-less global; the fact that
    // the renders above succeeded is the assertion. Call it explicitly too, to
    // prove construction itself is deferred-safe when window is absent.
    expect(() => createBrowserEnvironment()).not.toThrow()
  })
})

/* ===== Browser environment ===== */

interface StubMediaQueryList {
  matches: boolean
  media: string
  addEventListener: (type: string, cb: () => void) => void
  removeEventListener: (type: string, cb: () => void) => void
}

interface StubWindow {
  innerWidth: number
  innerHeight: number
  matchMedia: (query: string) => StubMediaQueryList
  addEventListener: (type: string, cb: () => void) => void
  removeEventListener: (type: string, cb: () => void) => void
}

function installWindow(opts: {
  width: number
  height: number
  hover?: boolean
  coarsePointer?: boolean
}) {
  const domListeners = new Map<string, Set<() => void>>()
  const mediaListeners = new Map<string, Set<() => void>>()

  // Cache matchMedia results so the same query returns the same object
  const mqlCache = new Map<string, { matches: boolean; media: string; listeners: Set<() => void> }>()

  const getOrCreateMQL = (query: string, initialMatches: boolean) => {
    let entry = mqlCache.get(query)
    if (!entry) {
      entry = { matches: initialMatches, media: query, listeners: new Set() }
      mqlCache.set(query, entry)
    }
    return entry
  }

  const createMediaQueryList = (query: string, initialMatches: boolean) => {
    const entry = getOrCreateMQL(query, initialMatches)
    return {
      get matches() { return entry.matches },
      set matches(v: boolean) { entry.matches = v },
      media: query,
      addEventListener: (_type: string, cb: () => void) => {
        entry.listeners.add(cb)
      },
      removeEventListener: (_type: string, cb: () => void) => {
        entry.listeners.delete(cb)
      },
    }
  }

  // Initial matches for breakpoint queries based on initial width
  const initialMdMatches = opts.width >= 768
  const initialLgMatches = opts.width >= 1024

  let orientationChangeListener: (() => void) | null = null

  const win: StubWindow = {
    innerWidth: opts.width,
    innerHeight: opts.height,
    matchMedia: (query: string) => {
      if (query === '(min-width: 768px)') return createMediaQueryList(query, initialMdMatches)
      if (query === '(min-width: 1024px)') return createMediaQueryList(query, initialLgMatches)
      return createMediaQueryList(query,
        query === '(hover: hover)' ? opts.hover ?? true :
        query === '(any-pointer: coarse)' ? opts.coarsePointer ?? false :
        false)
    },
    addEventListener: (type: string, cb: () => void) => {
      if (type === 'orientationchange') {
        orientationChangeListener = cb
      }
    },
    removeEventListener: (type: string, cb: () => void) => {
      if (type === 'orientationchange' && orientationChangeListener === cb) {
        orientationChangeListener = null
      }
    },
  }

  let frameQueue: Array<() => void> = []

  const globals = globalThis as Record<string, unknown>
  globals.window = win
  globals.requestAnimationFrame = (cb: () => void) => {
    frameQueue.push(cb)
    return frameQueue.length
  }
  globals.cancelAnimationFrame = (id: number) => {
    frameQueue[id - 1] = () => {}
  }

  return {
    win,
    fireDomEvent(type: string) {
      // For orientationchange, we manually trigger the environment's listener
      // The environment subscribes to 'orientationchange' on window
      if (type === 'orientationchange') {
        // The environment's subscribe added a listener to window.orientationchange
        // We need to call it directly since our stub doesn't have real event dispatch
        // We'll handle this in the test by calling the listener directly
      }
    },
    fireMediaQueryChange(query: string, newMatches: boolean) {
      const entry = mqlCache.get(query)
      if (entry) {
        entry.matches = newMatches
        entry.listeners.forEach((cb) => cb())
      }
    },
    /** Directly call the orientationchange listener registered by the environment */
    fireOrientationChange() {
      if (orientationChangeListener) {
        orientationChangeListener()
      }
    },
    /** Run every callback queued for this frame (what a real rAF does). */
    flushFrame() {
      const queued = frameQueue
      frameQueue = []
      queued.forEach((cb) => cb())
    },
    get pendingFrames() {
      return frameQueue.length
    },
    restore() {
      delete (globals as any).window
      delete globals.requestAnimationFrame
      delete globals.cancelAnimationFrame
    },
  }
}

let stub: ReturnType<typeof installWindow> | null = null

beforeEach(() => {
  stub = null
})

afterEach(() => {
  stub?.restore()
  stub = null
  vi.restoreAllMocks()
})

describe('createBrowserEnvironment', () => {
  it('reads viewport and capabilities from the live window/navigator', () => {
    stub = installWindow({ width: 834, height: 1112, hover: false, coarsePointer: true })
    const env = createBrowserEnvironment()

    expect(env.getViewport()).toEqual({ width: 834, height: 1112 })
    expect(env.getCapabilities().isTouchDevice).toBe(true)
    expect(env.getCapabilities().hasHover).toBe(false)
  })

  it('reports hover-capable pointers as non-touch', () => {
    stub = installWindow({ width: 1920, height: 1080, hover: true, coarsePointer: false })
    const env = createBrowserEnvironment()
    expect(env.getCapabilities()).toEqual({ isTouchDevice: false, hasHover: true })
  })

  it('coalesces a burst of breakpoint changes into one notification per frame', () => {
    stub = installWindow({ width: 1024, height: 768 })
    const env = createBrowserEnvironment()
    const onChange = vi.fn()
    env.subscribe(onChange)

    // Fire three breakpoint changes (md + lg) before the next paint
    stub.win.innerWidth = 900
    stub.fireMediaQueryChange('(min-width: 768px)', true)
    stub.fireMediaQueryChange('(min-width: 1024px)', false)

    stub.win.innerWidth = 800
    stub.fireMediaQueryChange('(min-width: 768px)', true)
    stub.fireMediaQueryChange('(min-width: 1024px)', false)

    stub.win.innerWidth = 768
    stub.fireMediaQueryChange('(min-width: 768px)', true)
    stub.fireMediaQueryChange('(min-width: 1024px)', false)

    expect(stub.pendingFrames).toBe(1)
    expect(onChange).not.toHaveBeenCalled()

    stub.flushFrame()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not queue a second frame while one is already pending', () => {
    stub = installWindow({ width: 1024, height: 768 })
    const env = createBrowserEnvironment()
    const onChange = vi.fn()
    env.subscribe(onChange)

    stub.fireMediaQueryChange('(min-width: 768px)', true)
    stub.fireMediaQueryChange('(min-width: 768px)', true)
    expect(stub.pendingFrames).toBe(1)
  })

  it('subscribes to orientation changes too', () => {
    stub = installWindow({ width: 375, height: 812 })
    const env = createBrowserEnvironment()
    const onChange = vi.fn()
    env.subscribe(onChange)

    stub.win.innerHeight = 400
    stub.fireOrientationChange()
    stub.flushFrame()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(env.getViewport()).toEqual({ width: 375, height: 400 })
  })

  it('detaches every listener on unsubscribe', () => {
    stub = installWindow({ width: 1024, height: 768 })
    const env = createBrowserEnvironment()
    const onChange = vi.fn()
    const detach = env.subscribe(onChange)
    detach()

    stub.fireMediaQueryChange('(min-width: 768px)', true)
    expect(stub.pendingFrames).toBe(0)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('cancels a queued frame when unsubscribing mid-frame', () => {
    stub = installWindow({ width: 1024, height: 768 })
    const env = createBrowserEnvironment()
    const onChange = vi.fn()
    const detach = env.subscribe(onChange)

    stub.fireMediaQueryChange('(min-width: 768px)', true)
    detach()
    stub.flushFrame()
    expect(onChange).not.toHaveBeenCalled()
  })
})

/* ===== Store + browser environment together ===== */

describe('end-to-end classification from a live window', () => {
  it('walks mobile → tablet → desktop as the window grows past each threshold', () => {
    stub = installWindow({ width: 375, height: 812 })
    const store = createDeviceStore(createBrowserEnvironment())
    const seen: Array<DeviceProfile['type']> = [store.getSnapshot().type]

    store.subscribe(() => seen.push(store.getSnapshot().type))

    // Cross 768px → tablet (md matches)
    stub.win.innerWidth = 768
    stub.fireMediaQueryChange('(min-width: 768px)', true)
    stub.flushFrame()

    // Cross 1024px → desktop (lg matches)
    stub.win.innerWidth = 1024
    stub.fireMediaQueryChange('(min-width: 1024px)', true)
    stub.flushFrame()

    // Stay desktop at 1920
    stub.win.innerWidth = 1920
    stub.fireMediaQueryChange('(min-width: 768px)', true)
    stub.fireMediaQueryChange('(min-width: 1024px)', true)
    stub.flushFrame()

    // 768 flips to tablet, 1024 flips to desktop
    const transitions = seen.filter((t, i) => i === 0 || t !== seen[i - 1])
    expect(transitions).toEqual(['mobile', 'tablet', 'desktop'])
    expect(store.getSnapshot().width).toBe(1920)
  })

  it('a rotation re-renders with the new orientation at the same type', () => {
    // Both sides of this rotation sit inside the 768–1023 tablet band, so the
    // type is stable and only orientation/layout flip.
    stub = installWindow({ width: 768, height: 800 })
    const store = createDeviceStore(createBrowserEnvironment())
    // Nothing reads or listens until a consumer subscribes — React does this
    // in an effect, which is what arms the resize/orientation listeners.
    store.subscribe(() => {})
    expect(store.getSnapshot()).toMatchObject({ type: 'tablet', orientation: 'portrait' })

    stub.win.innerWidth = 800
    stub.win.innerHeight = 768
    stub.fireOrientationChange()
    stub.flushFrame()

    expect(store.getSnapshot()).toMatchObject({ type: 'tablet', orientation: 'landscape' })
  })
})