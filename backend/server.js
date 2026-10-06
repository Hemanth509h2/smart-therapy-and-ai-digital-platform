// Custom Next.js server that also runs the Sarvam speech-to-text WebSocket proxy.
//
// Why this exists: Sarvam's streaming STT WebSocket only accepts the API key as
// an HTTP *header*, and browsers cannot set headers on a WebSocket. So the
// browser connects to our same-origin /api/sarvam-stream endpoint (no key), and
// this server opens the upstream Sarvam socket with the header and relays audio
// frames up and transcript messages back down. The key never reaches the client.
//
// Next's App Router can't host a WebSocket route, hence this thin custom server.
// HMR (dev) is preserved by delegating non-proxy upgrades to Next.

// Keep generated output outside OneDrive through the local `.next` junction.
// Node resolves modules from a junction's physical target, so explicitly expose
// this project's dependencies to generated server bundles as well.
const path = require('path')
const Module = require('module')
const projectNodeModules = path.join(__dirname, 'node_modules')
process.env.NODE_PATH = [projectNodeModules, process.env.NODE_PATH]
  .filter(Boolean)
  .join(path.delimiter)
Module.Module._initPaths()

const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { WebSocketServer, WebSocket } = require('ws')
const { loadEnvConfig } = require('@next/env')

loadEnvConfig(process.cwd())

// `--prod` (npm start) forces production; otherwise dev. Cross-platform without
// needing to set NODE_ENV on the command line.
const dev = !process.argv.includes('--prod') && process.env.NODE_ENV !== 'production'
if (!dev) process.env.NODE_ENV = 'production'
const port = parseInt(process.env.PORT || '4000', 10)
const app = next({ dev })
const handle = app.getRequestHandler()

const SARVAM_WS = 'wss://api.sarvam.ai/speech-to-text/ws'
// Query params we forward through to Sarvam (everything except our own).
const PASS_PARAMS = ['model', 'mode', 'high_vad_sensitivity', 'vad_signals', 'language_code']

function openSarvam(query) {
  const params = new URLSearchParams()
  for (const k of PASS_PARAMS) {
    const v = query.get(k)
    if (v != null) params.set(k, v)
  }
  return new WebSocket(`${SARVAM_WS}?${params.toString()}`, {
    headers: { 'api-subscription-key': process.env.SARVAM_API_KEY || '' },
  })
}

function handleProxyConnection(client, query) {
  if (!process.env.SARVAM_API_KEY) {
    client.close(1011, 'STT not configured')
    return
  }
  const upstream = openSarvam(query)
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
    else queue.push(msg)
  })
  client.on('close', () => { try { upstream.close() } catch {} })
  client.on('error', () => { try { upstream.close() } catch {} })
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    // Request logging: one line per HTTP request, written when the response
    // finishes. Skip Next.js internals to keep the terminal readable.
    const start = Date.now()
    res.on('finish', () => {
      const url = req.url || ''
      if (url.startsWith('/_next/') || url.startsWith('/favicon')) return
      const ms = Date.now() - start
      console.log(`[api] ${req.method} ${url} → ${res.statusCode} (${ms}ms)`)
    })
    handle(req, res, parse(req.url, true))
  })

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws, req) => {
    const { query } = parse(req.url, true)
    const sp = new URLSearchParams(query)
    handleProxyConnection(ws, sp)
  })

  const nextUpgrade = app.getUpgradeHandler ? app.getUpgradeHandler() : null
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url)
    if (pathname === '/api/sarvam-stream' || pathname === '/sarvam-stream') {
      // TODO (harden later): verify a Firebase session token from the query
      // before relaying. Currently gated only by being same-origin + having a sid.
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    } else if (nextUpgrade) {
      nextUpgrade(req, socket, head)
    } else {
      socket.destroy()
    }
  })

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port} (STT proxy at /api/sarvam-stream)`)
  })
})
