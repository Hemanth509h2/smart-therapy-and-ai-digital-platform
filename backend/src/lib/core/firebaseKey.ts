// The service-account private key (~1.7k chars) is longer than some hosts allow
// for a single env var (Catalyst caps values at 1000). So it can be given whole
// in FIREBASE_PRIVATE_KEY, or split across FIREBASE_PRIVATE_KEY_1, _2, ... which
// are joined in order.
//
// Hosting dashboards mangle the value in different ways (surrounding quotes kept,
// "\n" left literal or turned into real newlines, stray spaces), so the key is
// rebuilt as a clean PEM from its base64 body rather than trusted as-is.
export function firebasePrivateKey(): string | undefined {
  const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, '')
  let raw = process.env.FIREBASE_PRIVATE_KEY ? unquote(process.env.FIREBASE_PRIVATE_KEY) : ''
  if (!raw) {
    for (let i = 1; process.env[`FIREBASE_PRIVATE_KEY_${i}`]; i++) {
      raw += unquote(process.env[`FIREBASE_PRIVATE_KEY_${i}`] as string)
    }
  }
  if (!raw) return undefined

  const body = raw
    .replace(/\\r|\\n/g, '')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '')
  const lines = body.match(/.{1,64}/g) ?? []
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`
}
