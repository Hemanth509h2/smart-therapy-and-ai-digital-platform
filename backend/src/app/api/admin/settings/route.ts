import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { SETTING_DEFAULTS, coerceSetting, isSettingKey, type SettingKey } from '@/lib/core/settings';

export const dynamic = 'force-dynamic';

// GET /api/admin/settings — every setting (saved value or default) plus which
// integrations are configured. Integration status is yes/no only: secret
// values never leave the server.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'settings');
    if (!auth.ok) return auth.response;

    const rows = await prisma.setting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const settings = (Object.keys(SETTING_DEFAULTS) as SettingKey[]).map((key) => {
      const row = byKey.get(key);
      return {
        key,
        value: row ? row.value : SETTING_DEFAULTS[key],
        default: SETTING_DEFAULTS[key],
        isDefault: !row,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    });

    return NextResponse.json({ settings, integrations: integrationStatus() });
  } catch (error: any) {
    console.error('Admin settings GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/admin/settings — body { "<key>": value, ... }. All keys are
// validated before anything is written; one audit entry per changed key.
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin(request, 'settings');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Send an object of { key: value }.' }, { status: 400 });
    }

    const updates: { key: SettingKey; value: string | number | boolean }[] = [];
    for (const [key, raw] of Object.entries(body)) {
      if (!isSettingKey(key)) return NextResponse.json({ error: `Unknown setting: ${key}` }, { status: 400 });
      const value = coerceSetting(key, raw);
      if (value === undefined) return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 });
      if (key === 'support.email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
        return NextResponse.json({ error: 'Support email is not a valid address.' }, { status: 400 });
      }
      updates.push({ key, value });
    }
    if (!updates.length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });

    const existing = await prisma.setting.findMany({ where: { key: { in: updates.map((u) => u.key) } } });
    const before = new Map(existing.map((r) => [r.key, r.value]));
    const changed = updates.filter((u) => JSON.stringify(before.get(u.key) ?? SETTING_DEFAULTS[u.key]) !== JSON.stringify(u.value));

    const updatedBy = auth.email || auth.uid;
    await prisma.$transaction(
      changed.map((u) =>
        prisma.setting.upsert({
          where: { key: u.key },
          create: { key: u.key, value: u.value, updatedBy },
          update: { value: u.value, updatedBy },
        })
      )
    );
    for (const u of changed) {
      await audit(request, auth, 'setting.update', { type: 'Setting', id: u.key }, {
        before: { value: before.get(u.key) ?? SETTING_DEFAULTS[u.key] },
        after: { value: u.value },
      });
    }

    return NextResponse.json({ ok: true, changed: changed.map((u) => u.key) });
  } catch (error: any) {
    console.error('Admin settings PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function integrationStatus() {
  const env = process.env;
  const cashfreeEnv = (env.CASHFREE_ENV || '').toLowerCase();
  return {
    cashfree: {
      configured: !!(env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY),
      mode: cashfreeEnv === 'production' || cashfreeEnv === 'prod' ? 'production' : cashfreeEnv ? 'sandbox' : null,
    },
    whatsapp: {
      bot: !!(env.WHATSAPP_BOT_URL && env.WHATSAPP_BOT_SECRET),
      cloudApi: !!(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
      twilio: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),
    },
    smtp: { configured: !!(env.SMTP_USER && env.SMTP_PASS) },
    livekit: { configured: !!(env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) },
    transcription: { configured: !!env.STT_TOKEN_SECRET },
    cron: { configured: !!env.CRON_SECRET },
  };
}
