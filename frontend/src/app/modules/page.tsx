'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import {
  Badge,
  Btn,
  Chips,
  EmptyCard,
  InlineError,
  Notch,
  SearchBox,
  SkeletonCard,
  cx,
} from '@/components/staad/parts';
import { IconArrowRightXs, IconModules, IconPlus } from '@/components/staad/icons';
import { toast } from '@/components/practice/ui';
import { AddClientDialog, StartSessionDialog } from '@/components/practice/dialogs';
import { MODULE_CATEGORIES, resolveAllowedModuleIds } from '@/lib/modules';
import { type Tone } from '@/lib/practice';

const CATEGORY_LABEL: Record<string, string> = {
  sld: 'SLD',
  adhd: 'ADHD',
  'anxiety-dep': 'Anxiety & Depression',
  id: 'Intellectual Disability',
  general: 'General Therapy',
  skill: 'Skill Development',
};

const CATEGORY_TONE: Record<string, Tone> = {
  sld: 'clay',
  adhd: 'red',
  'anxiety-dep': 'green',
  id: 'blue',
  general: 'amber',
  skill: 'violet',
};

type Approach = 'CBT' | 'DBT';

// Card copy, the skill each module targets, a typical run length, and which
// therapeutic approach it draws on (drives the CBT / DBT filters).
const META: Record<string, { blurb: string; focus: string; minutes: string; approaches?: Approach[] }> = {
  'word-building': { blurb: 'Construct words from letters and sounds.', focus: 'Language', minutes: '5–10' },
  'whack-a-mole-math': { blurb: 'Math facts practice through whack-a-mole gameplay.', focus: 'Attention', minutes: '5–10' },
  'pixel-art-coding': { blurb: 'Learn coding basics through pixel art creation.', focus: 'Creativity', minutes: '10–15' },
  'bubble-splash': { blurb: 'Pop bubbles to practice letter-number recognition.', focus: 'Visual Processing', minutes: '5–10' },
  'n-back-challenge': { blurb: 'Dual n-back working memory training.', focus: 'Working Memory', minutes: '10–15' },
  maze: { blurb: 'Navigate mazes to build focus and planning.', focus: 'Planning', minutes: '10–15' },
  'simon-says': { blurb: 'Follow pattern sequences with increasing difficulty.', focus: 'Inhibitory Control', minutes: '5–10' },
  '5-4-3-2-1-grounding': { blurb: 'Sensory grounding exercise for anxiety management.', focus: 'Grounding', minutes: '5–10', approaches: ['DBT'] },
  'emotional-charades': { blurb: 'Identify and express emotions through play.', focus: 'Emotional Literacy', minutes: '10–15' },
  'virtual-box-popping': { blurb: 'Pop boxes to release built-up tension safely.', focus: 'Tension Release', minutes: '5–10', approaches: ['DBT'] },
  'worry-box': { blurb: 'Write worries down and set them aside in a box.', focus: 'Externalisation', minutes: '5–10', approaches: ['CBT'] },
  'drag-drop-sorting': { blurb: 'Sort objects by shape, colour and category.', focus: 'Cognitive Skills', minutes: '5–10' },
  'social-story-sequencing': { blurb: 'Put everyday social stories in the right order.', focus: 'Social Skills', minutes: '10–15' },
  'virtual-shop': { blurb: 'Practise everyday shopping and handling money.', focus: 'Life Skills', minutes: '10–15' },
  'emotion-wheel': { blurb: 'Explore and name the full spectrum of emotions.', focus: 'Emotion Awareness', minutes: '5–10', approaches: ['DBT'] },
  'defusion-river': { blurb: 'Watch thoughts float by like leaves on a river.', focus: 'Defusion (ACT)', minutes: '10–15' },
  'thought-challenger': { blurb: 'Challenge and reframe unhelpful thoughts.', focus: 'Cognitive Restructuring', minutes: '10–15', approaches: ['CBT'] },
  'micro-quest-board': { blurb: 'Complete small, achievable therapeutic quests.', focus: 'Behavioural Activation', minutes: '10–15', approaches: ['CBT'] },
  'values-card-sort': { blurb: 'Sort and prioritise personal values.', focus: 'Values (ACT)', minutes: '10–15' },
  'worry-vault': { blurb: 'Lock worries away until a scheduled worry time.', focus: 'Worry Time', minutes: '5–10', approaches: ['CBT'] },
  'facts-vs-feelings': { blurb: 'Separate what happened from how it felt.', focus: 'Reality Testing', minutes: '5–10', approaches: ['CBT'] },
  'story-choice-adventure': { blurb: 'Learn about consequences through interactive choices.', focus: 'Decision Making', minutes: '10–15' },
  'emotion-detective': { blurb: 'Work out how others feel in real-life situations.', focus: 'Empathy', minutes: '10–15' },
  'build-together': { blurb: 'Combine what you each know to build something.', focus: 'Collaboration', minutes: '10–15' },
  'treasure-quest': { blurb: 'Follow a chain of clues by sharing information.', focus: 'Communication', minutes: '10–15' },
};

