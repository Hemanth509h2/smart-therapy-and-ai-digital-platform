// STAAD relay — the always-on companion to the Vercel app. Hosts two things
// Vercel's serverless runtime can't:
//
//  1. WhatsApp bot (Baileys): a persistent WhatsApp Web session. The Next.js app
//     calls POST /send with the shared x-bot-secret header.
//  2. Sarvam STT proxy: WebSocket at /sarvam-stream. Sarvam only accepts its API
//     key as a header (browsers can't set WS headers), so the browser connects
//     here with a short-lived signed token minted by the app's /api/stt-token
//     route, and we open the upstream socket with the key.
import 'dotenv/config'
import { createServer } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import express from 'express'
import qrcodeTerminal from 'qrcode-terminal'
import QRCode from 'qrcode'
import pino from 'pino'
import { WebSocketServer, WebSocket } from 'ws'
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'

const PORT = Number(process.env.PORT || process.env.BOT_PORT || 4001)
const SECRET = process.env.BOT_SECRET
const AUTH_DIR = process.env.AUTH_DIR || './auth_info'
const PAIRING_NUMBER = (process.env.PAIRING_NUMBER || '').replace(/[^\d]/g, '')
const STT_TOKEN_SECRET = process.env.STT_TOKEN_SECRET
const SARVAM_API_KEY = process.env.SARVAM_API_KEY
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean)

if (!SECRET) {
  console.error('BOT_SECRET is not set — refusing to start. Set a shared secret in whatsapp-bot/.env')
  process.exit(1)
}

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' })

// ---------------------------------------------------------------------------
// WhatsApp (Baileys)
// ---------------------------------------------------------------------------

let sock = null
let connectionReady = false
let latestQr = null
let pairingRequested = false

// Turns a stored E.164 number ("+919876543210") into a WhatsApp JID.
function toJid(phoneNumber) {
  const digits = String(phoneNumber).replace(/[^\d]/g, '')
  if (!digits) throw new Error('Invalid phone number')
  return `${digits}@s.whatsapp.net`
}

async function startBot() {
  mkdirSync(AUTH_DIR, { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false, // we handle QR display ourselves below
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      latestQr = qr
      // Headless pairing (Fly): with PAIRING_NUMBER set, print an 8-character
      // code to enter under WhatsApp > Linked devices > Link with phone number.
      if (PAIRING_NUMBER && !pairingRequested && !sock.authState.creds.registered) {
        pairingRequested = true
        try {
          const code = await sock.requestPairingCode(PAIRING_NUMBER)
          console.log(`\n[whatsapp-bot] PAIRING CODE for +${PAIRING_NUMBER}: ${code}\n`)
        } catch (e) {
          pairingRequested = false
          console.error('[whatsapp-bot] pairing code request failed', e)
        }
      } else if (!PAIRING_NUMBER) {
        console.log('\nScan this QR code with the dedicated WhatsApp bot number (WhatsApp > Linked Devices > Link a Device),')
        console.log('or open /qr?secret=<BOT_SECRET> in a browser:\n')
        qrcodeTerminal.generate(qr, { small: true })
      }
    }

    if (connection === 'open') {
      connectionReady = true
      latestQr = null
      console.log('[whatsapp-bot] connected to WhatsApp')
    }

    if (connection === 'close') {
      connectionReady = false
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut
      console.log('[whatsapp-bot] connection closed', { statusCode, loggedOut })
      if (loggedOut) {
        console.error(`[whatsapp-bot] logged out — delete ${AUTH_DIR} and restart to re-pair`)
      } else {
        console.log('[whatsapp-bot] reconnecting...')
        pairingRequested = false
        startBot().catch((e) => console.error('[whatsapp-bot] reconnect failed', e))
      }
    }
  })
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

function secretMatches(provided) {
  if (typeof provided !== 'string') return false
  const a = Buffer.from(provided)
  const b = Buffer.from(SECRET)
  return a.length === b.length && timingSafeEqual(a, b)
}

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, connected: connectionReady, stt: Boolean(SARVAM_API_KEY && STT_TOKEN_SECRET) })
})

