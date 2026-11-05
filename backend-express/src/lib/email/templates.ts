import type { EmailContent } from './layout';
import { emailLink, formatDateIST, formatDateTimeIST, formatInr } from './format';

/**
 * Every service email STAAD sends to therapists and clients, as plain content
 * (layout.ts turns it into HTML + text and escapes everything).
 *
 * Privacy rule for all of them: no diagnosis, notes, report text, transcript,
 * progress data or risk details. Session emails carry names, times and links
 * only; client emails carry the therapist's name and the time.
 */

const hi = (firstName?: string | null) => `Hi ${firstName?.trim() || 'there'},`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

// ── Account ───────────────────────────────────────────────────────────────────

export function welcomeEmail(p: { firstName?: string | null }): EmailContent {
  return {
    tag: 'account.welcome',
    audience: 'account',
    subject: 'Welcome to STAAD',
    greeting: hi(p.firstName),
    paragraphs: [
      'Your STAAD therapist account is ready. You can add clients, schedule sessions and run therapy modules from your dashboard.',
      'You accepted our Privacy Policy and Terms & Conditions when you set up your account. You can read them again at any time.',
    ],
    button: { label: 'Open STAAD', url: emailLink('/') },
    links: [
      { label: 'Privacy Policy', url: emailLink('/privacy') },
      { label: 'Terms & Conditions', url: emailLink('/terms') },
      { label: 'Help & Support', url: emailLink('/help') },
    ],
  };
}

export function dataExportEmail(p: { firstName?: string | null; at: Date }): EmailContent {
  return {
    tag: 'account.export',
    audience: 'account',
    subject: 'A copy of your STAAD data was downloaded',
    greeting: hi(p.firstName),
    paragraphs: [`A copy of your STAAD data was downloaded on ${formatDateTimeIST(p.at)}.`],
    footnote: "If this wasn't you, reset your password from the STAAD sign-in page straight away and contact us.",
    button: { label: 'Go to sign-in', url: emailLink('/auth') },
  };
}

export function accountDeletedEmail(p: { firstName?: string | null; at: Date }): EmailContent {
  return {
    tag: 'account.deleted',
    audience: 'account',
    subject: 'Your STAAD account has been deleted',
    greeting: hi(p.firstName),
    paragraphs: [
      `Your STAAD account was deleted on ${formatDateTimeIST(p.at)}. Your profile, clients, sessions, notes and reports have been removed.`,
      'Payment records are kept for the period tax law requires, as our Privacy Policy explains.',
    ],
    footnote: "If you didn't ask for this, reply to this email or contact us straight away.",
    links: [{ label: 'Privacy Policy', url: emailLink('/privacy') }],
  };
}

export function termsAcceptedEmail(p: { firstName?: string | null; version: string; at: Date }): EmailContent {
  return {
    tag: 'account.terms',
    audience: 'account',
    subject: 'You accepted the updated STAAD Privacy Policy and Terms',
    greeting: hi(p.firstName),
    paragraphs: ['This confirms that you accepted the updated STAAD Privacy Policy and Terms & Conditions.'],
    details: [
      ['Version', p.version],
      ['Accepted', formatDateTimeIST(p.at)],
    ],
    links: [
      { label: 'Privacy Policy', url: emailLink('/privacy') },
      { label: 'Terms & Conditions', url: emailLink('/terms') },
    ],
  };
}

export function unsubscribedEmail(p: { firstName?: string | null }): EmailContent {
  return {
    tag: 'account.unsubscribed',
    audience: 'account',
    subject: "You're unsubscribed from STAAD product updates",
    greeting: hi(p.firstName),
    paragraphs: [
      "You won't receive STAAD product updates and news any more.",
      'You will still get service emails about your account, plan and sessions. You can turn product updates back on from your Profile.',
    ],
    button: { label: 'Open Profile', url: emailLink('/profile') },
  };
}

// ── Billing ───────────────────────────────────────────────────────────────────

const NO_AUTO_RENEWAL = 'No auto-renewal: STAAD plans are paid once for the term you choose and never charge you automatically.';
const billingLinks = () => [
  { label: 'Plans', url: emailLink('/plans') },
  { label: 'Refund Policy', url: emailLink('/refunds') },
];

export function planRequestReceivedEmail(p: {
  firstName?: string | null; planName: string; months: number; total: number; needsApproval: boolean;
}): EmailContent {
  return {
    tag: 'billing.request',
    audience: 'account',
    subject: `We received your request for the ${p.planName} plan`,
    greeting: hi(p.firstName),
    paragraphs: [
      p.needsApproval
        ? 'We received your plan request. An administrator will review it, and we will email you as soon as it is approved. You pay only after approval.'
        : 'We received your plan request. You can pay for it from the Plans page.',
      NO_AUTO_RENEWAL,
    ],
    details: [
      ['Plan', p.planName],
      ['Term', plural(p.months, 'month')],
      ['Total', formatInr(p.total)],
    ],
    links: billingLinks(),
  };
}

