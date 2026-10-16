import { createHmac } from 'crypto';

export function mintSttToken(sid: string, secret: string, expiresInMs: number = 3600000) {
  const payload = {
    sid,
    exp: Math.floor((Date.now() + expiresInMs) / 1000),
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}
