'use client'

// Functional whiteboard: Excalidraw wired into the Staad session room.
//
// Division of labour:
//   WhiteboardStage  — the layout shell from the layout conversion (canvas
//                      takeover, shrunken video tiles, tool rail, bottom
//                      toolbar, zoom, colour swatches). Purely presentational.
//   StaadWhiteboard  — this file. Owns the Excalidraw instance, drives the
//                      shell's buttons through Excalidraw's imperative API, and
//                      syncs the scene over Firestore.
//
// Excalidraw's own UI chrome is suppressed entirely (see WB_CHROME_CSS) because
// the shell already provides every control. Two notes on the API surface of
// @excalidraw/excalidraw 0.18.1:
//   * there is no setZoom() — zoom is set through updateScene({ appState }).
//   * there are no undo()/redo() methods; `history` only exposes clear(). Undo
//     and redo are therefore triggered the way a user would, by dispatching the
//     keyboard shortcuts Excalidraw already listens for on its container. That
//     keeps us on Excalidraw's real history stack instead of a parallel one.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { Users, EyeOff } from 'lucide-react'
import { db } from '@/lib/firebase'
import WhiteboardStage from './WhiteboardStage'
import { RC } from './roomTheme'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'

// Excalidraw touches window/document at import time and cannot be server
// rendered, so it is loaded on the client only.
const Excalidraw = dynamic(async () => (await import('@excalidraw/excalidraw')).Excalidraw, {
  ssr: false,
  loading: () => (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: RC.inkMuted }}>Loading whiteboard…</span>
    </div>
  ),
})

/* Only the shape of an element that this file actually depends on. The rest is
   opaque JSON that we hand straight back to Excalidraw. */
type WBElement = { version?: number; isDeleted?: boolean }

/** Cheap scene fingerprint, used to tell our own echo apart from a real remote
 *  edit. Mirrors what Excalidraw's own getSceneVersion() does. */
function sceneVersion(elements: readonly WBElement[]): number {
  let v = elements.length
  for (const el of elements) v += el.version ?? 0
  return v
}

/* Private boards never touch Firestore, so closing and reopening the panel
   would otherwise lose the drawing. Keep it in memory for the session. */
const privateScenes = new Map<string, readonly unknown[]>()

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4

/* Staad's toolbar replaces every native control, so Excalidraw's entire UI layer
   is hidden. Safe to hide wholesale: the text editor, context menu and modal
   containers are siblings of .layer-ui__wrapper, not children of it, so
   double-click-to-type still works. The individual islands are listed too in
   case the wrapper class ever changes under us. */
const WB_CHROME_CSS = `
.staad-wb .excalidraw .layer-ui__wrapper,
.staad-wb .excalidraw .App-menu__left,
.staad-wb .excalidraw .App-toolbar-container,
.staad-wb .excalidraw .App-toolbar,
.staad-wb .excalidraw .layer-ui__wrapper__footer,
.staad-wb .excalidraw .App-bottom-bar,
.staad-wb .excalidraw .help-icon,
.staad-wb .excalidraw .zoom-actions,
.staad-wb .excalidraw .undo-redo-buttons,
.staad-wb .excalidraw .scroll-back-to-content,
.staad-wb .excalidraw .App-toolbar__extra-tools-trigger {
  display: none !important;
}
/* The board sits inside the shell's rounded card. */
.staad-wb .excalidraw,
.staad-wb .excalidraw .excalidraw-canvas-container { border-radius: 0; }
`

/* Shell button id -> Excalidraw tool, plus the drawing defaults that make the
   button mean what its label says. Highlighter and Sticky Notes have no native
   equivalent; they are presets over freedraw and rectangle. */
const TOOL_MAP: Record<
  string,
  { tool: 'selection' | 'hand' | 'text' | 'rectangle' | 'ellipse' | 'freedraw' | 'eraser'; appState?: Record<string, unknown> }
