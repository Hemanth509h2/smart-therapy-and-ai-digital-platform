// Pure helpers for the Sarvam streaming STT protocol (wss://api.sarvam.ai/speech-to-text/ws).
// Kept free of React/DOM so they can be unit-tested.
//
// Protocol (docs.sarvam.ai, legacy/speech-to-text/transcribe/ws):
//   - Raw PCM is declared with the connection query param `input_audio_codec=pcm_s16le`
//     plus `sample_rate=16000`. The per-message `encoding` field only accepts
//     "audio/wav" and is a fixed envelope value — it does NOT describe the bytes.
//   - Client audio message: { audio: { data: <base64>, sample_rate: "16000", encoding: "audio/wav" } }
//   - Server messages: { type: "data" | "events" | "error", data: {...} }

export const STT_SAMPLE_RATE = 16000
export const STT_INPUT_CODEC = 'pcm_s16le'
export const STT_MODEL = 'saaras:v3'
export const STT_MODE = 'translate'

/** Query params shared by the browser URL and (via an allow-list) the backend proxy. */
export const STT_STREAM_PARAMS: Record<string, string> = {
  model: STT_MODEL,
  mode: STT_MODE,
  sample_rate: String(STT_SAMPLE_RATE),
  input_audio_codec: STT_INPUT_CODEC,
  high_vad_sensitivity: 'true',
  vad_signals: 'true',
}

/** Float32 [-1, 1] -> signed 16-bit little-endian PCM bytes. */
export function floatToPcm16(float32: Float32Array): Uint8Array {
  const out = new Uint8Array(float32.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const block = 0x8000
  for (let i = 0; i < bytes.length; i += block) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + block) as unknown as number[])
  }
  return btoa(binary)
}

export function buildAudioMessage(float32: Float32Array): string {
  return JSON.stringify({
    audio: {
      data: bytesToBase64(floatToPcm16(float32)),
      sample_rate: String(STT_SAMPLE_RATE),
      encoding: 'audio/wav',
    },
  })
}

export type SarvamMessage =
  | { kind: 'transcript'; text: string; requestId?: string }
  | { kind: 'speech'; signal: 'START_SPEECH' | 'END_SPEECH' }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'ignore' }

/** Parse one server frame. Never throws; anything unrecognised is 'ignore'. */
export function parseSarvamMessage(raw: unknown): SarvamMessage {
  if (typeof raw !== 'string') return { kind: 'ignore' }
  let msg: any
  try {
    msg = JSON.parse(raw)
  } catch {
    return { kind: 'ignore' }
  }
  if (!msg || typeof msg !== 'object') return { kind: 'ignore' }
  const data = msg.data
  switch (msg.type) {
    case 'data': {
      const text = typeof data?.transcript === 'string' ? data.transcript.trim() : ''
      if (!text) return { kind: 'ignore' }
      return {
        kind: 'transcript',
        text,
        requestId: typeof data.request_id === 'string' ? data.request_id : undefined,
      }
    }
    case 'events': {
      const s = data?.signal_type
      return s === 'START_SPEECH' || s === 'END_SPEECH' ? { kind: 'speech', signal: s } : { kind: 'ignore' }
    }
    case 'error':
      return {
        kind: 'error',
        message: typeof data?.error === 'string' ? data.error : 'Transcription service error',
        code: typeof data?.code === 'string' ? data.code : undefined,
      }
    default:
      return { kind: 'ignore' }
  }
}

/** LiveKit text-stream attributes. `staad.kind` must stay 'translation' (CaptionOverlay filters on it). */
export function buildCaptionAttributes(
  speaker: string,
  original: string,
  segmentId: string,
): Record<string, string> {
  return {
    'lk.segment_id': segmentId,
    'lk.transcription_final': 'true',
    'staad.kind': 'translation',
    'staad.speaker_identity': speaker,
    // Output is English (translate mode); the source language is auto-detected
    // by Sarvam and not known here, so it is deliberately not set.
    'staad.target_language': 'en',
    'staad.original_text': original,
    'staad.source': 'sarvam-browser',
  }
}

/** Mirrors the acceptance rule in CaptionOverlay so it can be tested without React. */
export function shouldShowCaption(
  enabled: boolean,
  payload: { text: string; attributes: Record<string, string> },
): boolean {
  return enabled && !!payload.text.trim() && payload.attributes?.['staad.kind'] === 'translation'
}
