// Custom Next.js server: network tweaks and one-line request logging.
// Live speech-to-text is handled by the standalone relay in ../ai (stt package).

// Keep generated output outside OneDrive through the local `.next` junction.
// Node resolves modules from a junction's physical target, so explicitly expose
// this project's dependencies to generated server bundles as well.
const path = require('path')
const Module = require('module')

// --- Network resilience (must run before any outbound HTTP) ---------------
// This machine's IPv6 is broken (ENETUNREACH) and latency to Google/Neon can
// be several seconds, so: prefer IPv4 for DNS, and give Node's global fetch
// (used by firebase-admin/google-auth) generous timeouts.
require('dns').setDefaultResultOrder('ipv4first')
try {
  const { setGlobalDispatcher, Agent } = require('undici')
  setGlobalDispatcher(new Agent({
    connect: { timeout: 30_000 },
    headersTimeout: 60_000,
    bodyTimeout: 60_000,
  }))
} catch {}
// ---------------------------------------------------------------------------
const projectNodeModules = path.join(__dirname, 'node_modules')
process.env.NODE_PATH = [projectNodeModules, process.env.NODE_PATH]
  .filter(Boolean)
  .join(path.delimiter)
Module.Module._initPaths()

const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { loadEnvConfig } = require('@next/env')

loadEnvConfig(process.cwd())

// `--prod` (npm start) forces production; otherwise dev. Cross-platform without
// needing to set NODE_ENV on the command line.
const dev = !process.argv.includes('--prod') && process.env.NODE_ENV !== 'production'
if (!dev) process.env.NODE_ENV = 'production'
const port = parseInt(process.env.PORT || '4000', 10)
const app = next({ dev })
const handle = app.getRequestHandler()

if (process.env.AUTH_DISABLED === 'true') {
  console.warn('⚠️  [auth] AUTH_DISABLED=true — API routes trust client-supplied identity (x-dev-uid). DEV ONLY, never deploy like this.')
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    // Request logging: one line per HTTP request, written when the response
    // finishes. Skip Next.js internals to keep the terminal readable.
    const start = Date.now()
    res.on('finish', () => {
      const url = req.url || ''
      if (url.startsWith('/_next/') || url.startsWith('/favicon')) return
      // Log the path only: query strings can carry credentials and must not
      // land in server logs.
      const path = url.split('?')[0]
      const ms = Date.now() - start
      console.log(`[api] ${req.method} ${path} → ${res.statusCode} (${ms}ms)`)
    })
    handle(req, res, parse(req.url, true))
  })

  // Hand WebSocket upgrades (dev HMR) to Next.
  const nextUpgrade = app.getUpgradeHandler ? app.getUpgradeHandler() : null
  server.on('upgrade', (req, socket, head) => {
    if (nextUpgrade) nextUpgrade(req, socket, head)
    else socket.destroy()
  })

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`)
  })
})