> = {
  select: { tool: 'selection' },
  pan: { tool: 'hand' },
  text: { tool: 'text', appState: { currentItemOpacity: 100 } },
  rect: { tool: 'rectangle', appState: { currentItemBackgroundColor: 'transparent', currentItemOpacity: 100 } },
  shapes: { tool: 'ellipse', appState: { currentItemBackgroundColor: 'transparent', currentItemOpacity: 100 } },
  pen: { tool: 'freedraw', appState: { currentItemOpacity: 100, currentItemStrokeWidth: 1 } },
  highlighter: { tool: 'freedraw', appState: { currentItemOpacity: 35, currentItemStrokeWidth: 4 } },
  sticky: {
    tool: 'rectangle',
    appState: {
      currentItemBackgroundColor: '#fff3c4',
      currentItemFillStyle: 'solid',
      currentItemOpacity: 100,
    },
  },
  eraser: { tool: 'eraser' },
}

export interface StaadWhiteboardProps {
  sessionId: string
  role: 'therapist' | 'client'
  /** From the "Share Whiteboard?" choice. false -> nothing is synced. */
  isShared: boolean
  /** Therapist control lock, same flag every other module uses. */
  isLocked?: boolean
  selfName: string
  otherName: string
  onClose: () => void
  onFullscreen?: () => void
}

