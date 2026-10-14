'use client'

// Stored captions for a session.
//
// Live captions (Sarvam in the browser, or the translation agent) used to exist
// only on screen for a few seconds. The therapist's browser now also appends
// each finished caption to `sessions/{id}.captions`, the same doc that holds
// the transcript, so the Captions popup can show the whole conversation and it
// survives a reload. `transcriptLastUpdated` is bumped too, so the retention
// cron (api/cleanup-transcripts) clears captions along with the transcript.

import { useEffect, useState } from 'react'
import { arrayUnion, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export interface StoredCaption {
  /** lk.segment_id — one per utterance. */
  id: string
  speaker: string
  text: string
  /** Source-language text when the caption is a translation; '' otherwise. */
  original: string
  at: number
}

const saved = new Set<string>()

/** Append one caption. Each segment is written once per page load. */
export async function saveCaption(sessionId: string, caption: StoredCaption): Promise<void> {
  const key = `${sessionId}:${caption.id}`
  if (!sessionId || saved.has(key)) return
  saved.add(key)
  try {
    await updateDoc(doc(db, 'sessions', sessionId), {
      captions: arrayUnion(caption),
      transcriptLastUpdated: serverTimestamp(),
    })
  } catch (e) {
    saved.delete(key)
    console.warn('[Captions] Could not store caption:', e)
  }
}

function parse(raw: unknown): StoredCaption[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map<string, StoredCaption>()
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const c = r as Record<string, unknown>
    if (typeof c.text !== 'string' || !c.text.trim()) continue
    const id = String(c.id ?? `${c.at}`)
    byId.set(id, {
      id,
      speaker: String(c.speaker ?? 'Speaker'),
      text: c.text,
      original: typeof c.original === 'string' ? c.original : '',
      at: Number(c.at) || 0,
    })
  }
  return Array.from(byId.values()).sort((a, b) => a.at - b.at)
}

/** Every stored caption for the session, oldest first, kept live. */
export function useCaptionLog(sessionId: string): { captions: StoredCaption[]; error: string } {
  const [captions, setCaptions] = useState<StoredCaption[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sessionId) return
    return onSnapshot(
      doc(db, 'sessions', sessionId),
      (snap) => {
        setError('')
        setCaptions(parse(snap.data()?.captions))
      },
      () => setError('Could not load captions.')
    )
  }, [sessionId])

  return { captions, error }
}
