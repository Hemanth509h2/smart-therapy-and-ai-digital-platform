// STAAD WhatsApp bot (Baileys) — a persistent WhatsApp Web session, which
// serverless hosts can't keep alive. The backend calls POST /send with the
// shared x-bot-secret header.
import 'dotenv/config'
import { timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import express from 'express'
import qrcodeTerminal from 'qrcode-terminal'
import QRCode from 'qrcode'
import pino from 'pino'
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
      // Headless pairing: with PAIRING_NUMBER set, print an 8-character
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
  res.json({ ok: true, connected: connectionReady })
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

app.listen(PORT, () => {
  console.log(`[whatsapp-bot] listening on :${PORT} (POST /send, GET /qr, GET /health)`)
})

startBot().catch((e) => {
  console.error('[whatsapp-bot] failed to start', e)
  process.exit(1)
})
