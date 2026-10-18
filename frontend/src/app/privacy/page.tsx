import LegalPage from '@/components/LegalPage';
import { PRIVACY_INTRO, PRIVACY_SECTIONS, PRIVACY_UPDATED } from '@/content/privacy';

export const metadata = {
  title: 'Privacy Policy — STAAD',
  description: 'What STAAD collects, why, who it is shared with, how long it is kept and the rights you have.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated={PRIVACY_UPDATED}
      intro={PRIVACY_INTRO}
      sections={PRIVACY_SECTIONS}
      related={{ href: '/terms', label: 'Terms & Conditions' }}
    />
  );
}
