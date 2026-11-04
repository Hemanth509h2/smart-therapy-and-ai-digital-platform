import LegalPage from '@/components/LegalPage';
import type { PolicySection } from '@/content/legal';
import { SUBPROCESSORS, SUBPROCESSORS_UPDATED } from '@/content/subprocessors';

export const metadata = {
  title: 'Sub-processors — STAAD',
  description: 'Every outside company that receives personal data from STAAD: what it receives, why, where, and when.',
};

const INTRO = [
  'These are the outside companies ("sub-processors") that receive personal data from STAAD to help us run the Services. Each receives only what its job needs, under contracts or terms that require it to protect the data. We update this page before a new provider starts receiving personal data. See the Privacy Policy for how we handle personal data overall.',
];

const SECTIONS: PolicySection[] = SUBPROCESSORS.map((sp, i) => ({
  id: `sp-${i + 1}`,
  title: sp.name,
  body: [
    [
      `Purpose: ${sp.purpose}`,
      `Data: ${sp.data}`,
      `Location: ${sp.location}`,
      ...(sp.when ? [`When: ${sp.when}`] : []),
    ],
  ],
}));

export default function SubprocessorsPage() {
  return (
    <LegalPage
      title="Sub-processors"
      updated={SUBPROCESSORS_UPDATED}
      intro={INTRO}
      sections={SECTIONS}
      current="/subprocessors"
    />
  );
}
