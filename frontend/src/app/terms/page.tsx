import LegalPage from '@/components/LegalPage';
import { TERMS_INTRO, TERMS_SECTIONS, TERMS_UPDATED } from '@/content/terms';

export const metadata = {
  title: 'Terms & Conditions — STAAD',
  description: 'The rules for using STAAD: accounts, therapist responsibilities, AI features, plans and payments, and liability.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      updated={TERMS_UPDATED}
      intro={TERMS_INTRO}
      sections={TERMS_SECTIONS}
      related={{ href: '/privacy', label: 'Privacy Policy' }}
    />
  );
}
