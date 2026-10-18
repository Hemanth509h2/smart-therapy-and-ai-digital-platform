import React from 'react';
import { Btn } from '@/components/staad/parts';
import { IconArrowRightXs } from '@/components/staad/icons';
import type { PolicyBlock, PolicySection } from '@/content/legal';

const para: React.CSSProperties = { margin: '0 0 14px', fontSize: 15, lineHeight: '25px', color: 'var(--ink)' };

function Block({ block }: { block: PolicyBlock }) {
  if (Array.isArray(block)) {
    return (
      <ul style={{ ...para, paddingLeft: 22, display: 'grid', gap: 8 }}>
        {block.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return <p style={para}>{block}</p>;
}

interface Props {
  title: string;
  updated: string;
  intro: string[];
  sections: PolicySection[];
  // The other legal page, linked in the footer.
  related: { href: string; label: string };
}

// Public pages: reachable signed out (see AuthProvider) so they can be linked
// from sign-up, the session consent prompt and guest invites.
export default function LegalPage({ title, updated, intro, sections, related }: Props) {
  return (
    <main className="staad-ui" style={{ padding: '48px 16px 80px' }}>
      <article style={{ maxWidth: 760, margin: '0 auto' }}>
        <img src="/assests/staad-emblem.svg" alt="STAAD" width={36} height={36} />

        <header style={{ margin: '28px 0 32px' }}>
          <div className="eyebrow">Legal</div>
          <h1 className="phead__title">{title}</h1>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted)' }}>Last updated {updated}</p>
        </header>

        {intro.map((p) => (
          <p key={p} style={para}>{p}</p>
        ))}

        <nav
          aria-label="Contents"
          className="card"
          style={{ margin: '28px 0 40px', padding: '20px 24px' }}
        >
          <div className="eyebrow" style={{ marginBottom: 10 }}>Contents</div>
          <ol style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 6, fontSize: 14, lineHeight: '21px' }}>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} style={{ color: 'var(--ink)' }}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((s, i) => (
          <section key={s.id} id={s.id} style={{ marginBottom: 36, scrollMarginTop: 24 }}>
            <h2 className="empty__h" style={{ marginBottom: 14 }}>
              {i + 1}. {s.title}
            </h2>
            {s.body.map((b, j) => (
              <Block key={j} block={b} />
            ))}
          </section>
        ))}

        <footer
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            paddingTop: 24,
            borderTop: '1px solid var(--line)',
          }}
        >
          <Btn variant="primary" icon={<IconArrowRightXs />} href="/">Go to home</Btn>
          <Btn variant="ghost" href={related.href}>{related.label}</Btn>
          <Btn variant="ghost" href="/help">Help &amp; Support</Btn>
        </footer>
      </article>
    </main>
  );
}
