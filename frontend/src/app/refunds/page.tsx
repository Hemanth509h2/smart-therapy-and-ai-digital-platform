import LegalPage from '@/components/LegalPage';
import { REFUNDS_INTRO, REFUNDS_SECTIONS, REFUNDS_UPDATED } from '@/content/refunds';

export const metadata = {
  title: 'Refund Policy — STAAD',
  description: 'How STAAD Plans are paid, how to cancel, and when and how you can get a refund.',
};

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund Policy"
      updated={REFUNDS_UPDATED}
      intro={REFUNDS_INTRO}
      sections={REFUNDS_SECTIONS}
      current="/refunds"
    />
  );
}
