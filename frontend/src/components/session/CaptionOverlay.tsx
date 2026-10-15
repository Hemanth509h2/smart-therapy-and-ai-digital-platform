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
import { shouldShowCaption } from '@/lib/stt/sarvam'
import { saveCaption } from '@/lib/captionLog'

const TRANSCRIPTION_TOPIC = 'lk.transcription'
/** Captions older than this fade out, so stale text does not linger on screen. */
const CAPTION_TTL_MS = 12_000
/** The latest line plus the one before it, subtitle style. */
const MAX_VISIBLE = 2

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

export default function CaptionOverlay({
  enabled,
  sessionId,
  store = false,
  visible = true,
  viewerRole,
}: {
  enabled: boolean
  sessionId?: string
  /** Also append each caption to the session record (therapist browser only). */
  store?: boolean
  /** false = collect/store only, draw nothing (the therapist reads the Captions popup). */
  visible?: boolean
  /** Lets the viewer's own lines read "You". */
  viewerRole?: 'therapist' | 'client'
}) {
  const { room } = useSessionRoom()
  const [captions, setCaptions] = useState<Caption[]>([])
  const [showOriginal, setShowOriginal] = useState(false)
  // Read inside the stream handler, which is registered once and must not be
  // torn down every time this flag flips.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const storeRef = useRef({ store, sessionId })
  storeRef.current = { store, sessionId }

  const addCaption = (payload: CaptionPayload) => {
    const text = payload.text.trim()
    const attrs = payload.attributes ?? {}
    if (!shouldShowCaption(enabledRef.current, { text, attributes: attrs })) return

    const caption: Caption = {
      segmentId: attrs['lk.segment_id'] || `${Date.now()}`,
      speaker: attrs['staad.speaker_identity'] || 'Speaker',
      text,
      original: attrs['staad.original_text'] || '',
      sourceLang: attrs['staad.source_language'] || '',
      targetLang: attrs['staad.target_language'] || '',
      at: Date.now(),
    }

    if (storeRef.current.store && storeRef.current.sessionId) {
      saveCaption(storeRef.current.sessionId, {
        id: caption.segmentId,
        speaker: caption.speaker,
        text: caption.text,
        original: caption.original,
        at: caption.at,
      })
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

  if (!visible || !enabled || captions.length === 0) return null

  const label = (speaker: string) => {
    const role = speaker.toLowerCase()
    if (viewerRole && role === viewerRole) return 'You'
    if (role === 'therapist') return 'Therapist'
    if (role === 'client') return 'Client'
    return speaker
  }
  // Sarvam's browser captions carry the same text as "original"; only offer the
  // toggle when a caption really has a different source-language line.
  const hasOriginals = captions.some((c) => c.original && c.original !== c.text)

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        // Clears the floating call controls at the bottom of the client view.
        bottom: 112,
        transform: 'translateX(-50%)',
        zIndex: 60,
        width: 'min(92%, 680px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {/* One subtitle plate: the latest line, with the previous one dimmed above it. */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '12px 18px',
          borderRadius: 14,
          background: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          boxShadow: '0 6px 24px rgba(0,0,0,0.3)',
        }}
      >
        {captions.map((caption, index) => {
          const isLatest = index === captions.length - 1
          const who = label(caption.speaker)
          return (
            <div
              key={caption.segmentId}
              style={{
                fontSize: isLatest ? 18 : 14.5,
                lineHeight: 1.45,
                fontWeight: isLatest ? 500 : 400,
                color: isLatest ? '#ffffff' : 'rgba(255,255,255,0.55)',
                transition: 'font-size 0.25s, color 0.25s',
                animation: isLatest ? 'captionIn 0.25s ease-out' : undefined,
              }}
            >
              <span
                style={{
                  marginRight: 8,
                  fontSize: isLatest ? 13 : 12,
                  fontWeight: 700,
                  color: who === 'You' ? '#7FD3A6' : '#F0C878',
                  opacity: isLatest ? 1 : 0.7,
                }}
              >
                {who}
              </span>
              {caption.text}
              {showOriginal && caption.original && caption.original !== caption.text && (
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontStyle: 'italic', marginTop: 2 }}>
                  {caption.original}
                  {caption.sourceLang && ` (${languageLabel(caption.sourceLang)})`}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {hasOriginals && (
        <button
          onClick={() => setShowOriginal((v) => !v)}
          style={{
            pointerEvents: 'auto',
            padding: '3px 10px',
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(12,16,14,0.7)',
            color: 'rgba(255,255,255,0.75)',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {showOriginal ? 'Hide original' : 'Show original'}
        </button>
      )}

      <style>{`
        @keyframes captionIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  )
}
