import { createHmac, timingSafeEqual } from 'crypto';

interface SttTokenPayload {
  sid: string;
  exp: number;
}

export function mintSttToken(
  sid: string,
  secret: string,
  expiresInMs: number = 3600000
): string {
  const payload: SttTokenPayload = {
    sid,
    exp: Math.floor((Date.now() + expiresInMs) / 1000),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');

  return `${payloadB64}.${signature}`;
}

export function verifySttToken(
  token: string,
  secret: string,
  expectedSid: string
): boolean {
  if (!token || !secret || !expectedSid) return false;

  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;

    const [payloadB64, suppliedSignature] = parts;

    const expectedSignature = createHmac('sha256', secret)
      .update(payloadB64)
      .digest();

    const actualSignature = Buffer.from(suppliedSignature, 'base64url');

    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      return false;
    }

    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as Partial<SttTokenPayload>;

    return (
      typeof payload.sid === 'string' &&
      payload.sid === expectedSid &&
      typeof payload.exp === 'number' &&
      Number.isSafeInteger(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}