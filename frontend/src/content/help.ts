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
    a: 'Use Add Client on the Dashboard or Clients page. You get a private sign-up link, and if you add their WhatsApp number the invite is sent to them automatically.',
  },
  {
    category: 'Clients',
    q: 'Who can see a client’s records?',
    a: 'Only you. Client records are scoped to the therapist who created them.',
  },
  {
    category: 'Billing',
    q: 'How do I change my plan?',
    a: 'Request the plan you want from the Plans page. An admin reviews every plan change before it takes effect, so it is not instant.',
  },
  {
    category: 'Billing',
    q: 'What decides which therapy tools I can use?',
    a: 'Your plan’s tool quota. If your plan covers a limited number of tools you choose them when you request the plan; anything outside that shows as locked.',
  },
  {
    category: 'Privacy',
    q: 'What happens to my data if I close my account?',
    a: 'Export your data first from Profile — you get your session history as a file you keep. Deleting the account then removes your profile, sessions, notes and invites for good.',
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
