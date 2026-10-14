// The device-profile store: a tiny external store in the shape
// useSyncExternalStore expects (getSnapshot / getServerSnapshot / subscribe).
//
// Kept free of React and of any window access so the interesting behaviour —
// caching, equality-gated notifications, single shared listener — is unit
// testable in a plain Node environment. The browser wiring (which events to
// listen to, how to throttle them) lives behind DeviceEnvironment and is
// implemented in src/hooks/useDeviceProfile.ts.

import {
  buildDeviceProfile,
  profilesEqual,
  DEFAULT_DEVICE_PROFILE,
  type DeviceProfile,
  type DeviceViewport,
  type DeviceCapabilities,
  type DeviceType,
} from './deviceProfile'

/** Everything the store needs from its host environment. */
export interface DeviceEnvironment {
  getViewport(): DeviceViewport
  getCapabilities(): DeviceCapabilities
  /** Returns the device type based on matchMedia — matches CSS breakpoints exactly. */
  getType(): DeviceType
  /** Attach to resize/orientation/capability changes. Returns an unsubscribe fn. */
  subscribe(onChange: () => void): () => void
}

export interface DeviceStore {
  /** Current profile. Cached — the reference is stable until the profile changes. */
  getSnapshot(): DeviceProfile
  /** Snapshot for server rendering and the hydration pass. Never reads the DOM. */
  getServerSnapshot(): DeviceProfile
  /** useSyncExternalStore subscription contract. */
  subscribe(listener: () => void): () => void
}

export function createDeviceStore(environment: DeviceEnvironment): DeviceStore {
  let cached: DeviceProfile | null = null
  const listeners = new Set<() => void>()
  let detachEnvironment: (() => void) | null = null

  // Rebuild from the environment, but only publish a new object when something
  // actually differs — this is what keeps `getSnapshot` cache-safe (React warns
  // — and loops — if a snapshot's identity changes without a store update).
  const refresh = (): DeviceProfile => {
    const viewport = environment.getViewport()
    const capabilities = environment.getCapabilities()
    const type = environment.getType()
    const next = buildDeviceProfile(viewport, capabilities, type)
    if (!cached || !profilesEqual(cached, next)) cached = next
    return cached
  }

  const onEnvironmentChange = () => {
    const previous = cached
    const next = refresh()
    // Identity comparison: refresh() reuses `cached` when nothing changed, so a
    // 1px-wiggle that lands on an identical profile notifies nobody.
    if (next !== previous) listeners.forEach((listener) => listener())
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    // One shared environment subscription for however many components are
    // mounted; the first subscriber attaches, the last one detaches.
    if (!detachEnvironment) detachEnvironment = environment.subscribe(onEnvironmentChange)
    // A change may have landed between render and this subscribe — flush it now
    // instead of waiting for the next resize event.
    onEnvironmentChange()

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && detachEnvironment) {
        detachEnvironment()
        detachEnvironment = null
      }
    }
  }

  return {
    getSnapshot: () => cached ?? refresh(),
    getServerSnapshot: () => DEFAULT_DEVICE_PROFILE,
    subscribe,
  }
}