interface ModuleCard {
  id: string;
  name: string;
  emoji: string;
  categoryId: string;
  category: string;
  blurb: string;
  focus: string;
  minutes: string;
  approaches: Approach[];
}

const MODULES: ModuleCard[] = MODULE_CATEGORIES.flatMap((cat) =>
  cat.modules.map((m) => ({
    id: m.id,
    name: m.name,
    emoji: m.emoji,
    categoryId: cat.id,
    category: CATEGORY_LABEL[cat.id] ?? cat.name,
    blurb: META[m.id]?.blurb ?? m.desc,
    focus: META[m.id]?.focus ?? '',
    minutes: META[m.id]?.minutes ?? '10–15',
    approaches: META[m.id]?.approaches ?? [],
  }))
);

const CHIPS = ['All', 'CBT', 'DBT', 'Anxiety & Depression', 'ADHD', 'Intellectual Disability', 'General Therapy'];
const FILTER_OPTIONS = ['All', 'Saved', 'CBT', 'DBT', ...MODULE_CATEGORIES.map((c) => CATEGORY_LABEL[c.id] ?? c.name)];

export default function ModulesPage() {
  return (
    <Suspense fallback={null}>
      <ModulesInner />
    </Suspense>
  );
}

const SAVED_KEY = 'staad-saved-modules';