export function planRequestApprovedEmail(p: {
  firstName?: string | null; planName: string; months: number; total: number; awaitingPayment: boolean;
}): EmailContent {
  return {
    tag: 'billing.approved',
    audience: 'account',
    subject: p.awaitingPayment ? `Your ${p.planName} plan is approved: complete payment` : `Your ${p.planName} plan is active`,
    greeting: hi(p.firstName),
    paragraphs: [
      p.awaitingPayment
        ? 'Your plan request was approved. Pay from the Plans page to start it; the price below is fixed for this approval.'
        : 'Your plan request was approved and your plan has started. Nothing to pay.',
      NO_AUTO_RENEWAL,
    ],
    details: [
      ['Plan', p.planName],
      ['Term', plural(p.months, 'month')],
      ['Total', formatInr(p.total)],
    ],
    button: { label: p.awaitingPayment ? 'Pay now' : 'Open Plans', url: emailLink('/plans') },
    links: [{ label: 'Refund Policy', url: emailLink('/refunds') }],
  };
}

export function planRequestDeclinedEmail(p: { firstName?: string | null; planName: string }): EmailContent {
  return {
    tag: 'billing.declined',
    audience: 'account',
    subject: `Your request for the ${p.planName} plan was not approved`,
    greeting: hi(p.firstName),
    paragraphs: [
      `Your request for the ${p.planName} plan was not approved. If you had already paid for it, we will refund the full amount to your original payment method.`,
      'You can request another plan from the Plans page, or reply to this email if you have questions.',
      NO_AUTO_RENEWAL,
    ],
    links: billingLinks(),
  };
}

export function paymentReceiptEmail(p: {
  firstName?: string | null; planName: string; months: number; amount: number;
  discount?: number | null; couponCode?: string | null; orderId: string; paidAt: Date; periodEnd?: Date | null;
}): EmailContent {
  const details: Array<[string, string]> = [
    ['Plan', p.planName],
    ['Term', plural(p.months, 'month')],
  ];
  if (p.couponCode) details.push(['Coupon', `${p.couponCode}${p.discount ? ` (−${formatInr(p.discount)})` : ''}`]);
  details.push(['Amount paid', formatInr(p.amount)], ['Order ID', p.orderId], ['Paid on', formatDateTimeIST(p.paidAt)]);
  if (p.periodEnd) details.push(['Plan ends', formatDateIST(p.periodEnd)]);
  return {
    tag: 'billing.receipt',
    audience: 'account',
    subject: `Payment received: STAAD ${p.planName} plan`,
    greeting: hi(p.firstName),
    paragraphs: ['Thank you. We received your payment and your plan is active. Keep this email as your receipt.', NO_AUTO_RENEWAL],
    details,
    links: billingLinks(),
  };
}

export function paymentFailedEmail(p: { firstName?: string | null; planName: string; amount: number; orderId: string }): EmailContent {
  return {
    tag: 'billing.failed',
    audience: 'account',
    subject: 'Your STAAD payment was not completed',
    greeting: hi(p.firstName),
    paragraphs: [
      'Your payment was not completed, so your plan has not started. If any money left your account, your bank will return it automatically, usually within 5–7 working days.',
      'You can try again from the Plans page.',
      NO_AUTO_RENEWAL,
    ],
    details: [
      ['Plan', p.planName],
      ['Amount', formatInr(p.amount)],
      ['Order ID', p.orderId],
    ],
    button: { label: 'Try again', url: emailLink('/plans') },
    links: [{ label: 'Refund Policy', url: emailLink('/refunds') }],
  };
}

export function planCancelledEmail(p: { firstName?: string | null; planName: string; endsAt: Date; undone: boolean }): EmailContent {
  return p.undone
    ? {
        tag: 'billing.cancel_undone',
        audience: 'account',
        subject: `Your ${p.planName} plan will continue`,
        greeting: hi(p.firstName),
        paragraphs: [`You undid the cancellation. Your ${p.planName} plan continues until ${formatDateIST(p.endsAt)}.`, NO_AUTO_RENEWAL],
        links: billingLinks(),
      }
    : {
        tag: 'billing.cancelled',
        audience: 'account',
        subject: `Your ${p.planName} plan is cancelled`,
        greeting: hi(p.firstName),
        paragraphs: [
          `Your ${p.planName} plan is cancelled. You keep everything it includes until ${formatDateIST(p.endsAt)}, then your account moves to the free tier. Your clients, notes and records are kept.`,
          'You can undo the cancellation from the Plans page until then.',
          NO_AUTO_RENEWAL,
        ],
        links: billingLinks(),
      };
}

export function planEndedEmail(p: { firstName?: string | null; planName: string; endedAt: Date }): EmailContent {
  return {
    tag: 'billing.ended',
    audience: 'account',
    subject: `Your STAAD ${p.planName} plan has ended`,
    greeting: hi(p.firstName),
    paragraphs: [
      `Your ${p.planName} plan ended on ${formatDateIST(p.endedAt)}, and your account is now on the free tier. Your clients, notes and records are kept; features outside the free tier are locked.`,
      'To continue with a paid plan, choose one on the Plans page.',
      NO_AUTO_RENEWAL,
    ],
    button: { label: 'Choose a plan', url: emailLink('/plans') },
    links: [{ label: 'Refund Policy', url: emailLink('/refunds') }],
  };
}