export default function StaadWhiteboard({
  sessionId,
  role,
  isShared,
  isLocked = false,
  selfName,
  otherName,
  onClose,
  onFullscreen,
}: StaadWhiteboardProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [activeTool, setActiveTool] = useState('select')
  const [activeColor, setActiveColor] = useState('#2b2f33')
  const [zoomPct, setZoomPct] = useState(100)

  // Scene fingerprint that local and remote are known to agree on. Guards the
  // write -> snapshot -> write feedback loop in both directions.
  const syncedVersionRef = useRef<number>(-1)
  // A remote scene that arrived before Excalidraw finished mounting.
  const pendingRemoteRef = useRef<readonly unknown[] | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // The client only draws when the therapist has released control.
  const canEdit = role === 'therapist' || !isLocked
  const viewModeEnabled = !canEdit

  const sessionRef = useMemo(() => doc(db, 'sessions', sessionId), [sessionId])

  /* ---------- outbound: local edits -> Firestore ---------- */
  const flush = useCallback(
    (elements: readonly unknown[]) => {
      const version = sceneVersion(elements as readonly WBElement[])
      syncedVersionRef.current = version
      updateDoc(sessionRef, {
        whiteboardElements: JSON.stringify(elements),
        whiteboardUpdatedBy: role,
        whiteboardUpdatedAt: new Date().toISOString(),
      }).catch(() => {
        // A failed write must not wedge the loop — allow a retry on next change.
        syncedVersionRef.current = -1
      })
    },
    [sessionRef, role]
  )

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: { zoom: { value: number } }) => {
      const pct = Math.round(appState.zoom.value * 100)
      setZoomPct((prev) => (prev === pct ? prev : pct))

      if (!isShared) {
        privateScenes.set(sessionId, elements)
        return
      }
      // Unchanged from what we last wrote or last applied: nothing to send.
      const version = sceneVersion(elements as readonly WBElement[])
      if (version === syncedVersionRef.current) return

      // Debounced so a single stroke is one write, not one per point.
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => flush(elements), 400)
    },
    [isShared, sessionId, flush]
  )

  /* ---------- inbound: Firestore -> local scene ---------- */
  const applyRemote = useCallback((elements: readonly unknown[]) => {
    const api = apiRef.current
    if (!api) {
      pendingRemoteRef.current = elements
      return
    }
    syncedVersionRef.current = sceneVersion(elements as readonly WBElement[])
    api.updateScene({
      elements: elements as never,
      // Remote updates must stay out of the local undo stack.
      captureUpdate: 'NEVER',
    })
  }, [])

  useEffect(() => {
    if (!isShared) return
    const unsub = onSnapshot(sessionRef, (snap) => {
      if (!snap.exists()) return
      const raw = snap.data()?.whiteboardElements
      if (typeof raw !== 'string') return
      let parsed: readonly unknown[]
      try {
        parsed = JSON.parse(raw)
      } catch {
        return
      }
      if (!Array.isArray(parsed)) return
      // Our own write coming back, or a scene we already have.
      if (sceneVersion(parsed as readonly WBElement[]) === syncedVersionRef.current) return
      applyRemote(parsed)
    })
    return () => unsub()
  }, [isShared, sessionRef, applyRemote])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  /* ---------- toolbar -> Excalidraw API ---------- */
  const selectTool = useCallback((id: string) => {
    const api = apiRef.current
    const mapped = TOOL_MAP[id]
    if (!api || !mapped) return
    setActiveTool(id)
    if (mapped.appState) {
      api.updateScene({ appState: mapped.appState as never, captureUpdate: 'NEVER' })
    }
    api.setActiveTool({ type: mapped.tool })
  }, [])

  const selectColor = useCallback((color: string) => {
    setActiveColor(color)
    apiRef.current?.updateScene({
      appState: { currentItemStrokeColor: color } as never,
      captureUpdate: 'NEVER',
    })
  }, [])

  const setZoom = useCallback((next: number) => {
    const api = apiRef.current
    if (!api) return
    const value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
    api.updateScene({ appState: { zoom: { value } } as never, captureUpdate: 'NEVER' })
    setZoomPct(Math.round(value * 100))
  }, [])

  const currentZoom = () => apiRef.current?.getAppState().zoom.value ?? 1

  // No undo()/redo() on the API — replay the shortcuts Excalidraw binds to its
  // own container. `bubbles` matters: React's listener sits at the root.
  const sendKey = useCallback((shiftKey: boolean) => {
    const target =
      containerRef.current?.querySelector('canvas') ??
      containerRef.current?.querySelector('.excalidraw') ??
      containerRef.current
    target?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey, bubbles: true })
    )
  }, [])

  const clearBoard = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    api.resetScene()
    syncedVersionRef.current = 0
    if (isShared) {
      clearTimeout(debounceRef.current)
      // Push the empty scene straight away so the other side clears too.
      updateDoc(sessionRef, {
        whiteboardElements: '[]',
        whiteboardUpdatedBy: role,
        whiteboardUpdatedAt: new Date().toISOString(),
      }).catch(() => {})
    } else {
      privateScenes.delete(sessionId)
    }
    setActiveTool('select')
  }, [isShared, sessionRef, role, sessionId])

  const statusChip = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 10px',
        borderRadius: 10,
        background: isShared ? RC.greenSoft : RC.tile,
        border: `1px solid ${isShared ? RC.green : RC.border}`,
        color: isShared ? RC.greenDark : RC.inkMuted,
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      {isShared ? <Users size={12} /> : <EyeOff size={12} />}
      {isShared ? 'Shared' : 'Private'}
    </div>
  )

  return (
    <WhiteboardStage
      selfName={selfName}
      otherName={otherName}
      onClose={onClose}
      activeTool={activeTool}
      onToolSelect={selectTool}
      activeColor={activeColor}
      onColorSelect={selectColor}
      onUndo={() => sendKey(false)}
      onRedo={() => sendKey(true)}
      onClear={clearBoard}
      zoom={zoomPct}
      onZoomIn={() => setZoom(currentZoom() + 0.25)}
      onZoomOut={() => setZoom(currentZoom() - 0.25)}
      onFullscreen={onFullscreen}
      canEdit={canEdit}
      statusChip={statusChip}
    >
      <style>{WB_CHROME_CSS}</style>
      <div ref={containerRef} className="staad-wb" style={{ position: 'absolute', inset: 0 }}>
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api
            // A private board reopening, or a remote scene that landed early.
            const initial = isShared ? pendingRemoteRef.current : privateScenes.get(sessionId)
            if (initial && initial.length) {
              api.updateScene({ elements: initial as never, captureUpdate: 'NEVER' })
              if (isShared) syncedVersionRef.current = sceneVersion(initial as readonly WBElement[])
            }
            pendingRemoteRef.current = null
          }}
          onChange={handleChange}
          viewModeEnabled={viewModeEnabled}
          /* Canvas stays light for legibility even though the room chrome is
             dark — matches the reference design. */
          theme="light"
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              toggleTheme: false,
            },
            tools: { image: false },
          }}
        />
      </div>
    </WhiteboardStage>
  )
}
