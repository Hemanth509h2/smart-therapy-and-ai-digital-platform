/**
 * Refund Policy copy, rendered by /refunds.
 *
 * Must stay consistent with "Plans, payments and renewals" and "Cancellation
 * and refunds" in terms.ts; change both together and bump REFUNDS_UPDATED.
 */

import { SUPPORT_EMAIL } from '@/content/help';
import { businessContactLines } from '@/content/business';
import type { PolicySection } from '@/content/legal';

export const REFUNDS_UPDATED = '4 November 2026';

export const REFUNDS_INTRO: string[] = [
  'This Refund Policy explains when you can get your money back for a STAAD Plan, and how. It is part of our Terms & Conditions. Nothing in it limits any right you have under the Consumer Protection Act, 2019.',
];

export const REFUNDS_SECTIONS: PolicySection[] = [
  {
    id: 'how-plans-are-paid',
    title: 'How paid Plans work',
    body: [
      [
        'Plans are paid once, in advance, for a fixed term of 1, 3, 6 or 12 months.',
        'The total shown before you pay is the full amount charged. There are no setup, cancellation or other hidden fees.',
        'Plans never renew or charge you automatically. We email you 7 days and 1 day before your term ends, and you decide whether to buy another term.',
      ],
    ],
  },
  {
    id: 'cancelling',
    title: 'Cancelling',
    body: [
      'You can cancel at any time from the Plans page, without contacting us. You keep everything your Plan includes until the end of the term you paid for, and you can undo the cancellation until then. After that your account moves to the free tier; your clients, notes and records are kept.',
    ],
  },
  {
    id: 'when-we-refund',
    title: 'When we refund',
    body: [
      'Because you keep access until the end of the term, we do not refund unused time when you cancel part-way through. We do give a full or partial refund when:',
      [
        'You were charged twice, charged the wrong amount, or charged for a Plan that was never activated — we refund the excess.',
        'An administrator declines your Plan request after you have paid — we refund the full amount.',
        'The Services were materially unavailable for a significant part of your term because of a fault on our side — we refund the affected part of the term.',
        'We change a paid Plan in a way that materially reduces its features during a term you have paid for — we refund the rest of that term pro rata, if you ask.',
        'The law requires a refund.',
      ],
    ],
  },
  {
    id: 'how-to-ask',
    title: 'How to ask for a refund',
    body: [
      `Email ${SUPPORT_EMAIL} within 30 days of the payment, from your account email, with the date and amount of the payment (or its payment reference) and a short reason.`,
      'Approved refunds go back to the original payment method through Cashfree Payments, normally within 7 to 10 working days of approval. Your bank may take longer to show the credit.',
      'If you are not happy with our decision, you can raise it with our Grievance Officer at the same address, or with a consumer commission.',
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    body: [businessContactLines()],
  },
];
