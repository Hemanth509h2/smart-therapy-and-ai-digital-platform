import { describe, it, expect } from 'vitest'
import {
  floatToPcm16, buildAudioMessage, parseSarvamMessage, buildCaptionAttributes,
  shouldShowCaption, STT_STREAM_PARAMS,
} from './sarvam'

describe('audio encoding', () => {
  it('encodes float samples as little-endian signed 16-bit PCM, clamped', () => {
    const b = floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))
    const v = new DataView(b.buffer)
    expect(b.length).toBe(12)
    expect([0, 1, 2, 3, 4, 5].map((i) => v.getInt16(i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768, 16383])
    expect(b[2]).toBe(0xff)
    expect(b[3]).toBe(0x7f) // 32767 little-endian
  })
  it('builds the documented envelope and declares pcm via query params', () => {
    const m = JSON.parse(buildAudioMessage(new Float32Array([0, 0.5])))
    expect(m.audio.sample_rate).toBe('16000')
    expect(m.audio.encoding).toBe('audio/wav')
    expect(Buffer.from(m.audio.data, 'base64').length).toBe(4)
    expect(STT_STREAM_PARAMS.input_audio_codec).toBe('pcm_s16le')
    expect(STT_STREAM_PARAMS.sample_rate).toBe('16000')
  })
})

describe('parseSarvamMessage', () => {
  it('parses transcripts', () => {
    expect(parseSarvamMessage(JSON.stringify({ type: 'data', data: { request_id: 'r1', transcript: ' hello ' } })))
      .toEqual({ kind: 'transcript', text: 'hello', requestId: 'r1' })
  })
  it('parses VAD events and errors; never treats errors as speech', () => {
    expect(parseSarvamMessage(JSON.stringify({ type: 'events', data: { signal_type: 'START_SPEECH' } })))
      .toEqual({ kind: 'speech', signal: 'START_SPEECH' })
    expect(parseSarvamMessage(JSON.stringify({ type: 'error', data: { error: 'bad', code: '400' } })))
      .toEqual({ kind: 'error', message: 'bad', code: '400' })
  })
  it('ignores empty, malformed, binary and unknown frames', () => {
    const raws: unknown[] = ['', 'not json', '{"type":"data","data":{"transcript":"  "}}', '{"type":"x"}', '{"type":"data"}', 'null', new ArrayBuffer(2)]
    for (const raw of raws) expect(parseSarvamMessage(raw)).toEqual({ kind: 'ignore' })
  })
})

describe('caption attributes / filtering', () => {
  const attrs = buildCaptionAttributes('therapist', 'hello', 'seg1')
  it('matches the overlay filter and sets LiveKit keys', () => {
    expect(attrs['staad.kind']).toBe('translation')
    expect(attrs['lk.segment_id']).toBe('seg1')
    expect(Object.values(attrs).every((v) => typeof v === 'string')).toBe(true)
    expect(shouldShowCaption(true, { text: 'hello', attributes: attrs })).toBe(true)
  })
  it('hides when disabled, empty, or other kind', () => {
    expect(shouldShowCaption(false, { text: 'hello', attributes: attrs })).toBe(false)
    expect(shouldShowCaption(true, { text: '  ', attributes: attrs })).toBe(false)
    expect(shouldShowCaption(true, { text: 'x', attributes: { 'staad.kind': 'original' } })).toBe(false)
  })
})
