// Sarvam speech-to-text WebSocket proxy (used by server.js).
//
// Sarvam's streaming endpoint takes the API key as an HTTP header, which browsers
// cannot set on a WebSocket. The browser connects here without a key; the key is
// read from the environment and attached to the upstream connection only.
// Nothing in this file logs the key, headers, query strings, or transcript text.

const crypto = require('crypto')
const { WebSocket } = require('ws')

const DEFAULT_SARVAM_WS = 'wss://api.sarvam.ai/speech-to-text/ws'

// Query params forwarded to Sarvam. input_audio_codec + sample_rate are REQUIRED
// for raw PCM; dropping them makes Sarvam parse the audio as WAV.
const PASS_PARAMS = [
  'model', 'mode', 'language-code', 'language_code', 'sample_rate', 'input_audio_codec',
  'high_vad_sensitivity', 'vad_signals', 'flush_signal',
]
const SAFE_VALUE = /^[A-Za-z0-9_:.\-]{1,32}$/
const MAX_QUEUED = 200 // ~ 200 * 256ms of audio; bounds memory if upstream never opens

function upstreamUrl(query) {
  const params = new URLSearchParams()
  for (const k of PASS_PARAMS) {
    const v = query.get(k)
    if (v != null && SAFE_VALUE.test(v)) params.set(k, v)
  }
  const base = process.env.SARVAM_WS_URL || DEFAULT_SARVAM_WS
  return `${base}?${params.toString()}`
}

// Token format from backend/src/lib/sessions/stt-token.ts: base64url(payload).base64url(hmac-sha256).
function verifySttToken(token, sid, secret, now = Date.now()) {
  if (typeof token !== 'string' || !sid) return false
  const [payloadB64, sig, extra] = token.split('.')
  if (!payloadB64 || !sig || extra !== undefined) return false
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    return payload.sid === sid && typeof payload.exp === 'number' && payload.exp * 1000 > now
  } catch {
    return false
  }
}

// Returns null when allowed, otherwise a short close reason.
function authorize(query, env = process.env) {
  const secret = env.STT_TOKEN_SECRET
  if (!secret) {
    // Fail closed in production; dev may run without a token secret.
    return env.NODE_ENV === 'production' ? 'STT auth not configured' : null
  }
  return verifySttToken(query.get('token'), query.get('sid'), secret) ? null : 'Unauthorized'
}

function safeClose(ws, code, reason) {
  try { ws.close(code, reason) } catch {}
}

function handleProxyConnection(client, query) {
  const denied = authorize(query)
  if (denied) return safeClose(client, 1008, denied)
  if (!process.env.SARVAM_API_KEY) return safeClose(client, 1011, 'STT not configured')

  const upstream = new WebSocket(upstreamUrl(query), {
    headers: { 'api-subscription-key': process.env.SARVAM_API_KEY },
  })
  const queue = [] // browser audio that arrives before Sarvam is ready
  let upstreamOpen = false

  upstream.on('open', () => {
    upstreamOpen = true
    for (const m of queue) upstream.send(m)
    queue.length = 0
  })
  upstream.on('message', (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data.toString())
  })
  upstream.on('unexpected-response', (_req, res) => {
    const status = res.statusCode
    console.error('[stt-proxy] Sarvam handshake rejected, status', status)
    safeClose(client, 1011, status === 401 || status === 403 ? 'Upstream auth failed' : 'Upstream unavailable')
    res.resume()
  })
  upstream.on('error', (e) => {
    console.error('[stt-proxy] upstream error:', e.code || e.name)
    safeClose(client, 1011, 'Upstream unavailable')
  })
  upstream.on('close', () => safeClose(client))

  client.on('message', (data) => {
    const msg = data.toString()
    if (upstreamOpen && upstream.readyState === WebSocket.OPEN) upstream.send(msg)
    else if (queue.length < MAX_QUEUED) queue.push(msg)
  })
  const closeUpstream = () => {
    queue.length = 0
    try { upstream.close() } catch {}
    // A still-connecting socket ignores close(); make sure it cannot linger.
    if (upstream.readyState === WebSocket.CONNECTING) try { upstream.terminate() } catch {}
  }
  client.on('close', closeUpstream)
  client.on('error', closeUpstream)
}

module.exports = { handleProxyConnection, verifySttToken, authorize, upstreamUrl, PASS_PARAMS }
