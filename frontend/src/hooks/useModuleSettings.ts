'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

// Admin module overrides (Admin → Module library): modules switched off
// globally are hidden from therapists; featured ones get a badge. Fetched once
// per page load and shared by every caller. On failure nothing is hidden.
// This is a UI switch only; launches are not blocked server-side.

export interface ModuleSettings {
  disabled: Set<string>;
  featured: Set<string>;
}

const EMPTY: ModuleSettings = { disabled: new Set(), featured: new Set() };
let cache: ModuleSettings | null = null;
let pending: Promise<ModuleSettings> | null = null;

export function loadModuleSettings(): Promise<ModuleSettings> {
  if (cache) return Promise.resolve(cache);
  pending ??= apiFetch('/api/modules/settings')
    .then((res) => (res.ok ? res.json() : null))
    .then((d) => {
      // Only cache a real answer: a 401 before sign-in settles should retry later.
      if (!d) return EMPTY;
      cache = { disabled: new Set<string>(d.disabled ?? []), featured: new Set<string>(d.featured ?? []) };
      return cache;
    })
    .catch(() => EMPTY)
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function useModuleSettings(): ModuleSettings {
  const [settings, setSettings] = useState<ModuleSettings>(cache ?? EMPTY);
  useEffect(() => {
    let alive = true;
    loadModuleSettings().then((s) => alive && setSettings(s));
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}