// Browser-friendly QR for first-time pairing on a headless host.
app.get('/qr', async (req, res) => {
  if (!secretMatches(req.query.secret)) return res.status(401).send('Unauthorized')
  if (connectionReady) return res.send('<h2>WhatsApp is already connected ✅</h2>')
  if (!latestQr) return res.send('<h2>No QR yet — refresh in a few seconds.</h2><script>setTimeout(()=>location.reload(),3000)</script>')
  const dataUrl = await QRCode.toDataURL(latestQr, { width: 320, margin: 2 })
  res.send(`<!doctype html><title>Link WhatsApp</title>
<body style="font-family:sans-serif;text-align:center;padding:40px">
<h2>WhatsApp → Linked devices → Link a device</h2><img src="${dataUrl}" alt="QR"/>
<p>Refreshes automatically (QR codes rotate every ~20s).</p>
<script>setTimeout(()=>location.reload(),15000)</script></body>`)
})

app.post('/send', async (req, res) => {
  if (!secretMatches(req.header('x-bot-secret'))) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!connectionReady || !sock) {
    return res.status(503).json({ error: 'WhatsApp bot is not connected yet' })
  }

  const { to, text } = req.body || {}
  if (!to || !text) {
    return res.status(400).json({ error: 'to and text are required' })
  }

  try {
    const jid = toJid(to)
    const result = await sock.sendMessage(jid, { text })
    return res.json({ success: true, id: result?.key?.id ?? null })
  } catch (err) {
    console.error('[whatsapp-bot] send failed', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Send failed' })
  }
})

// ---------------------------------------------------------------------------
// Sarvam STT WebSocket proxy
// ---------------------------------------------------------------------------

const SARVAM_WS = 'wss://api.sarvam.ai/speech-to-text/ws'
// Query params we forward through to Sarvam (everything except our own).
const PASS_PARAMS = ['model', 'mode', 'high_vad_sensitivity', 'vad_signals', 'language_code']

// Token format (minted by src/lib/stt-token.ts): base64url(JSON payload) + "." +
// base64url(HMAC-SHA256(payloadPart, STT_TOKEN_SECRET)). Payload: { uid, sid, exp }.
function verifySttToken(token, sid) {
  if (!STT_TOKEN_SECRET || typeof token !== 'string') return null
  const [payloadPart, sigPart] = token.split('.')
  if (!payloadPart || !sigPart) return null
  const expected = createHmac('sha256', STT_TOKEN_SECRET).update(payloadPart).digest()
  const given = Buffer.from(sigPart, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
    if (payload.sid !== sid) return null
    return payload
  } catch {
    return null
  }
}

function originAllowed(origin) {
  if (ALLOWED_ORIGINS.length === 0) return true
  return Boolean(origin) && ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''))
}

function handleProxyConnection(client, query) {
  const params = new URLSearchParams()
  for (const k of PASS_PARAMS) {
    const v = query.get(k)
    if (v != null) params.set(k, v)
  }
  const upstream = new WebSocket(`${SARVAM_WS}?${params.toString()}`, {
    headers: { 'api-subscription-key': SARVAM_API_KEY },
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
    console.error('[stt-proxy] Sarvam handshake failed:', res.statusCode)
    try { client.close(1011, 'Upstream auth failed') } catch {}
  })
  upstream.on('error', (e) => {
    console.error('[stt-proxy] upstream error:', e.message)
    try { client.close(1011, 'Upstream error') } catch {}
  })
  upstream.on('close', () => { try { client.close() } catch {} })

  client.on('message', (data) => {
    const msg = data.toString()
    if (upstreamOpen && upstream.readyState === WebSocket.OPEN) upstream.send(msg)
    else if (queue.length < 200) queue.push(msg)
  })
  client.on('close', () => { try { upstream.close() } catch {} })
  client.on('error', () => { try { upstream.close() } catch {} })
}

const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://relay')
  if (url.pathname !== '/sarvam-stream' && url.pathname !== '/api/sarvam-stream') {
    socket.destroy()
    return
  }
  const reject = (code, reason) => {
    socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`)
    socket.destroy()
  }
  if (!SARVAM_API_KEY || !STT_TOKEN_SECRET) return reject(503, 'STT Not Configured')
  if (!originAllowed(req.headers.origin)) return reject(403, 'Forbidden Origin')
  if (!verifySttToken(url.searchParams.get('token'), url.searchParams.get('sid'))) {
    return reject(401, 'Unauthorized')
  }
  wss.handleUpgrade(req, socket, head, (ws) => handleProxyConnection(ws, url.searchParams))
})

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT} (POST /send, WS /sarvam-stream)`)
})

startBot().catch((e) => {
  console.error('[whatsapp-bot] failed to start', e)
  process.exit(1)
})
