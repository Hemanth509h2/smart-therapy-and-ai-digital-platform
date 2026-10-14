import { describe, it, expect, vi } from 'vitest'
import { createServer } from 'http'
import { EventEmitter } from 'events'
import type { AddressInfo } from 'net'
import { WebSocketServer, WebSocket as WsClient } from 'ws'
import { createHmac } from 'crypto'
import { mintSttToken, verifySttToken as verifyTs } from '../stt-token'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifySttToken, isAuthorizedSttUpgrade, rejectUpgrade, createSttUpgradeHandler } = require('../../../stt-auth')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createSttProxy } = require('../../../stt-proxy')

const SECRET = 'test-secret-not-real'
const SID = 'session-1'

function sign(payload: unknown, secret = SECRET) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${b64}.${createHmac('sha256', secret).update(b64).digest('base64url')}`
}
const future = () => Math.floor(Date.now() / 1000) + 600

describe('CommonJS verifier (server.js)', () => {
  it('accepts a valid token for the expected session', () => {
    expect(verifySttToken(mintSttToken(SID, SECRET), SECRET, SID)).toBe(true)
  })
  it('rejects a token for another session', () => {
    expect(verifySttToken(mintSttToken('other', SECRET), SECRET, SID)).toBe(false)
  })
  it('rejects an expired token', () => {
    expect(verifySttToken(sign({ sid: SID, exp: Math.floor(Date.now() / 1000) - 1 }), SECRET, SID)).toBe(false)
  })
  it('rejects a tampered signature, wrong secret and wrong-length signature', () => {
    const t = mintSttToken(SID, SECRET)
    const [p, s] = t.split('.')
    const flipped = s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA')
    expect(verifySttToken(`${p}.${flipped}`, SECRET, SID)).toBe(false)
    expect(verifySttToken(`${p}.${s.slice(0, 10)}`, SECRET, SID)).toBe(false)
    expect(verifySttToken(t, 'another-secret', SID)).toBe(false)
  })
  it('rejects malformed tokens and payloads', () => {
    const bad = ['', 'abc', 'a.b.c', '.', 'a.', '.b', sign({ sid: 1, exp: future() }), sign({ sid: SID }), sign({ sid: SID, exp: '9999999999' }), sign(null)]
    for (const t of bad) expect(verifySttToken(t, SECRET, SID)).toBe(false)
  })
  it('rejects missing token, sid or secret', () => {
    const t = mintSttToken(SID, SECRET)
    expect(verifySttToken('', SECRET, SID)).toBe(false)
    expect(verifySttToken(t, '', SID)).toBe(false)
    expect(verifySttToken(t, SECRET, '')).toBe(false)
  })
  it('agrees with the TypeScript verifier on every case', () => {
    const good = mintSttToken(SID, SECRET)
    const cases: [string, string, string][] = [
      [good, SECRET, SID], [good, SECRET, 'x'], [good, 'bad', SID], ['junk', SECRET, SID],
      [sign({ sid: SID, exp: 1 }), SECRET, SID], [sign({ sid: SID, exp: future() + 0.5 }), SECRET, SID],
      [sign(null), SECRET, SID],
    ]
    for (const [t, s, sid] of cases) expect(verifySttToken(t, s, sid)).toBe(verifyTs(t, s, sid))
  })
})

describe('isAuthorizedSttUpgrade', () => {
  const tok = mintSttToken(SID, SECRET)
  it('accepts valid sid+token', () => expect(isAuthorizedSttUpgrade({ sid: SID, token: tok }, SECRET)).toBe(true))
  it('fails closed without secret, sid or token', () => {
    expect(isAuthorizedSttUpgrade({ sid: SID, token: tok }, undefined)).toBe(false)
    expect(isAuthorizedSttUpgrade({ sid: SID }, SECRET)).toBe(false)
    expect(isAuthorizedSttUpgrade({ token: tok }, SECRET)).toBe(false)
  })
  it('rejects repeated params (array values)', () => {
    expect(isAuthorizedSttUpgrade({ sid: [SID, SID], token: tok }, SECRET)).toBe(false)
  })
})

describe('real upgrade handler + real proxy (fake upstream)', () => {
  // Fake Sarvam socket: records construction, never opens a network connection.
  const upstreams: FakeUpstream[] = []
  class FakeUpstream extends EventEmitter {
    static OPEN = 1
    readyState = 0
    sent: string[] = []
    constructor(public url: string, public opts: unknown) {
      super()
      upstreams.push(this)
    }
    send(m: string) { this.sent.push(m) }
    close() {}
  }

  async function start(secret: string | undefined) {
    upstreams.length = 0
    const fallback = vi.fn((_req, socket) => socket.destroy())
    const wss = new WebSocketServer({ noServer: true })
    const { handleProxyConnection } = createSttProxy({ WebSocket: FakeUpstream, getApiKey: () => 'fake-key' })
    wss.on('connection', (ws, req) => handleProxyConnection(ws, new URL(req.url!, 'http://x').searchParams))
    const server = createServer()
    server.on('upgrade', createSttUpgradeHandler({ wss, getSecret: () => secret, fallback }))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const stop = async () => {
      wss.clients.forEach((c) => c.terminate())
      await new Promise((r) => server.close(r))
    }
    return { port, fallback, stop }
  }

  // Resolves with the HTTP status of a rejected handshake, 'open', or 'closed'.
  function connect(port: number, path: string): Promise<number | 'open' | 'closed'> {
    return new Promise((resolve) => {
      const ws = new WsClient(`ws://127.0.0.1:${port}${path}`)
      ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode ?? 0); ws.terminate() })
      ws.on('open', () => { resolve('open'); ws.close() })
      ws.on('error', () => resolve('closed')) // socket destroyed without a response
    })
  }

  const PATHS = ['/api/sarvam-stream', '/sarvam-stream']
  const mint = (sid = SID) => mintSttToken(sid, SECRET)
  const expired = () => sign({ sid: SID, exp: Math.floor(Date.now() / 1000) - 10 })
  const tampered = () => {
    const [p, s] = mint().split('.')
    return `${p}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`
  }

  for (const path of PATHS) {
    it(`${path}: rejects bad credentials with 401 before opening upstream`, async () => {
      const { port, stop } = await start(SECRET)
      try {
        const bad: Record<string, string> = {
          'missing token': `?sid=${SID}`,
          'missing sid': `?token=${mint()}`,
          'malformed token': `?sid=${SID}&token=not-a-token`,
          'invalid signature': `?sid=${SID}&token=${tampered()}`,
          'expired token': `?sid=${SID}&token=${expired()}`,
          'mismatched session': `?sid=other&token=${mint()}`,
          'token for other session': `?sid=${SID}&token=${mint('other')}`,
        }
        for (const [name, qs] of Object.entries(bad)) {
          expect(await connect(port, path + qs), name).toBe(401)
        }
        expect(upstreams).toHaveLength(0)
      } finally {
        await stop()
      }
    })

    it(`${path}: fails closed when STT_TOKEN_SECRET is unset`, async () => {
      const { port, stop } = await start(undefined)
      try {
        expect(await connect(port, `${path}?sid=${SID}&token=${mint()}`)).toBe(401)
        expect(upstreams).toHaveLength(0)
      } finally {
        await stop()
      }
    })

    it(`${path}: valid token reaches the (fake) upstream and relays audio`, async () => {
      const { port, stop } = await start(SECRET)
      try {
        const ws = new WsClient(`ws://127.0.0.1:${port}${path}?sid=${SID}&token=${mint()}&model=saaras:v3&speaker=therapist`)
        await new Promise<void>((r) => ws.on('open', () => r()))
        ws.send('frame-1')
        await vi.waitFor(() => expect(upstreams).toHaveLength(1))
        // Our own params (sid/token/speaker) must not leak to the upstream URL.
        expect(upstreams[0].url).toContain('model=saaras%3Av3')
        expect(upstreams[0].url).not.toMatch(/token|sid|speaker/)
        upstreams[0].readyState = 1
        upstreams[0].emit('open')
        await vi.waitFor(() => expect(upstreams[0].sent).toEqual(['frame-1']))
        ws.close()
      } finally {
        await stop()
      }
    })
  }

  it('non-STT upgrade paths go to the fallback without needing a token', async () => {
    const { port, fallback, stop } = await start(SECRET)
    try {
      await connect(port, '/_next/webpack-hmr')
      expect(fallback).toHaveBeenCalledOnce()
      expect(upstreams).toHaveLength(0)
    } finally {
      await stop()
    }
  })

  it('rejectUpgrade is safe on an already-destroyed socket', () => {
    const socket = { destroyed: true, writable: false, destroy: vi.fn(), write: vi.fn() }
    expect(() => rejectUpgrade(socket)).not.toThrow()
    expect(socket.write).not.toHaveBeenCalled()
  })
})
