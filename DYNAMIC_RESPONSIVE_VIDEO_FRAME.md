# Dynamic Responsive Video Frame Resizing Algorithm

**Location:** `frontend/src/lib/video-frame.ts`  
**Hook:** `frontend/src/hooks/useResponsiveVideoFrame.ts`

---

## Overview

This algorithm ensures video frames in the STAAD platform automatically adapt to any screen size while preserving video proportions and giving developers control over how video fits inside the frame.

---

## Five Core Properties

| # | Property | Implementation |
|---|----------|----------------|
| 1 | **Responsive Design** | Frames derive size from live container/viewport via `ResizeObserver`, never fixed px |
| 2 | **Dynamic/Automatic Resizing** | Width & height recompute on every layout change (window resize, panel open/close, fullscreen toggle) |
| 3 | **Aspect Ratio Preservation** | One dimension drives the other through fixed ratio (16:9 for video, 5:3 for tiles) |
| 4 | **object-fit: cover / contain** | `cover` fills frame (crops), `contain` letterboxes (never crops) — controlled per component |
| 5 | **Viewport-based sizing** | Pure CSS fallback uses `min()/max()/vw/vh` so frames adapt even before JS measures |

---

## API Reference

### Constants

```ts
export const VIDEO_ASPECT = 16 / 9   // LiveKit capture 1280×720
export const TILE_ASPECT = 5 / 3     // Popup tiles — height = width × 0.6
```

### Core Functions

#### `resolveFrame(available, constraints)`
Main entry point. Returns the final frame `{ width, height }`.

```ts
interface FrameConstraints {
  aspect?: number        // default VIDEO_ASPECT
  fit?: 'cover' | 'contain'
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

const frame = resolveFrame(
  { width: containerWidth, height: containerHeight },
  { aspect: TILE_ASPECT, fit: 'cover', minWidth: 140, maxWidth: 640 }
)
```

- `fit: 'contain'` (default): frame = largest aspect-correct rect inside available space
- `fit: 'cover'`: frame = available box exactly; video crops via `object-fit: cover`

#### `viewportFrameCss(opts)`
Generates pure-CSS responsive frame that works **without JS**.

```ts
viewportFrameCss({
  maxWidth: 200,        // design width cap
  aspect: 5 / 3,        // 5:3 tiles
  gutter: '2rem',       // viewport breathing room
  minHeight: 100
})

// Returns:
{
  width: 'min(200px, calc(100vw - 2rem))',
  aspectRatio: '1.666...',  // 5/3
  height: 'auto',
  maxWidth: '100%'
}
```

#### `aspectRatioCss(width, height)`
Returns CSS `aspect-ratio` string from numbers: `'16 / 9'`.

---

## Component Integration

### 1. `LocalVideoPip` — Self-view (PiP + Popup tiles)

**Before:** Fixed `width`/`height` props, manual `aspect-ratio` in JS.

**After:** Uses `viewportFrameCss` for docked tiles, responsive `min()` for floating PiP.

```tsx
// Popup tile (docked)
const pipStyle = viewportFrameCss({
  maxWidth: width,      // 200 design, scales down on mobile
  aspect: TILE_ASPECT,  // 5:3
  gutter: '2rem',
  minHeight: 100
})

// Floating PiP over main video
const pipStyle = {
  width: `min(${width}px, 30vw)`,
  aspectRatio: aspectRatioCss(width, height),
  maxWidth: '100%',
}
```

- **Responsive**: Shrinks on narrow viewports, never exceeds design width
- **Aspect preserved**: `aspect-ratio` CSS keeps 5:3 automatically
- **object-fit: contain**: Whole self-view visible, letterboxed if needed

### 2. `RemoteVideoArea` — Main video + thumbnails

**Before:** `objectFit: 'cover'` hardcoded, no aspect-ratio hint.

**After:** Explicit `aspect-ratio: 16 / 9` + `object-fit: cover`.

```tsx
const videoStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  aspectRatio: aspectRatioCss(16, 9),
}
```

- **Responsive**: Fills the green rounded card edge-to-edge
- **Aspect preserved**: Container keeps 16:9; video crops to fill (`cover`)
- **Dynamic**: Card flex-fills available space; video always fills card

### 3. Participant Popup Tiles (Doctor & Client)

**Doctor side:** Own video fixed (200×120), **client's video resizable** (140–640px width).

**Client side:** Own video fixed (200×120), **doctor's video resizable** (140–640px width).

Both now use `LocalVideoPip` (docked) with `viewportFrameCss` for the fixed tile, and `RemoteParticipantThumb` receives dynamic `width`/`height` from the drag state.

**Automatic viewport clamp on window resize** (added in resize effect):
```ts
useEffect(() => {
  if (!showParticipants) return
  const onResize = () => setParticipantsPos(p => p ? clampToViewport(p.x, p.y) : p)
  window.addEventListener('resize', onResize)
  // NEW: also clamp tile width so popup never overflows viewport
  const onResize2 = () => setParticipantTileW(w => Math.min(w, innerWidth - 40))
  window.addEventListener('resize', onResize2)
  return () => { window.removeEventListener('resize', onResize); window.removeEventListener('resize', onResize2) }
}, [showParticipants])
```

---

## Usage in New Components

```tsx
import { useResponsiveVideoFrame, VIDEO_ASPECT } from '@/hooks/useResponsiveVideoFrame'
import { resolveFrame, TILE_ASPECT } from '@/lib/video-frame'

function MyVideoTile({ designWidth = 200 }) {
  // Option A: Hook (measures container, computes frame)
  const { ref, frame } = useResponsiveVideoFrame({
    aspect: TILE_ASPECT,
    fit: 'cover',
    minWidth: 140,
    maxWidth: 640
  })

  return (
    <div ref={ref} style={{ width: frame.width, height: frame.height }}>
      <VideoTrack style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  )
}

function MyResponsiveVideo() {
  // Option B: Pure CSS (no measurement needed)
  return (
    <div style={viewportFrameCss({ maxWidth: 320, aspect: VIDEO_ASPECT, gutter: '1rem' })}>
      <VideoTrack style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  )
}
```

---

## Migration Notes

| Old Pattern | New Pattern |
|-------------|-------------|
| `width={200} height={120}` on tile | `viewportFrameCss({ maxWidth: 200, aspect: 5/3 })` |
| `style={{ width: '100%', height: '100%', objectFit: 'cover' }}` | Add `aspectRatio: '16 / 9'` to container |
| Manual `Math.round(w * 0.6)` for height | `aspectRatio` CSS or `resolveFrame()` |
| No resize handling | `ResizeObserver` via `useResponsiveVideoFrame` or viewport CSS |

---

## Testing Checklist

- [ ] Popup tiles shrink on mobile viewport (< 400px)
- [ ] Floating PiP scales with `30vw` cap on desktop
- [ ] Main video card fills available space, keeps 16:9
- [ ] Doctor drag-resize clamps to viewport edges
- [ ] Client drag-resize clamps to viewport edges
- [ ] Window resize → popup reposition + tile clamp
- [ ] `object-fit: contain` on self-view shows whole face
- [ ] `object-fit: cover` on main video fills rounded card