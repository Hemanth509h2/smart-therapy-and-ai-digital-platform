'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/useAuthStore';
import { usePracticeData } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import { Btn, Chips, EmptyCard, InlineError, SearchBox, Section, cx } from '@/components/staad/parts';
import {
  IconArrowRightXs,
  IconChat,
  IconFaqSign,
  IconHelp,
  IconRowA,
  IconRowB,
} from '@/components/staad/icons';
import { DsDialog, toast } from '@/components/practice/ui';
import { FAQS, GUIDES, SUPPORT_EMAIL, SUPPORT_HOURS, type HelpCategory } from '@/content/help';
import { fullName } from '@/lib/practice';
import { apiFetch } from '@/lib/api';

type Filter = 'All' | HelpCategory;
const FILTERS: Filter[] = ['All', 'Sessions', 'Clients', 'Billing', 'Privacy'];
const CATEGORIES = ['Technical Issue', 'Billing', 'Account', 'Feedback'];

export default function HelpPage() {
  const { role, email, profile } = useAuthStore();
  const { sessions } = usePracticeData();

  const [filter, setFilter] = useState<Filter>('All');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  // support ticket
  const [ticketOpen, setTicketOpen] = useState(false);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentRef, setSentRef] = useState('');

  const q = search.trim().toLowerCase();
  const faqs = FAQS.filter((f) => filter === 'All' || f.category === filter).filter(
    (f) => !q || `${f.q} ${f.a}`.toLowerCase().includes(q)
  );

  const counts = FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f] = f === 'All' ? FAQS.length : FAQS.filter((x) => x.category === f).length;
    return acc;
  }, {});

  const submit = async () => {
    setError('');
    if (!subject.trim() || !message.trim()) {
      setError('Please add a subject and describe your issue.');
      return;
    }
    setSending(true);
    try {
      const res = await apiFetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName(profile),
          email,
          role,
          category,
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
      } else {
        setSentRef(data.ref || 'Submitted');
        setSubject('');
        setMessage('');
        setCategory(CATEGORIES[0]);
        toast('Ticket submitted');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <StaadShell>
      <TopBar sessions={sessions} />

      <div className="phead">
        <div>
          <div className="eyebrow">We&apos;re here</div>
          <h1 className="phead__title">Help</h1>
          <p className="phead__lead">Answers to the things therapists ask us most, and a way to reach a person.</p>
        </div>
        <div className="phead__acts">
          <Btn icon={<IconChat />} variant="primary" onClick={() => setTicketOpen(true)}>
            Contact Support
          </Btn>
        </div>
      </div>

      <div style={{ maxWidth: 640, display: 'flex' }}>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search help — billing, sessions, client records"
          label="Search help articles"
        />
      </div>

      <div className="cols">
        <div className="left">
          <Section title="Common questions" sub="Updated when the product changes">
            <div className="chips" style={{ marginBottom: 14 }}>
              <Chips<Filter>
                value={filter}
                onChange={setFilter}
                options={FILTERS.map((f) => ({ key: f, label: f, count: counts[f] }))}
              />
            </div>

            {faqs.length === 0 ? (
              <EmptyCard
                mark={<IconHelp />}
                title="Nothing matches that"
                body="Try another word, or contact support and a person will answer."
                action={
                  <Btn icon={<IconChat />} variant="primary" onClick={() => setTicketOpen(true)}>
                    Contact Support
                  </Btn>
                }
              />
            ) : (
              <div className="faq">
                {faqs.map((f) => {
                  const isOpen = open === f.q;
                  return (
                    <article key={f.q} className="faq__item">
                      <h3 className="faq__q">
                        <button
                          type="button"
                          className="as-button"
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : f.q)}
                          style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left' }}
                        >
                          <span style={{ flex: 1 }}>{f.q}</span>
                          <span className={cx('faq__sign', isOpen && 'on')}>
                            <IconFaqSign />
                          </span>
                        </button>
                      </h3>
                      {isOpen && <p className="faq__a">{f.a}</p>}
                    </article>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Guides" sub="Longer reads for setting things up">
            <div className="grid2">
              {GUIDES.map((g) => (
                <Link key={g.title} href={g.href} className="card mod" style={{ minHeight: 180 }}>
                  <span className="mod__ic">
                    <IconHelp />
                  </span>
                  <div>
                    <h3 className="mod__t">{g.title}</h3>
                    <p className="mod__p">{g.body}</p>
                  </div>
                  <div className="mod__foot">
                    <div className="mod__meta">
                      <span>{g.minutes} min read</span>
                      <span>{g.tag}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </Section>
        </div>

        <aside className="panel">
          <span className="panel__glow" />
          <div>
            <h2 className="panel__t">Talk to Us</h2>
            <p className="panel__s">A real person, not a bot</p>
          </div>

          <article className="pcard">
            <div className="pcard__who">
              <span className="av av--client av--sm">SP</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="pcard__name">Support</span>
                <span className="prow__s">Replies within 1–2 business days</span>
              </span>
            </div>
            <div className="pcard__foot">
              <button
                type="button"
                className="vlink vlink--onpanel"
                style={{ width: '100%' }}
                onClick={() => setTicketOpen(true)}
              >
                <span>Raise a ticket</span>
                <span className="vlink__disc">
                  <IconArrowRightXs />
                </span>
              </button>
            </div>
          </article>

          <div className="panel__rows">
            <a className="prow" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('STAAD support request')}`}>
              <span style={{ display: 'flex', width: 38, height: 38, flex: 'none', alignItems: 'center' }}>
                <IconRowA />
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="prow__t">Email us</span>
                <span className="prow__s">{SUPPORT_EMAIL}</span>
              </span>
            </a>
            <div className="prow">
              <span style={{ display: 'flex', width: 38, height: 38, flex: 'none', alignItems: 'center' }}>
                <IconRowB />
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="prow__t">Support hours</span>
                <span className="prow__s">{SUPPORT_HOURS}</span>
              </span>
            </div>
          </div>
        </aside>
      </div>

      <DsDialog
        open={ticketOpen}
        onOpenChange={(o) => {
          setTicketOpen(o);
          if (!o) {
            setError('');
            setSentRef('');
          }
        }}
        title={sentRef ? 'Ticket submitted' : 'Contact support'}
        description={
          sentRef
            ? `Your reference is ${sentRef}. We'll reply by email.`
            : 'Tell us what happened and we will get back to you by email.'
        }
        footer={
          sentRef ? (
            <button className="ds-btn ds-btn-clay" onClick={() => setTicketOpen(false)}>
              Done
            </button>
          ) : (
            <>
              <button className="ds-btn ds-btn-ghost" onClick={() => setTicketOpen(false)}>
                Cancel
              </button>
              <button className="ds-btn ds-btn-clay" onClick={submit} disabled={sending}>
                {sending ? 'Sending…' : 'Send ticket'}
              </button>
            </>
          )
        }
      >
        {!sentRef && (
          <div className="space-y-4">
            <div className="field">
              <label htmlFor="h-cat">Category</label>
              <select id="h-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="h-subj">Subject</label>
              <input
                id="h-subj"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Short summary"
              />
            </div>
            <div className="field">
              <label htmlFor="h-msg">What happened?</label>
              <textarea
                id="h-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Include anything that helps us reproduce it."
              />
            </div>
            {error && <InlineError message={error} />}
          </div>
        )}
      </DsDialog>
    </StaadShell>
  );
}
