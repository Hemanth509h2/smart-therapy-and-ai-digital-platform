/**
 * Sub-processors: every outside company that receives personal data from STAAD.
 *
 * Shown on /subprocessors and summarised in the Privacy Policy. When a provider
 * is added, removed or starts receiving new data, update this list, bump
 * SUBPROCESSORS_UPDATED and tell therapists as the Privacy Policy promises.
 */

export const SUBPROCESSORS_UPDATED = '4 November 2026';

export interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
  location: string;
  /** Only used when this is true for the session or user (e.g. AI consent). */
  when?: string;
}

export const SUBPROCESSORS: Subprocessor[] = [
  {
    name: 'Vercel Inc.',
    purpose: 'Hosting of the STAAD website and API; privacy-friendly page-view analytics',
    data: 'All data passing through the API; for analytics, pages visited and coarse device information (no cookies)',
    location: 'Singapore (API), global edge network',
    when: 'Analytics only after you accept analytics in the cookie banner',
  },
  {
    name: 'Neon Inc. (on Amazon Web Services)',
    purpose: 'Managed PostgreSQL databases',
    data: 'Account, billing, client records, sessions, notes, progress data, reports, support tickets',
    location: 'Singapore (AWS ap-southeast-1)',
  },
  {
    name: 'Google LLC — Firebase',
    purpose: 'Sign-in and authentication; real-time session data',
    data: 'Email, sign-in records; live captions, transcripts and module state during a session',
    location: 'United States and other Google regions',
  },
  {
    name: 'Zoho Corporation — Zoho Mail',
    purpose: 'Sending account, billing, support and (only if you opted in) product update emails',
    data: 'Name, email address and the email content',
    location: 'Zoho data centre for STAAD’s account (India for zoho.in accounts)',
  },
  {
    name: 'Render Services, Inc.',
    purpose: 'Hosting of the STAAD AI service, which relays live captions and prepares requests to our AI providers',
    data: 'Session audio while captions are on, transcript text, session activity and the client details sent to AI features',
    location: 'Render region chosen by STAAD',
    when: 'Only when both participants consent to AI features',
  },
  {
    // TODO before launch: replace with the company that runs the server on
    // staad.in (LiveKit and n8n), e.g. "Hetzner Online GmbH", and its region.
    name: 'Our cloud server provider',
    purpose: 'Runs STAAD’s self-hosted LiveKit media server for session audio and video, and the n8n automation that sends WhatsApp reminders',
    data: 'Live audio and video streams (relayed, not recorded), participant names, and the schedule details in reminders',
    location: 'Server region chosen by STAAD',
  },
  {
    name: 'Sarvam AI',
    purpose: 'Speech-to-text for live captions and caption translation',
    data: 'Session audio while captions are on',
    location: 'India',
    when: 'Only when both participants consent to AI features',
  },
  {
    name: 'OpenRouter, Inc.',
    purpose: 'Access to large language models for in-session insights, the call plan and end-of-session reports',
    data: 'Transcript text, session activity, therapist notes, the client’s first name, age and recorded conditions',
    location: 'United States; model providers in the United States and other regions',
    when: 'Only when both participants consent to AI features. Requests are restricted to providers that do not store prompts or use them for training',
  },
  {
    name: 'NVIDIA Corporation',
    purpose: 'Text embeddings used to search STAAD’s clinical reference material and past module reports',
    data: 'Short excerpts of transcript or report text used as search queries',
    location: 'United States',
    when: 'Only when both participants consent to AI features',
  },
  {
    name: 'Anthropic, PBC',
    purpose: 'AI model behind the therapist WhatsApp assistant',
    data: 'The therapist’s questions and the schedule details needed to answer them, such as client names, ages and conditions',
    location: 'United States',
    when: 'Only when a therapist messages the assistant',
  },
  {
    name: 'Meta Platforms, Inc. — WhatsApp Business Platform',
    purpose: 'Delivering session invites, reminders, session links and assistant replies on WhatsApp',
    data: 'Recipient phone number and message content',
    location: 'United States and other Meta regions',
  },
  {
    name: 'Cashfree Payments India Pvt. Ltd.',
    purpose: 'Payment processing for subscriptions',
    data: 'Name, email, phone number, order amount; card, UPI and bank details are entered directly with Cashfree',
    location: 'India',
  },
  {
    name: 'jsDelivr (Prospect One / Cloudflare and Fastly CDNs)',
    purpose: 'Delivering emoji images in one therapy module',
    data: 'IP address and browser details of the device loading the module',
    location: 'Global CDN',
    when: 'Only while that module is open',
  },
  {
    name: 'esm.sh',
    purpose: 'Delivering the fonts used by the session whiteboard',
    data: 'IP address and browser details of the device opening the whiteboard',
    location: 'Global CDN',
    when: 'Only while the whiteboard is open',
  },
];
