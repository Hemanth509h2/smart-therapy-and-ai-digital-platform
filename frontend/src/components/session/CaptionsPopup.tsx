'use client'

// Floating, draggable card listing every caption stored for this session (see
// lib/captionLog.ts). Same chrome as the AI Assistant / AI Notes popups.

import { Captions, Copy, Download, GripHorizontal, Subtitles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { GLASS } from './roomTheme'
import { useCaptionLog, type StoredCaption } from '@/lib/captionLog'
import TranslationControl from './TranslationControl'
import { OnOffButton } from '@/components/ui/on-off-button'
import type { TranslationSettings } from '@/lib/translation'

interface CaptionsPopupProps {
  sessionId: string
  live: boolean
  translation: TranslationSettings
  onTranslationChange: (patch: Partial<TranslationSettings>) => void
  /** Subtitle bar at the bottom of the video, on both the therapist's and the client's screen. */
  liveOnVideo: boolean
  onLiveOnVideoChange: (on: boolean) => void
  onClose: () => void
  initialPosition?: { x: number; y: number }
}

const speakerLabel = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Speaker')
const clock = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const asText = (captions: StoredCaption[]) =>
  captions.map((c) => `[${clock(c.at)}] ${speakerLabel(c.speaker)}: ${c.text}`).join('\n')

export default function CaptionsPopup({
  sessionId,
  live,
  translation,
  onTranslationChange,
  liveOnVideo,
  onLiveOnVideoChange,
  onClose,
  initialPosition = { x: 460, y: 160 },
}: CaptionsPopupProps) {
  const { captions, error } = useCaptionLog(sessionId)
  const [showOriginal, setShowOriginal] = useState(false)
  const [copied, setCopied] = useState(false)

  const [position, setPosition] = useState(initialPosition)
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const [size, setSize] = useState({ width: 380, height: 520 })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 380, h: 520 })

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y })
      }
      if (isResizing) {
        const dx = e.clientX - resizeStart.current.x
        const dy = e.clientY - resizeStart.current.y
        setSize({
          width: Math.max(300, Math.min(640, resizeStart.current.w + dx)),
          height: Math.max(250, Math.min(800, resizeStart.current.h + dy)),
        })
      }
    }
    const handleUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging, isResizing])

  const handleDragStart = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button, select, input, label') || target.closest('[data-resize-handle]') || target.closest('[data-scroll]')) return
    setIsDragging(true)
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsResizing(true)
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.width, h: size.height }
  }

  // Follow new captions, unless the therapist has scrolled up to read.
  const listRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)
  useEffect(() => {
    const el = listRef.current
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight
  }, [captions.length])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText(captions))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked */
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([asText(captions)], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `session-${sessionId.slice(0, 8)}-captions.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toolButton: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    borderRadius: 10,
    border: `1px solid ${GLASS.fillBorder}`,
    background: GLASS.fill,
    color: GLASS.inkMuted,
    fontSize: 10,
    fontWeight: 600,
    cursor: captions.length ? 'pointer' : 'not-allowed',
    opacity: captions.length ? 1 : 0.45,
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 50,
        width: size.width,
        height: size.height,
        minHeight: 200,
        maxHeight: 'calc(100vh - 40px)',
        background: 'rgba(28, 28, 28, 0.95)',
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        border: `1px solid ${GLASS.border}`,
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onMouseDown={handleDragStart}
    >
      {/* Header / drag handle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: `1px solid ${GLASS.border}`,
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Captions size={15} color={GLASS.accent} />
          <span style={{ fontSize: 14, fontWeight: 600, color: GLASS.ink }}>Captions</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 8px',
              borderRadius: 20,
              background: live ? 'rgba(76,175,134,0.18)' : GLASS.fill,
              border: `1px solid ${live ? 'rgba(76,175,134,0.45)' : GLASS.fillBorder}`,
              fontSize: 9,
              fontWeight: 600,
              color: live ? '#4caf86' : GLASS.inkFaint,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: live ? '#4caf86' : GLASS.inkFaint,
                animation: live ? 'pulse 1.4s ease infinite' : 'none',
              }}
            />
            {live ? 'Live' : 'Off'}
          </span>
          <span style={{ fontSize: 10, color: GLASS.inkFaint }}>{captions.length} lines</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GripHorizontal size={14} color={GLASS.inkMuted} style={{ cursor: 'grab' }} />
          <button onClick={onClose} title="Close" style={{ background: 'transparent', border: 'none', color: GLASS.inkMuted, cursor: 'pointer', padding: 4, display: 'flex' }}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Translation settings (moved here from the top bar) */}
      <div style={{ padding: '12px 14px 0' }}>
        <TranslationControl settings={translation} onChange={onTranslationChange} />
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 12,
            background: liveOnVideo ? 'rgba(76,175,134,0.14)' : GLASS.fill,
            border: `1px solid ${liveOnVideo ? 'rgba(76,175,134,0.45)' : GLASS.fillBorder}`,
          }}
        >
          <Subtitles size={14} color={liveOnVideo ? '#4caf86' : GLASS.accent} />
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: GLASS.ink }}>Live captions on video</span>
            <span style={{ fontSize: 10, color: GLASS.inkFaint }}>Subtitles at the bottom of the call, for you and the client</span>
          </span>
          <OnOffButton on={liveOnVideo} onChange={onLiveOnVideoChange} label="Live captions on video" />
        </div>
      </div>

      {/* Caption list */}
      <div
        ref={listRef}
        data-scroll
        onScroll={(e) => {
          const el = e.currentTarget
          pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {error ? (
          <p style={{ fontSize: 11, color: '#E8897A', textAlign: 'center', marginTop: 24 }}>{error}</p>
        ) : captions.length === 0 ? (
          <p style={{ fontSize: 11, color: GLASS.inkMuted, textAlign: 'center', lineHeight: 1.6, marginTop: 24 }}>
            No captions yet. Captions appear here as people speak, once transcription or translated captions are on.
          </p>
        ) : (
          captions.map((c) => {
            const isClient = c.speaker.toLowerCase() === 'client'
            return (
              <div
                key={c.id}
                style={{
                  background: GLASS.fill,
                  border: `1px solid ${GLASS.fillBorder}`,
                  borderRadius: 12,
                  padding: '8px 11px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: isClient ? '#E8C27A' : GLASS.accent }}>
                    {speakerLabel(c.speaker)}
                  </span>
                  <span style={{ fontSize: 10, color: GLASS.inkFaint }}>{clock(c.at)}</span>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: GLASS.ink }}>{c.text}</div>
                {showOriginal && c.original && c.original !== c.text && (
                  <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${GLASS.fillBorder}`, fontSize: 11, lineHeight: 1.45, color: GLASS.inkMuted }}>
                    {c.original}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderTop: `1px solid ${GLASS.border}` }}>
        <button onClick={() => setShowOriginal((v) => !v)} style={{ ...toolButton, cursor: 'pointer', opacity: 1 }}>
          {showOriginal ? 'Hide original' : 'Show original'}
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={copy} disabled={!captions.length} style={toolButton}>
          <Copy size={11} /> {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={download} disabled={!captions.length} style={toolButton}>
          <Download size={11} /> Download
        </button>
      </div>

      {/* Resize handle — bottom-right corner */}
      <div
        data-resize-handle
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
          zIndex: 10,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'flex-end',
          padding: 4,
          color: GLASS.inkMuted,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ display: 'block', opacity: 0.5 }}>
          <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}
