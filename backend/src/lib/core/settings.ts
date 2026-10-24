// Admin-editable app settings, stored in the Setting table. Every key has a
// default here, so code can read a setting before any admin has saved it.
import { appDb } from '@/lib/core/db';

export const SETTING_DEFAULTS = {
  'features.aiInsights': true,
  'features.transcription': true,
  'features.whatsapp': true,
  // Therapists request a plan (with any coupon), an admin approves it, then
  // they pay. Off: they pay at once. A ₹0 total never goes to Cashfree.
  'billing.approvalBeforePayment': true,
  'retention.transcriptHours': 24,
  'support.email': 'om.cofounder@staad.in',
  // INR cost estimates for the Usage page.
  'costs.aiAnalysisInr': 1.5,
  'costs.transcriptionMinuteInr': 0.5,
  'costs.aiReportInr': 5,
  'costs.videoMinuteInr': 0.25, // per session minute, all participants together
  'costs.whatsappMessageInr': 0.12,
  'usage.alertMonthlyAnalyses': 500,
  // Fixed monthly bills (INR), added to platform totals on the Usage page.
  'costs.hostingMonthlyInr': 0,
  'costs.databaseMonthlyInr': 0,
  // Storage included in each database's plan, for the "% used" bars.
  'limits.appDbMb': 512,
  'limits.hipaaDbMb': 10240,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = { -readonly [K in SettingKey]: (typeof SETTING_DEFAULTS)[K] extends boolean ? boolean : (typeof SETTING_DEFAULTS)[K] extends number ? number : string };

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTING_DEFAULTS;
}

export async function getSettings(): Promise<Settings> {
  const rows = await appDb.setting.findMany();
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) if (isSettingKey(r.key)) out[r.key] = r.value;
  return out as Settings;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  const row = await appDb.setting.findUnique({ where: { key } }).catch(() => null);
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
