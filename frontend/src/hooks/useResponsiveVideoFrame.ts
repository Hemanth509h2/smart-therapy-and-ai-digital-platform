'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { resolveFrame, type FrameConstraints, type FrameSize } from '@/lib/video-frame'

/**
 * Hook that measures a container via ResizeObserver and resolves the video frame
 * inside it using the Dynamic Responsive Video Frame Resizing Algorithm.
 *
 * @param constraints - Frame constraints (aspect, bounds, fit mode)
 * @param enabled - Whether to observe (default true)
 * @returns { ref, available, frame } — attach `ref` to the container element
 */
export function useResponsiveVideoFrame<T extends HTMLElement>(
  constraints: FrameConstraints = {},
  enabled = true
): { ref: RefObject<T>; available: FrameSize; frame: FrameSize } {
  const ref = useRef<T>(null)
  const [available, setAvailable] = useState<FrameSize>({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const ro = new ResizeObserver((entries) => {
      const box = entries[0].contentRect
      setAvailable({ width: box.width, height: box.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled])

  const frame = resolveFrame(available, constraints)
  return { ref, available, frame }
}

/**
 * Variant for the main video area — keeps video 100% with object-fit cover
 * (CSS handles the responsive fill), but exposes the computed mode for UI.
 */
export function useMainVideoFrame<T extends HTMLElement>(
  enabled = true
): { ref: RefObject<T>; style: React.CSSProperties } {
  const ref = useRef<T>(null)
  const [available, setAvailable] = useState<FrameSize>({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const ro = new ResizeObserver((entries) => {
      const box = entries[0].contentRect
      setAvailable({ width: box.width, height: box.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled])

  // The video fills the container; object-fit: cover handles aspect preservation.
  // We return a style object the <VideoTrack> can spread.
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  }
  return { ref, style }
}