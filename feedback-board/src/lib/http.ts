import { NextRequest, NextResponse } from "next/server";
import { deriveKey, ipHash, safeEqual, sha256 } from "./crypto";
import { hit } from "./ratelimit";
import { verifyCaptcha } from "./captcha";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Ctx = { params: Record<string, string> };
type Handler = (req: NextRequest, ctx: Ctx) => Promise<unknown>;
type RawCtx = { params: Promise<Record<string, string>> };

/** Wraps a handler: JSON in/out, HttpError -> status, anything else -> 500 (no details logged beyond message). */
export function route(fn: Handler) {
  return async (req: NextRequest, raw: RawCtx) => {
    try {
      const data = await fn(req, { params: (await raw?.params) ?? {} });
      return NextResponse.json(data ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error("route error:", (e as Error).message || (e as { code?: string }).code || e);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export async function json(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (b && typeof b === "object") return b as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, "Invalid JSON body");
}

export function str(v: unknown, name: string, min: number, max: number): string {
  if (typeof v !== "string") throw new HttpError(400, `${name} is required`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new HttpError(400, `${name} must be ${min}-${max} characters`);
  return t;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v: unknown, name = "id"): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new HttpError(400, `Invalid ${name}`);
  return v.toLowerCase();
}

/** Tokens are random client secrets; only their hash ever reaches the database. */
export const authorHash = (v: unknown) => sha256(str(v, "author_token", 16, 128));
export const voterKey = (deviceToken: unknown, targetId: string) =>
  deriveKey(str(deviceToken, "device_token", 16, 128), targetId);

/** Gateway step: the IP is used only to build a short-lived salted hash for rate limiting, then dropped. */
export function limit(req: NextRequest, action: string, max: number, windowMs: number) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  if (!hit(`${action}:${ipHash(ip)}`, max, windowMs)) throw new HttpError(429, "Too many requests, try again later");
}

export async function captcha(req: NextRequest) {
  if (!(await verifyCaptcha(req.headers.get("x-captcha-token") ?? ""))) {
    throw new HttpError(400, "CAPTCHA check failed");
  }
}

export function requireAdmin(req: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  const given = req.headers.get("x-admin-password") ?? "";
  if (!expected || !safeEqual(given, expected)) throw new HttpError(401, "Admin sign-in required");
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
