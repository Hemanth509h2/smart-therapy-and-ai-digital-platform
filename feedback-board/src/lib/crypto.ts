import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function secret(): string {
  const s = process.env.HMAC_SECRET;
  if (!s) throw new Error("HMAC_SECRET is not set");
  return s;
}

/** voter_key = HMAC(server_secret, device_token + target_id): differs per item, not reversible. */
export const deriveKey = (deviceToken: string, targetId: string) =>
  createHmac("sha256", secret()).update(deviceToken + targetId).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Daily salt: held in memory only, never persisted, rotated every UTC day.
let salt = { day: "", value: "" };
export function ipHash(ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  if (salt.day !== day) salt = { day, value: randomBytes(32).toString("hex") };
  return createHmac("sha256", salt.value).update(ip).digest("hex");
}
