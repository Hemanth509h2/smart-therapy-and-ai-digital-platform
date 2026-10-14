// CommonJS STT token verification + WebSocket upgrade authorization for
// server.js (plain Node can't import the TypeScript helper at runtime).
// Rules MUST match verifySttToken() in src/lib/stt-token.ts; the parity test in
// src/lib/__tests__/stt-auth.test.ts guards against drift.
const crypto = require('crypto')
const { parse } = require('url')

function verifySttToken(token, secret, expectedSid) {
  if (!token || !secret || !expectedSid) return false
  if (typeof token !== 'string' || typeof secret !== 'string' || typeof expectedSid !== 'string') return false
  try {
    const parts = token.split('.')
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false
    const [payloadB64, suppliedSignature] = parts

    const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest()
    const actual = Buffer.from(suppliedSignature, 'base64url')
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      return false
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    return (
      payload !== null &&
      typeof payload === 'object' &&
      typeof payload.sid === 'string' &&
      payload.sid === expectedSid &&
      typeof payload.exp === 'number' &&
      Number.isSafeInteger(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000)
    )
  } catch {
    return false
  }
}

// Returns true only for a valid token bound to the `sid` in the request query.
// Fails closed when the secret is absent. Never logs request data.
function isAuthorizedSttUpgrade(query, secret) {
  if (!secret) return false
  const sid = query && query.sid
  const token = query && query.token
  if (typeof sid !== 'string' || typeof token !== 'string') return false
  return verifySttToken(token, secret, sid)
}

function rejectUpgrade(socket) {
  try {
    if (socket.destroyed || !socket.writable) {
      socket.destroy()
      return
    }
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\n' +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n\r\n'
    )
  } catch {}
  try { socket.destroy() } catch {}
}

const STT_PATHS = new Set(['/api/sarvam-stream', '/sarvam-stream'])

// The server's 'upgrade' listener: STT paths require a valid token (401 and no
// handleUpgrade otherwise); every other path goes to `fallback` (Next.js/HMR).
function createSttUpgradeHandler({ wss, getSecret, fallback }) {
  return (req, socket, head) => {
    const { pathname, query } = parse(req.url, true)
    if (!STT_PATHS.has(pathname)) return fallback(req, socket, head)
    if (!isAuthorizedSttUpgrade(query, getSecret())) return rejectUpgrade(socket)
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  }
}

module.exports = { verifySttToken, isAuthorizedSttUpgrade, rejectUpgrade, createSttUpgradeHandler }
