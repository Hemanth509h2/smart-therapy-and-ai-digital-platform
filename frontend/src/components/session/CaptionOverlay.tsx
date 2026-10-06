'use client'

// Live translated captions.
//
// The translation agent publishes each finished utterance on LiveKit's standard
// `lk.transcription` text-stream topic. Two messages arrive per utterance,
// sharing a segment id:
//
//   staad.kind = "translation"  the caption in the reader's language
//   staad.kind = "original"     the source-language transcript, kept for records
//
// This renders the translation and keeps the original available underneath, so
// a therapist can check what was actually said when a translation reads oddly.
//
// Must be mounted INSIDE <StaadVideo> — it reads the LiveKit room from context.

import { useEffect, useRef, useState } from 'react'
import { useSessionRoom } from '@/components/StaadVideo'
import { RC } from '@/components/session/roomTheme'
import { languageLabel } from '@/lib/translationLanguages'

const TRANSCRIPTION_TOPIC = 'lk.transcription'
/** Captions older than this fade out, so stale text does not linger on screen. */
const CAPTION_TTL_MS = 12_000
const MAX_VISIBLE = 3

interface Caption {
  segmentId: string
  speaker: string
  text: string
  original: string
  sourceLang: string
  targetLang: string
  at: number
}

interface CaptionPayload {
  text: string
  attributes: Record<string, string>
}

export default function CaptionOverlay({ enabled }: { enabled: boolean }) {
  const { room } = useSessionRoom()
  const [captions, setCaptions] = useState<Caption[]>([])
  const [showOriginal, setShowOriginal] = useState(false)
  // Read inside the stream handler, which is registered once and must not be
  // torn down every time this flag flips.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const addCaption = (payload: CaptionPayload) => {
    const text = payload.text.trim()
    if (!enabledRef.current || !text) return

    const attrs = payload.attributes
    if (attrs['staad.kind'] !== 'translation') return

    const caption: Caption = {
      segmentId: attrs['lk.segment_id'] || `${Date.now()}`,
      speaker: attrs['staad.speaker_identity'] || 'Speaker',
      text,
      original: attrs['staad.original_text'] || '',
      sourceLang: attrs['staad.source_language'] || '',
      targetLang: attrs['staad.target_language'] || '',
      at: Date.now(),
    }

    setCaptions((prev) => {
      // Re-publishing the same segment replaces rather than stacks.
      const withoutDupe = prev.filter((c) => c.segmentId !== caption.segmentId)
      return [...withoutDupe, caption].slice(-MAX_VISIBLE)
    })
  }

  useEffect(() => {
    const onLocalCaption = (event: Event) => {
      const detail = (event as CustomEvent<CaptionPayload>).detail
      if (detail) addCaption(detail)
    }
    window.addEventListener('staad:caption', onLocalCaption)
    return () => window.removeEventListener('staad:caption', onLocalCaption)
  }, [])

  useEffect(() => {
    if (!room) return

    let cancelled = false

    const handler = async (reader: { readAll: () => Promise<string>; info: { attributes?: Record<string, string> } }) => {
      try {
        const text = (await reader.readAll())?.trim()
        if (cancelled || !enabledRef.current || !text) return

        const attrs = reader.info.attributes ?? {}
        addCaption({ text, attributes: attrs })
      } catch {
        // A malformed stream must not take the session room down.
      }
    }

    try {
      room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, handler as never)
    } catch {
      // Another handler is already registered for this topic (e.g. a second
      // mount during fast refresh). Nothing to do.
    }

    return () => {
      cancelled = true
      try {
        room.unregisterTextStreamHandler(TRANSCRIPTION_TOPIC)
      } catch {
        /* already gone */
      }
    }
  }, [room])

  // Expire old captions.
  useEffect(() => {
    if (captions.length === 0) return
    const timer = setInterval(() => {
      const cutoff = Date.now() - CAPTION_TTL_MS
      setCaptions((prev) => prev.filter((c) => c.at > cutoff))
    }, 1000)
    return () => clearInterval(timer)
  }, [captions.length])

  if (!enabled || captions.length === 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
        zIndex: 60,
        width: 'min(92%, 720px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {captions.map((caption, index) => {
        const isLatest = index === captions.length - 1
        return (
          <div
            key={caption.segmentId}
            style={{
              background: 'rgba(16,24,20,0.86)',
              backdropFilter: 'blur(8px)',
              borderRadius: 14,
              border: `1px solid ${isLatest ? RC.green : 'rgba(255,255,255,0.14)'}`,
              padding: '10px 14px',
              opacity: isLatest ? 1 : 0.55,
              transition: 'opacity 0.3s',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 4,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.3,
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.55)',
              }}
            >
              <span>{caption.speaker}</span>
              {caption.sourceLang && caption.targetLang && (
                <span>
                  {languageLabel(caption.sourceLang)} → {languageLabel(caption.targetLang)}
                </span>
              )}
            </div>

            {/* White on a near-opaque dark plate: legible over any video frame. */}
            <div style={{ fontSize: 16, lineHeight: 1.45, color: '#ffffff', fontWeight: 500 }}>
              {caption.text}
            </div>

            {showOriginal && caption.original && (
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: '1px solid rgba(255,255,255,0.14)',
                  fontSize: 13,
                  lineHeight: 1.4,
                  color: 'rgba(255,255,255,0.62)',
                }}
              >
                {caption.original}
              </div>
            )}
          </div>
        )
      })}

      <button
        onClick={() => setShowOriginal((v) => !v)}
        style={{
          alignSelf: 'center',
          pointerEvents: 'auto',
          padding: '4px 12px',
          borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(16,24,20,0.86)',
          color: 'rgba(255,255,255,0.75)',
          fontSize: 10,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {showOriginal ? 'Hide original' : 'Show original'}
      </button>
    </div>
  )
}
