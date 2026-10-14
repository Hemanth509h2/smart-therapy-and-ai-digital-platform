// Sarvam STT upstream proxy. Dependencies are injected so tests can swap in a
// fake WebSocket and never contact the real service.
function createSttProxy({ WebSocket, getApiKey }) {
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
      headers: { 'api-subscription-key': getApiKey() || '' },
    })
  }

  function handleProxyConnection(client, query) {
    if (!getApiKey()) {
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

  return { handleProxyConnection, openSarvam }
}

module.exports = { createSttProxy }
