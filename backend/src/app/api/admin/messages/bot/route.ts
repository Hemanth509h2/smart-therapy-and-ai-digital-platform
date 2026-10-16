import { NextResponse } from 'next/server';
import { requireAdmin, requireRecentLogin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';

export const dynamic = 'force-dynamic';

// The self-hosted WhatsApp bot (whatsapp-bot/index.js). Same env and
// x-bot-secret header as lib/whatsapp-bot.ts.
function botConfig() {
  const url = process.env.WHATSAPP_BOT_URL;
  const secret = process.env.WHATSAPP_BOT_SECRET;
  return url && secret ? { base: url.replace(/\/+$/, ''), secret } : null;
}

const NOT_CONFIGURED = 'WhatsApp bot is not configured (WHATSAPP_BOT_URL / WHATSAPP_BOT_SECRET).';

// GET /api/admin/messages/bot — is the bot reachable and linked to a number?
export async function GET(request: Request) {
  const auth = await requireAdmin(request, 'support');
  if (!auth.ok) return auth.response;

  const cfg = botConfig();
  if (!cfg) return NextResponse.json({ configured: false, error: NOT_CONFIGURED }, { status: 503 });

  try {
    const res = await fetch(`${cfg.base}/health`, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ configured: true, reachable: false, connected: false, error: `Bot responded ${res.status}` });
    return NextResponse.json({ configured: true, reachable: true, connected: !!data.connected, checkedAt: new Date() });
  } catch (e: any) {
    return NextResponse.json({ configured: true, reachable: false, connected: false, error: e?.message || 'Bot unreachable' });
  }
}

// POST /api/admin/messages/bot { action: 'logout' } — unlink the WhatsApp
// account from the bot; it then waits for a new QR pairing.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request, 'settings');
    if (!auth.ok) return auth.response;
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return stepUp;

    const body = await request.json().catch(() => ({}));
    if (body.action !== 'logout') return NextResponse.json({ error: "action must be 'logout'" }, { status: 400 });

    const cfg = botConfig();
    if (!cfg) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });

    const res = await fetch(`${cfg.base}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': cfg.secret },
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: data.error || `Bot responded ${res.status}` }, { status: 502 });

    await audit(request, auth, 'whatsapp.bot.logout', { type: 'WhatsAppBot' });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('POST /api/admin/messages/bot failed:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
