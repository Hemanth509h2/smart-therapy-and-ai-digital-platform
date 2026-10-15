// The service-account private key (~1.7k chars) is longer than some hosts allow
// for a single env var (Catalyst caps values at 1000). So it can be given whole
// in FIREBASE_PRIVATE_KEY, or split across FIREBASE_PRIVATE_KEY_1, _2, ... which
// are joined in order. Literal "\n" sequences are turned back into newlines.
export function firebasePrivateKey(): string | undefined {
  let key = process.env.FIREBASE_PRIVATE_KEY
  if (!key) {
    const parts: string[] = []
    for (let i = 1; process.env[`FIREBASE_PRIVATE_KEY_${i}`]; i++) {
      parts.push(process.env[`FIREBASE_PRIVATE_KEY_${i}`] as string)
    }
    key = parts.join('') || undefined
  }
  return key?.replace(/\\n/g, '\n')
}