function ModulesInner() {
  useTherapistGuard();
  const params = useSearchParams();
  const { profile, sessions, clients, loading, error, refresh } = usePracticeData();

  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [launch, setLaunch] = useState<{ id: string; name: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw) setSaved(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  const toggleSaved = (id: string) =>
    setSaved((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });

  // Deep links from the dashboard toolkit: ?category=CBT or ?q=grounding
  useEffect(() => {
    const cat = params.get('category');
    const q = params.get('q');
    if (cat && FILTER_OPTIONS.includes(cat)) setFilter(cat);
    if (q) setSearch(q);
  }, [params]);

  // Per-therapist module access is real: locked modules cannot be launched.
  const allowed = useMemo(() => new Set(resolveAllowedModuleIds(profile)), [profile]);

  const q = search.trim().toLowerCase();
  const filtered = MODULES.filter((m) => {
    if (filter === 'Saved') return saved.has(m.id);
    if (filter === 'CBT' || filter === 'DBT') return m.approaches.includes(filter as 'CBT' | 'DBT');
    return filter === 'All' || m.category === filter;
  }).filter(
    (m) => !q || [m.name, m.blurb, m.focus, m.category, ...m.approaches].some((v) => v.toLowerCase().includes(q))
  );

  const counts: Record<string, number> = {
    All: MODULES.length,
    Saved: saved.size,
    CBT: MODULES.filter((m) => m.approaches.includes('CBT')).length,
    DBT: MODULES.filter((m) => m.approaches.includes('DBT')).length,
  };

  const chipOptions = ['All', 'Saved', 'CBT', 'DBT', ...MODULE_CATEGORIES.map((c) => CATEGORY_LABEL[c.id] ?? c.name)].map(
    (key) => ({
      key,
      label: key,
      count: counts[key] ?? MODULES.filter((m) => m.category === key).length,
    })
  );

  return (
    <StaadShell>
      <TopBar sessions={sessions} />

      <div className="phead">
        <div>
          <div className="eyebrow">Therapy toolkit</div>
          <h1 className="phead__title">Modules</h1>
          <p className="phead__lead">Activities you can run live with a client in the session room.</p>
        </div>
        <div className="phead__acts">
          <Btn icon={<IconPlus />} variant="primary" onClick={() => setLaunch({ id: '', name: '' })}>
            Start a Session
          </Btn>
        </div>
      </div>

      {error && <InlineError message={error} onRetry={refresh} />}

      <div className="toolbar">
        <Chips value={filter} onChange={setFilter} options={chipOptions} />
        <span style={{ flex: 1 }} />
        <div style={{ maxWidth: 320, flex: 1, display: 'flex' }}>
          <SearchBox value={search} onChange={setSearch} placeholder="Search modules" label="Search modules" />
        </div>
      </div>

      {loading ? (
        <div className="grid3">
          <SkeletonCard height={230} />
          <SkeletonCard height={230} />
          <SkeletonCard height={230} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyCard
          mark={<IconModules />}
          title={filter === 'Saved' ? 'Nothing saved yet' : 'No modules match that'}
          body={
            filter === 'Saved'
              ? 'Save a module from any card to keep it here for quick access.'
              : 'Try a different search term or category.'
          }
          action={
            <Btn
              onClick={() => {
                setSearch('');
                setFilter('All');
              }}
            >
              Clear filters
            </Btn>
          }
        />
      ) : (
        <div className="grid3">
          {filtered.map((m) => {
            const locked = !allowed.has(m.id);
            const isSaved = saved.has(m.id);
            return (
              <article key={m.id} className={cx('card mod', locked && 'card--grey', isSaved && !locked && 'card--lime')}>
                <Notch width={52}>
                  <button
                    type="button"
                    className="nbtn arrow"
                    aria-label={locked ? `${m.name} is not enabled for your account` : `Open ${m.name}`}
                    onClick={() =>
                      locked
                        ? toast('That module is not enabled for your account yet.', 'error')
                        : setLaunch({ id: m.id, name: m.name })
                    }
                  >
                    <IconArrowRightXs />
                  </button>
                </Notch>

                <span className="mod__ic" aria-hidden>
                  <span style={{ fontSize: 24, lineHeight: '24px' }}>{m.emoji}</span>
                </span>

                <div>
                  <h3 className="mod__t">{m.name}</h3>
                  <p className="mod__p">{m.blurb}</p>
                </div>

                <div className="mod__foot">
                  <div className="mod__meta">
                    <span>{m.category}</span>
                    <span>{m.minutes} min</span>
                  </div>
                  <div className="mod__meta">
                    {locked ? (
                      <Badge tone="gray">Locked</Badge>
                    ) : (
                      <span>{m.focus}</span>
                    )}
                    <button
                      type="button"
                      className="as-button"
                      aria-pressed={isSaved}
                      aria-label={isSaved ? `Remove ${m.name} from saved` : `Save ${m.name}`}
                      onClick={() => toggleSaved(m.id)}
                      style={{ fontSize: 11.5, fontWeight: 700, textDecoration: 'underline' }}
                    >
                      {isSaved ? 'Saved' : 'Save'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <StartSessionDialog
        open={!!launch}
        onOpenChange={(open) => !open && setLaunch(null)}
        clients={clients}
        sessions={sessions}
        moduleId={launch?.id || undefined}
        onAddClient={() => {
          setLaunch(null);
          setAddOpen(true);
        }}
      />
      <AddClientDialog open={addOpen} onOpenChange={setAddOpen} onCreated={refresh} />
    </StaadShell>
  );
}
