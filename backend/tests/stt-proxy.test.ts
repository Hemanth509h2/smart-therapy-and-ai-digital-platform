// Mocked integration tests for the STT proxy. A local WebSocket server stands in
// for Sarvam (via SARVAM_WS_URL); no real credentials or network are used.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createRequire } from 'module'
import { createHmac } from 'crypto'
import http from 'http'
import type { AddressInfo } from 'net'

const require = createRequire(import.meta.url)
const { WebSocketServer, WebSocket } = require('ws')
const { handleProxyConnection, verifySttToken, upstreamUrl } = require('../stt-proxy')

const SECRET = 'test-secret'
const mint = (sid: string, expSec = Math.floor(Date.now() / 1000) + 60, secret = SECRET) => {
  const p = Buffer.from(JSON.stringify({ sid, exp: expSec })).toString('base64url')
  return `${p}.${createHmac('sha256', secret).update(p).digest('base64url')}`
}

let proxy: any
let upstream: any
let upstreamHttp: http.Server | null = null
const env = { ...process.env }
afterEach(() => {
  proxy?.close()
  upstream?.close()
  upstreamHttp?.close()
  upstreamHttp = null
  process.env = { ...env }
})
beforeEach(() => {
  process.env = { ...env }
  delete process.env.STT_TOKEN_SECRET
})

async function startProxy() {
  const wss = new WebSocketServer({ port: 0 })
  wss.on('connection', (ws: any, req: any) =>
    handleProxyConnection(ws, new URL(req.url, 'http://x').searchParams))
  proxy = wss
  await new Promise((r) => wss.on('listening', r))
  return (wss.address() as AddressInfo).port
}
const closeInfo = (ws: any) =>
  new Promise<{ code: number; reason: string }>((r) =>
    ws.on('close', (code: number, reason: Buffer) => r({ code, reason: reason.toString() })))

describe('upstreamUrl', () => {
  it('forwards codec and sample rate, drops unknown/unsafe params', () => {
    const q = new URLSearchParams('model=saaras:v3&mode=translate&sample_rate=16000&input_audio_codec=pcm_s16le&sid=abc&token=zzz&language_code=a%26b')
    const url = upstreamUrl(q)
    expect(url).toContain('input_audio_codec=pcm_s16le')
    expect(url).toContain('sample_rate=16000')
    expect(url).not.toContain('token')
    expect(url).not.toContain('sid=')
    expect(url).not.toContain('language_code')
  })
})

describe('verifySttToken', () => {
  it('accepts valid, rejects wrong sid / expired / bad signature', () => {
    expect(verifySttToken(mint('s1'), 's1', SECRET)).toBe(true)
    expect(verifySttToken(mint('s1'), 's2', SECRET)).toBe(false)
    expect(verifySttToken(mint('s1', 1), 's1', SECRET)).toBe(false)
    expect(verifySttToken(mint('s1', undefined, 'other'), 's1', SECRET)).toBe(false)
    expect(verifySttToken('garbage', 's1', SECRET)).toBe(false)
  })
})

describe('proxy', () => {
  it('closes with "STT not configured" when the key is missing', async () => {
    delete process.env.SARVAM_API_KEY
    const port = await startProxy()
    const c = new WebSocket(`ws://127.0.0.1:${port}/?sid=s`)
    expect(await closeInfo(c)).toEqual({ code: 1011, reason: 'STT not configured' })
  })

  it('relays queued audio upstream with the key header and messages back', async () => {
    process.env.SARVAM_API_KEY = 'dummy-not-real'
    let seenHeader = ''
    let seenUrl = ''
    const got: string[] = []
    upstream = new WebSocketServer({ port: 0 })
    upstream.on('connection', (ws: any, req: any) => {
      seenHeader = req.headers['api-subscription-key']
      seenUrl = req.url
      ws.on('message', (m: Buffer) => {
        got.push(m.toString())
        ws.send(JSON.stringify({ type: 'data', data: { transcript: 'hi' } }))
      })
    })
    await new Promise((r) => upstream.on('listening', r))
    process.env.SARVAM_WS_URL = `ws://127.0.0.1:${upstream.address().port}/speech-to-text/ws`
    const port = await startProxy()
    const c = new WebSocket(`ws://127.0.0.1:${port}/?sid=s&sample_rate=16000&input_audio_codec=pcm_s16le`)
    c.on('open', () => { c.send('a1'); c.send('a2') }) // sent while upstream may still be connecting
    const replies: string[] = []
    await new Promise<void>((r) => c.on('message', (m: Buffer) => {
      replies.push(m.toString())
      if (replies.length === 2) r()
    }))
    expect(got).toEqual(['a1', 'a2'])
    expect(seenHeader).toBe('dummy-not-real')
    expect(seenUrl).toContain('input_audio_codec=pcm_s16le')
    c.close()
  })

  it('reports upstream auth failure (401) without leaking the key', async () => {
    process.env.SARVAM_API_KEY = 'dummy-not-real'
    upstreamHttp = http.createServer((_q, res) => { res.statusCode = 401; res.end() })
    await new Promise<void>((r) => upstreamHttp!.listen(0, r))
    process.env.SARVAM_WS_URL = `ws://127.0.0.1:${(upstreamHttp!.address() as AddressInfo).port}/x`
    const port = await startProxy()
    const c = new WebSocket(`ws://127.0.0.1:${port}/?sid=s`)
    const info = await closeInfo(c)
    expect(info.reason).toBe('Upstream auth failed')
  })

  it('reports upstream connection failure', async () => {
    process.env.SARVAM_API_KEY = 'dummy-not-real'
    process.env.SARVAM_WS_URL = 'ws://127.0.0.1:1/x'
    const port = await startProxy()
    const c = new WebSocket(`ws://127.0.0.1:${port}/?sid=s`)
    expect((await closeInfo(c)).reason).toBe('Upstream unavailable')
  })

  it('enforces the STT token when STT_TOKEN_SECRET is set', async () => {
    process.env.SARVAM_API_KEY = 'dummy-not-real'
    process.env.STT_TOKEN_SECRET = SECRET
    const port = await startProxy()
    const bad = new WebSocket(`ws://127.0.0.1:${port}/?sid=s1&token=${mint('other')}`)
    expect(await closeInfo(bad)).toEqual({ code: 1008, reason: 'Unauthorized' })
  })
})