// ── Sessions: to the client (or parent / guardian) ────────────────────────────

const CLIENT_LINK_NOTE = 'Your therapist will send you the link to join before the session. You will not need an account or password.';

export type SessionChange = 'scheduled' | 'rescheduled' | 'cancelled';

export function clientSessionEmail(p: {
  change: SessionChange; therapistName: string; when: Date; previous?: Date | null;
  /** The client's join link, when one could be included. */
  joinUrl?: string | null;
}): EmailContent {
  const therapist = p.therapistName.trim() || 'your therapist';
  if (p.change === 'cancelled') {
    return {
      tag: 'sessions.client_cancelled',
      audience: 'session',
      subject: `Session cancelled: ${formatDateTimeIST(p.when)}`,
      greeting: 'Hello,',
      paragraphs: [
        `Your online session with ${therapist} on ${formatDateTimeIST(p.when)} has been cancelled.`,
        'Your therapist will contact you to arrange another time.',
      ],
    };
  }
  const details: Array<[string, string]> = [['With', therapist], ['When', formatDateTimeIST(p.when)]];
  if (p.change === 'rescheduled' && p.previous) details.push(['Previously', formatDateTimeIST(p.previous)]);
  return {
    tag: p.change === 'rescheduled' ? 'sessions.client_rescheduled' : 'sessions.client_scheduled',
    audience: 'session',
    subject: p.change === 'rescheduled'
      ? `Session moved to ${formatDateTimeIST(p.when)}`
      : `Session booked: ${formatDateTimeIST(p.when)}`,
    greeting: 'Hello,',
    paragraphs: [
      p.change === 'rescheduled'
        ? `Your online session with ${therapist} has a new time.`
        : `An online session with ${therapist} has been booked.`,
      p.joinUrl
        ? 'Use the button below to join at the session time. You will not need an account or password. Keep this link private: it is only for you.'
        : CLIENT_LINK_NOTE,
    ],
    details,
    ...(p.joinUrl ? { button: { label: 'Join the session', url: p.joinUrl } } : {}),
    footnote: 'You are receiving this because your therapist entered this email address for session updates. If this reached you by mistake, please let us know.',
  };
}

/** The join link, sent when the therapist picks "Send by email" for a session. */
export function sessionLinkEmail(p: { therapistName: string; when: Date; joinUrl: string }): EmailContent {
  const therapist = p.therapistName.trim() || 'Your therapist';
  return {
    tag: 'sessions.client_link',
    audience: 'session',
    subject: `Your session link with ${therapist}`,
    greeting: 'Hello,',
    paragraphs: [
      `${therapist} has sent you the link to your online STAAD therapy session.`,
      'Use the button below to join. You will not need an account or password.',
      'Before you join: use a phone or laptop with a working camera and microphone, open the link in Chrome or Safari and allow camera and microphone access, and sit somewhere quiet and private.',
      'Keep this link private: it is only for you and this session, and it stops working when the session ends.',
    ],
    details: [['With', therapist], ['When', formatDateTimeIST(p.when)]],
    button: { label: 'Join the session', url: p.joinUrl },
    footnote: 'You are receiving this because your therapist entered this email address for session updates. If this reached you by mistake, please let us know.',
  };
}

// ── Sessions: to the therapist ────────────────────────────────────────────────

export function therapistSessionEmail(p: {
  change: SessionChange; firstName?: string | null; clientFirstName?: string | null; when: Date; previous?: Date | null;
  /** True when the client's email included their join link. */
  clientLinkSent?: boolean;
}): EmailContent {
  const who = p.clientFirstName?.trim() ? ` with ${p.clientFirstName.trim()}` : '';
  const verb = p.change === 'scheduled' ? 'booked' : p.change;
  const details: Array<[string, string]> = [['When', formatDateTimeIST(p.when)]];
  if (p.change === 'rescheduled' && p.previous) details.push(['Previously', formatDateTimeIST(p.previous)]);
  return {
    tag: `sessions.therapist_${p.change}`,
    audience: 'session',
    subject: `Session ${verb}: ${formatDateTimeIST(p.when)}`,
    greeting: hi(p.firstName),
    paragraphs: [
      `Your session${who} is ${verb}.`,
      p.change === 'cancelled'
        ? 'The client was told by email if they have an email address on file.'
        : p.clientLinkSent
          ? 'We emailed the client their join link.'
          : 'Send the client their join link from STAAD before the session.',
    ],
    details,
    button: { label: 'Open sessions', url: emailLink('/sessions') },
  };
}

export function reportReadyEmail(p: { firstName?: string | null; sessionDate: Date }): EmailContent {
  return {
    tag: 'sessions.report_ready',
    audience: 'session',
    subject: 'Your AI session report is ready',
    greeting: hi(p.firstName),
    paragraphs: [
      `The AI-generated draft report for your session on ${formatDateTimeIST(p.sessionDate)} is ready in STAAD.`,
      'It is a draft: review and edit it before relying on it or sharing it.',
    ],
    button: { label: 'Open sessions', url: emailLink('/sessions') },
  };
}
