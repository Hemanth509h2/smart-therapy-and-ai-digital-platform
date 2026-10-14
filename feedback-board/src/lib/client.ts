"use client";
import { getCaptchaToken, resetCaptcha } from "@/components/Captcha";

const rand = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export function deviceToken(): string {
  let t = read<string | null>("fb.device", null);
  if (!t) write("fb.device", (t = rand()));
  return t;
}

/** id -> author token, for posts/comments this browser created. Lost if browser data is cleared. */
export const ownTokens = () => read<Record<string, string>>("fb.own", {});
export function rememberOwn(id: string, token: string) {
  write("fb.own", { ...ownTokens(), [id]: token });
}
export function forgetOwn(id: string) {
  const o = ownTokens();
  delete o[id];
  write("fb.own", o);
}
export const newAuthorToken = rand;

export const votedSet = (kind: "f" | "c") => new Set(read<string[]>(`fb.voted.${kind}`, []));
export function saveVoted(kind: "f" | "c", s: Set<string>) {
  write(`fb.voted.${kind}`, [...s]);
}

export async function api<T = any>(path: string, method = "GET", body?: unknown, captcha = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (captcha) headers["x-captcha-token"] = await getCaptchaToken();
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (captcha) resetCaptcha();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

/** YouTube-style relative time: "5 minutes ago", "3 days ago", "2 years ago". */
export const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const units: [number, string][] = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [sec, name] of units) {
    const n = Math.floor(s / sec);
    if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
};
