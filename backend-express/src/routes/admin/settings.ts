import { Router } from 'express';
import { appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { SETTING_DEFAULTS, coerceSetting, isSettingKey, type SettingKey } from '@/lib/core/settings';
import { errorResponse } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';
import { defaultMailFrom, mailConfigured } from '@/lib/core/mail';

export const router = Router();

// ---- /api/admin/settings -------------------------------------------------------

// GET /api/admin/settings — every setting (saved value or default) plus which
// integrations are configured. Integration status is yes/no only: secret
// values never leave the server.
router.get('/admin/settings', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'settings');
    if (!auth.ok) return send(res, auth.response);

    const rows = await appDb.setting.findMany();
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

    return res.json({ settings, integrations: integrationStatus() });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin settings GET error', "We couldn't load the settings. Please try again."));
  }
}));

// PATCH /api/admin/settings — body { "<key>": value, ... }. All keys are
// validated before anything is written; one audit entry per changed key.
router.patch('/admin/settings', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'settings');
    if (!auth.ok) return send(res, auth.response);

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: "We couldn't read the settings you sent. Refresh the page and try again." });
    }

    const updates: { key: SettingKey; value: string | number | boolean }[] = [];
    for (const [key, raw] of Object.entries(body)) {
      if (!isSettingKey(key)) return res.status(400).json({ error: `"${key}" is not a setting we recognise. Refresh the page and try again.` });
      const value = coerceSetting(key, raw);
      if (value === undefined) return res.status(400).json({ error: `The value for "${key}" is not valid. Check it and try again.` });
      if (key === 'support.email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
        return res.status(400).json({ error: 'Enter a valid support email address, like help@example.com.' });
      }
      updates.push({ key, value });
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to change.' });

    const existing = await appDb.setting.findMany({ where: { key: { in: updates.map((u) => u.key) } } });
    const before = new Map(existing.map((r) => [r.key, r.value]));
    const changed = updates.filter((u) => JSON.stringify(before.get(u.key) ?? SETTING_DEFAULTS[u.key]) !== JSON.stringify(u.value));

    const updatedBy = auth.email || auth.uid;
    await appDb.$transaction(
      changed.map((u) =>
        appDb.setting.upsert({
          where: { key: u.key },
          create: { key: u.key, value: u.value, updatedBy },
          update: { value: u.value, updatedBy },
        })
      )
    );
    for (const u of changed) {
      await audit(req, auth, 'setting.update', { type: 'Setting', id: u.key }, {
        before: { value: before.get(u.key) ?? SETTING_DEFAULTS[u.key] },
        after: { value: u.value },
      });
    }

    return res.json({ ok: true, changed: changed.map((u) => u.key) });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin settings PATCH error', "We couldn't save the settings. Please try again."));
  }
}));

function integrationStatus() {
  const env = process.env;
  const cashfreeEnv = (env.CASHFREE_ENV || '').toLowerCase();
  return {
    cashfree: {
      configured: !!(env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY),
      mode: cashfreeEnv === 'production' || cashfreeEnv === 'prod' ? 'production' : cashfreeEnv ? 'sandbox' : null,
    },
    smtp: { configured: mailConfigured(), from: defaultMailFrom() },
    livekit: { configured: !!(env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) },
    transcription: { configured: !!env.STT_TOKEN_SECRET },
    cron: { configured: !!env.CRON_SECRET },
  };
}
