"use client";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
let token = "";
let widgetId: string | undefined;
let waiters: ((t: string) => void)[] = [];

export async function getCaptchaToken(): Promise<string> {
  if (!SITE_KEY) return "";
  if (token) return token;
  return new Promise((resolve) => waiters.push(resolve));
}
export function resetCaptcha() {
  token = "";
  if (SITE_KEY && widgetId) window.turnstile?.reset(widgetId);
}

/** Cloudflare Turnstile widget; renders nothing when no site key is configured (local dev). */
export default function Captcha() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY) return;
    const mount = () => {
      if (!ref.current || !window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        appearance: "interaction-only",
        callback: (t: string) => {
          token = t;
          waiters.forEach((w) => w(t));
          waiters = [];
        },
        "expired-callback": () => (token = ""),
      });
    };
    if (window.turnstile) return mount();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = mount;
    document.head.appendChild(s);
  }, []);
  return <div ref={ref} />;
}
