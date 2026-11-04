import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

// The link-preview image (Open Graph / Twitter card) that WhatsApp, Slack,
// LinkedIn, X and iMessage show when someone shares a STAAD link. Rendered once
// at build time; Next adds the og:image / twitter:image tags automatically.

export const alt = 'STAAD — collaborative online therapy for neurodivergent learners';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const emblem = await readFile(join(process.cwd(), 'public/assests/staad-emblem.svg'));
  const emblemSrc = `data:image/svg+xml;base64,${emblem.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '72px 88px',
          background: '#f6f0e3',
          color: '#2C1F0E',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={emblemSrc} width={80} height={80} alt="" />
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: 6 }}>STAAD</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>
          Collaborative therapy, online
        </div>
        <div style={{ marginTop: 24, fontSize: 32, lineHeight: 1.4, color: '#5b4632', maxWidth: 980 }}>
          Live sessions, interactive therapy modules and progress tracking for therapists and neurodivergent learners.
        </div>
      </div>
    ),
    size
  );
}
