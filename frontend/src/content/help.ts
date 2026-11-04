/**
 * Help centre copy.
 *
 * There is no CMS behind Help & Support, so this is the single place the FAQ
 * and guide copy lives — keep it here rather than scattering strings through
 * the page. Everything else on /help (support email, ticket form, the user's
 * own details) comes from config or the API.
 */

export const SUPPORT_EMAIL = 'om.cofounder@staad.in';
export const SUPPORT_HOURS = 'Weekdays, 09:00 — 18:00 IST';

export type HelpCategory = 'Sessions' | 'Billing' | 'Privacy' | 'Clients';

export interface Faq {
  q: string;
  a: string;
  category: HelpCategory;
}

export const FAQS: Faq[] = [
  {
    category: 'Sessions',
    q: 'What happens to a session if my connection drops?',
    a: 'The room stays open. Rejoin from the same link and you will be put back with your client — the session is not ended until you end it.',
  },
  {
    category: 'Sessions',
    q: 'Can I write session notes after the session has ended?',
    a: 'Yes, and the dashboard keeps reminding you until you do. A completed session without notes shows as "Notes pending" on the Dashboard and in the Sessions list.',
  },
  {
    category: 'Sessions',
    q: 'How do I run a therapy module with a client?',
    a: 'Open Therapy Modules, pick one, and start a session with it. The module opens inside the session room so you and your client see the same thing.',
  },
  {
    category: 'Clients',
    q: 'How do I add a client?',
    a: 'Use Add Client on the Dashboard or Clients page. Add their WhatsApp number so you can send them session links with Send on WhatsApp.',
  },
  {
    category: 'Clients',
    q: 'Who can see a client’s records?',
    a: 'You, as the therapist who added the client. Other therapists cannot see them. A small number of authorised STAAD administrators can open records only when it is needed to resolve a support request or a safety concern, and every such access is recorded in an audit log.',
  },
  {
    category: 'Billing',
    q: 'How do I change my plan?',
    a: 'Request the plan you want from the Plans page. Plan changes may need an admin’s approval before they take effect, so they are not always instant.',
  },
  {
    category: 'Billing',
    q: 'Will my plan renew or charge me automatically?',
    a: 'No. Plans are paid in advance for the term you choose (1, 3, 6 or 12 months) and never renew or charge you on their own. We email you before the term ends; to continue, renew it yourself from the Plans page. The price shown before you pay is the total you are charged.',
  },
  {
    category: 'Billing',
    q: 'How do I cancel my plan?',
    a: 'Open the Plans page and choose Cancel plan. You keep everything your plan includes until the end of the term you paid for, you can undo the cancellation until then, and afterwards your account moves to the free tier. Your clients and notes are kept.',
  },
  {
    category: 'Billing',
    q: 'Can I get a refund?',
    a: 'Payments for time already started are not refunded, but you are refunded if you were charged twice or the wrong amount, if a plan you paid for was never activated or was declined, or if the service was unavailable for a significant part of your term. See the Refund Policy for details and how to ask.',
  },
  {
    category: 'Billing',
    q: 'What decides which therapy tools I can use?',
    a: 'Your plan’s tool quota. If your plan covers a limited number of tools you choose them when you request the plan; anything outside that shows as locked.',
  },
  {
    category: 'Privacy',
    q: 'What happens to my data if I close my account?',
    a: 'Download a copy of your data from Profile first. Deleting the account then permanently removes your profile, clients, sessions, notes, reports and invites. Payment records are kept for as long as tax law requires, and a short record of administrator actions is kept for accountability.',
  },
  {
    category: 'Privacy',
    q: 'How do I get a copy of my data or ask for it to be deleted?',
    a: 'Therapists can download all their data, or delete their account, from Profile. Clients and parents should ask their therapist first; anyone can also email us at the support address below and we will respond within 30 days.',
  },
  {
    category: 'Privacy',
    q: 'What does the AI do with session audio?',
    a: 'Nothing, unless both you and your client agree at the start of the session. If you both agree, audio is sent live to our speech-to-text provider for captions and is not recorded. Transcripts are deleted automatically, by default within 48 hours. AI output is labelled as AI-generated, can be wrong, and is never used to make clinical decisions.',
  },
];

export interface Guide {
  title: string;
  body: string;
  minutes: number;
  tag: string;
  href: string;
}

export const GUIDES: Guide[] = [
  {
    title: 'Setting up your week',
    body: 'Working hours and the slots clients can book into without asking you first.',
    minutes: 4,
    tag: 'Getting started',
    href: '/profile',
  },
  {
    title: 'Writing notes that hold up',
    body: 'What to record after a session, and where those notes show up later.',
    minutes: 6,
    tag: 'Sessions',
    href: '/sessions',
  },
  {
    title: 'Choosing therapy modules',
    body: 'How the module library is organised, and how to run one live in a session.',
    minutes: 5,
    tag: 'Modules',
    href: '/modules',
  },
  {
    title: 'Plans and tool access',
    body: 'How plan quotas decide which tools you can open in the session room.',
    minutes: 3,
    tag: 'Billing',
    href: '/plans',
  },
];
