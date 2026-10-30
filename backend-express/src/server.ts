// Express server entry: network tweaks, .env loading and the HTTP listener.
// Live speech-to-text is handled by the standalone relay in ../ai (stt package).
import 'dotenv/config';
import dns from 'dns';

// --- Network resilience (must run before any outbound HTTP) ---------------
// This machine's IPv6 is broken (ENETUNREACH) and latency to Google/Neon can
// be several seconds, so: prefer IPv4 for DNS, and give Node's global fetch
// (used by firebase-admin/google-auth) generous timeouts.
dns.setDefaultResultOrder('ipv4first');
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { setGlobalDispatcher, Agent } = require('undici');
  setGlobalDispatcher(
    new Agent({
      connect: { timeout: 30_000 },
      headersTimeout: 60_000,
      bodyTimeout: 60_000,
    })
  );
} catch {}
// ---------------------------------------------------------------------------

// Imported after the network setup so no client is created before it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require('./app') as typeof import('./app');

const port = parseInt(process.env.PORT || '4000', 10);

if (process.env.AUTH_DISABLED === 'true') {
  console.warn('⚠️  [auth] AUTH_DISABLED=true — API routes trust client-supplied identity (x-dev-uid). DEV ONLY, never deploy like this.');
}

const server = createApp().listen(port, () => {
  console.log(`> Ready on http://localhost:${port}`);
});

// Without this, a busy port makes the process exit silently with code 0.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`✖ Port ${port} is already in use. Stop the other server or set PORT.`);
  } else {
    console.error('✖ Server failed to start:', err.code || err.message);
  }
  process.exit(1);
});
