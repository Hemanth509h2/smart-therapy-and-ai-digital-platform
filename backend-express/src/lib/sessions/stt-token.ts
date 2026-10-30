import { createHmac } from 'crypto';

// Signed token the Python AI service (ai/) verifies with the same secret.
// `scope` names the feature it is for: STT tokens have none, call-plan tokens
// have 'call-plan', and the AI service only accepts a token for its own scope.
export function mintSttToken(sid: string, secret: string, expiresInMs: number = 3600000, scope?: string) {
  const payload = {
    sid,
    exp: Math.floor((Date.now() + expiresInMs) / 1000),
    ...(scope ? { scope } : {}),
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}
