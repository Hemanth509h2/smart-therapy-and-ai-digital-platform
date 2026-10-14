// Admin-editable app settings, stored in the Setting table. Every key has a
// default here, so code can read a setting before any admin has saved it.
import { prisma } from '@/lib/db';

export const SETTING_DEFAULTS = {
  'features.aiInsights': true,
  'features.transcription': true,
  'features.whatsapp': true,
  'retention.transcriptHours': 24,
  'support.email': 'om.cofounder@staad.in',
  // INR cost estimates for the Usage page.
  'costs.aiAnalysisInr': 1.5,
  'costs.transcriptionMinuteInr': 0.5,
  'usage.alertMonthlyAnalyses': 500,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = { -readonly [K in SettingKey]: (typeof SETTING_DEFAULTS)[K] extends boolean ? boolean : (typeof SETTING_DEFAULTS)[K] extends number ? number : string };

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTING_DEFAULTS;
}

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.setting.findMany();
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) if (isSettingKey(r.key)) out[r.key] = r.value;
  return out as Settings;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return (row?.value ?? SETTING_DEFAULTS[key]) as Settings[K];
}

// Coerce an incoming value to the default's type; returns undefined if invalid.
export function coerceSetting(key: SettingKey, value: unknown): string | number | boolean | undefined {
  const def = SETTING_DEFAULTS[key];
  if (typeof def === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (typeof def === 'number') {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  return typeof value === 'string' ? value.trim().slice(0, 500) : undefined;
}
