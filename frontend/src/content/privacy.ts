/**
 * Privacy policy copy.
 *
 * Like help.ts, there is no CMS behind this, so the whole policy lives here
 * and /privacy only renders it. When the product starts collecting something
 * new, or a new provider starts touching user data, update the matching
 * section and bump PRIVACY_UPDATED.
 */

import { SUPPORT_EMAIL } from '@/content/help';
import { businessContactLines } from '@/content/business';
import type { PolicySection } from '@/content/legal';

export const PRIVACY_UPDATED = '4 November 2026';

export const PRIVACY_INTRO: string[] = [
  'STAAD is a collaborative therapy platform that helps therapists run live online sessions, interactive therapy modules and progress tracking with their clients, many of whom are children and neurodivergent learners. Because the people who use STAAD trust us with some of the most sensitive information there is, we have written this policy to explain, in plain language and in detail, what we collect, why we collect it, who we share it with, how long we keep it and what control you have over it.',
  'This policy applies to the STAAD web application, the session room, the therapy modules, our WhatsApp and email messages, and any other service that links to this page (together, the "Services"). By using the Services you acknowledge that you have read this policy. If you do not agree with it, please do not use the Services.',
];

export const PRIVACY_SECTIONS: PolicySection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    body: [
      'The Services are operated by STAAD ("STAAD", "we", "us" or "our"). We are based in India and we process personal data in line with the Digital Personal Data Protection Act, 2023 (the "DPDP Act"), the Information Technology Act, 2000 and the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011, and any other law that applies to us.',
      `If you have any question about this policy or about how your information is handled, write to us at ${SUPPORT_EMAIL}. The same address reaches our Grievance Officer (see "Grievances and contact" below).`,
      businessContactLines(),
    ],
  },
  {
    id: 'who-this-covers',
    title: 'Who this policy covers',
    body: [
      'Different people use STAAD in different ways, and the information we hold about each of them differs too:',
      [
        'Therapists — professionals who create an account, manage their practice, add clients, schedule and run sessions, write notes and subscribe to a plan.',
        'Clients — the people therapists work with. Clients do not create STAAD accounts; they join sessions through a private link their therapist sends them. Where a client is a child, this includes the parent or guardian who receives the link and accompanies them.',
        'Guests — anyone who joins a single session through a guest link without signing in.',
        'Administrators — STAAD staff who run the platform, review plan requests and answer support tickets.',
        'Visitors — anyone who opens a public STAAD page, such as the sign-in page or this policy.',
      ],
      'Where this policy refers to "you", it means whichever of these applies to you.',
    ],
  },
  {
    id: 'roles',
    title: 'Our role and the therapist’s role',
    body: [
      'For therapist accounts, billing, support and the running of the platform itself, STAAD decides why and how personal data is processed, and we are the Data Fiduciary for that data.',
      'Client records are different. The therapist decides which clients to add, what to write about them, which sessions to run and which modules to use. For those clinical records the therapist is responsible for having a lawful basis and the consent of the client (or, for a child, the parent or guardian) before entering information into STAAD, and STAAD processes the records on the therapist’s behalf and on their instructions. If you are a client and want to access, correct or delete what your therapist has recorded about you, please contact your therapist first; we will help them respond and will assist you directly if you cannot reach them.',
    ],
  },
  {
    id: 'what-we-collect',
    title: 'Information we collect',
    body: [
      'We collect only what we need to provide the Services. Depending on how you use STAAD, this can include the following.',
      'Account and profile information (therapists and administrators):',
      [
        'Your name, email address and password. Passwords are handled by our authentication provider, Google Firebase Authentication; STAAD never sees or stores your password in readable form.',
        'Your phone number, if you add one, so we can send you session notifications on WhatsApp.',
        'Practice details you choose to add, such as your specialisation, qualifications, working hours and availability.',
        'Your role on the platform and, for administrators, the permissions you hold.',
        'A record of your consents: when you accepted this policy and the Terms & Conditions and which version, and whether you opted in to product update emails, with the time, IP address and browser of each choice.',
      ],
      'Client records (entered by the therapist):',
      [
        'The client’s name, date of birth and gender.',
        'Diagnoses or areas of need the therapist records, for example ADHD or anxiety.',
        'A parent or guardian’s email address and a WhatsApp phone number used to deliver session invites and reminders.',
        'Session notes, progress notes, progress measurements (such as mood, anxiety, focus or engagement scores) and progress reports written or generated for the client.',
        'The therapist’s confirmation, with the date, that they have the client’s consent — or, for a child, the name of the parent or guardian who gave consent.',
      ],
      'Session information:',
      [
        'Bookings and schedules: when a session is planned, who it is with and its status.',
        'Live audio and video. Session audio and video stream between participants in real time through our video provider. STAAD does not record session video or audio.',
        'Live captions and transcripts, only if both the therapist and the client agree to AI features for that session (see "AI features").',
        'Activity inside therapy modules, such as which module was used, scores, answers and completion, so that the therapist can see progress over time.',
        'Attention scores, if AI features are enabled — a number only, never video (see "AI features").',
        'Caption language choices, if translated captions are turned on.',
      ],
      'Payments and subscriptions:',
      [
        'The plan you hold, plan change requests and their review history, coupons you apply, and usage of plan-limited features.',
        'Payment order references, amounts, currency, status and timestamps. Card, UPI and bank details are entered directly with our payment provider, Cashfree Payments, and never reach STAAD’s servers.',
      ],
      'Communications:',
      [
        'Records of WhatsApp messages we send on a therapist’s behalf (invites, reminders, session links): the recipient number, the message type, delivery status and any delivery error.',
        'Emails we send you, such as account, billing and support emails.',
        'Support tickets: your name, email, role, the category and subject you choose and everything you write in the message, plus our replies.',
      ],
      'Technical information:',
      [
        'Server logs recording requests to our services, including IP address, browser and device type, the address requested, the response and the time. We use these to keep the Services secure and to diagnose problems.',
        'A security access log of signed-in activity: which account used which part of the Services and which record it concerned (by its ID), when, from which IP address and browser, and whether it succeeded. It never contains the content of sessions, notes or records. We keep it to detect and investigate unauthorised access, as the DPDP Rules require.',
        'Small settings saved in your own browser, such as your colour theme, whether the sidebar is collapsed, saved modules and caption preferences (see "Cookies and browser storage").',
        'If you accept analytics in the cookie banner: anonymous page-view statistics from Vercel Web Analytics, such as which pages are visited, the referring site, country and device type. It uses no cookies and does not identify you.',
      ],
      'We do not knowingly collect information about religion, caste, political opinions, financial account numbers or biometric identifiers, and we ask therapists not to enter such information into STAAD unless it is clinically necessary.',
    ],
  },
  {
    id: 'children',
    title: 'Children and sensitive information',
    body: [
      'STAAD is designed for therapy with children and neurodivergent learners, so we treat all client information — and especially health information and information about children — as sensitive.',
      [
        'Children never create STAAD accounts. A child takes part only through a session link sent to their therapist’s chosen contact, normally a parent or guardian.',
        'Before a therapist adds a child to STAAD, the therapist must obtain verifiable consent from the child’s parent or lawful guardian, as the DPDP Act requires. STAAD will not save a client under 18 until the therapist names the parent or guardian and confirms that this consent has been given; we record that confirmation and its date.',
        'We do not use children’s data for advertising, we do not build profiles of children for marketing, and we do not track children’s behaviour across other websites or apps.',
        'Health information is used only to deliver therapy through the Services and is never sold.',
      ],
      `If you are a parent or guardian and believe your child’s information was added to STAAD without your consent, contact us at ${SUPPORT_EMAIL} and we will work with the therapist to resolve it, including deleting the information where appropriate.`,
    ],
  },
  {
    id: 'how-we-use',
    title: 'How we use information',
    body: [
      'We use personal data for the following purposes, and not for any purpose incompatible with them:',
      [
        'To create and secure accounts, verify who is signing in and enforce the right level of access for therapists, clients, guests and administrators.',
        'To let therapists manage clients, schedule and run live sessions, use therapy modules, write notes and track progress.',
        'To send session invites, reminders and links by WhatsApp and email, as the therapist requests.',
        'To provide the optional AI features described below, when both participants consent.',
        'To process subscriptions and payments, apply coupons, enforce plan limits and keep the financial records the law requires.',
        'To answer support tickets and communicate with you about your account, plan, or changes to the Services or to this policy.',
        'To send therapists product updates and news, only if they opted in to them separately (see "Emails and marketing").',
        'To keep the Services safe: detecting and preventing fraud, abuse and security incidents, and investigating problems.',
        'To understand how the Services are used in aggregate — for example how many sessions run each week — so we can fix problems and improve them. Where we do this, we use counts and statistics, not the content of sessions or notes.',
        'To comply with law, respond to lawful requests from authorities, and establish, exercise or defend legal claims.',
      ],
      'We do not sell personal data, we do not rent it, and we do not use the content of therapy sessions, notes or client records to advertise to anyone.',
    ],
  },
  {
    id: 'ai',
    title: 'AI features',
    body: [
      'STAAD offers optional AI features that help therapists during and after a session. We want you to understand exactly how they work.',
      'Consent comes first. At the start of each session, both the therapist and the client see an AI consent prompt. AI features run only if both agree. Either participant can decline, and declining has no effect on the rest of the session — the call, modules and notes all work exactly the same.',
      'When both participants consent, the following may run:',
      [
        'Live transcription and captions. Session audio is streamed to our speech-to-text provider, Sarvam AI, through a STAAD relay so that captions can appear on screen. If translated captions are turned on, the selected languages are used to translate captions as well.',
        'In-session insights and the call plan for the therapist. Recent transcript text and session activity are sent to a large language model, accessed through OpenRouter, to suggest next steps and to flag possible safety concerns. Short excerpts may also be sent to NVIDIA to search STAAD’s clinical reference material. These insights are shown only to the therapist.',
        'An end-of-session report. After the session, the transcript, session activity, the therapist’s notes and the client’s first name, age and recorded conditions are sent to a large language model, accessed through OpenRouter, to draft a summary report for the therapist. The report is labelled as AI-generated, and it can only be generated for sessions where both participants consented.',
        'Attention scoring. The therapist’s browser can estimate whether the client is facing the screen, using a face-landmark model that runs entirely on the therapist’s own device. No video ever leaves the browser for this; only a numeric attention score is saved. It never analyses the therapist’s own camera.',
      ],
      'The AI observes and summarises; it never makes clinical decisions. Every insight, flag and report is a suggestion for the therapist, who remains responsible for all clinical judgement. AI output can be wrong or incomplete and should always be reviewed.',
      'Live transcripts are cleared automatically by a daily job once they are older than a retention window set by our administrators (24 hours by default), so a transcript is gone within 48 hours of the session. Session reports the therapist chooses to keep remain part of the client’s record until the therapist deletes them or closes their account.',
      'No AI training on your data. We do not use session content, notes or client records to train AI models, and we do not allow our providers to. Every request we send through OpenRouter instructs it to use only model providers that do not store prompts or use them for training; if no such provider is available the request fails rather than falling back to one that does. We send each AI provider only what its feature needs — for example, the client’s first name but not their full name.',
    ],
  },
  {
    id: 'legal-basis',
    title: 'Why we are allowed to process your information',
    body: [
      'Under the DPDP Act we process personal data either with consent or for a legitimate use the Act allows. In practice:',
      [
        'Consent — when you tick the box to accept this policy and the Terms & Conditions while setting up your account, when you separately opt in to product update emails, when you accept analytics cookies, when both participants agree to AI features in a session, and, for client records, the consent the therapist obtains from the client or their parent or guardian and confirms to us.',
        'Providing a service you asked for — running your account, sessions and subscription.',
        'Legal obligations — keeping tax and payment records, responding to lawful orders and reporting incidents where required.',
        'Safety and security — protecting our users and the Services from fraud, abuse and attack.',
      ],
      'Where we rely on consent, you can withdraw it at any time (see "Your rights"). Withdrawing consent does not affect processing that already took place, but it may mean we can no longer provide part of the Services — for example, without AI consent a session runs without captions.',
    ],
  },
  {
    id: 'sharing',
    title: 'Who we share information with',
    body: [
      'We share personal data only with the service providers who help us run STAAD (our sub-processors), only to the extent each one needs, and under contracts or terms that require them to protect it. The full, current list — with what each provider receives, why, where it is located and when it is used — is published on our Sub-processors page at /subprocessors. In summary:',
      [
        'Hosting and databases — Vercel (website and API), Neon on Amazon Web Services (databases), Render (AI service) and our cloud server provider (self-hosted video server and automation).',
        'Sign-in and real-time session data — Google Firebase.',
        'Email — Zoho Mail.',
        'AI features, only when both participants consent — Sarvam AI (captions), OpenRouter (language models) and NVIDIA (search of reference material).',
        'The therapist WhatsApp assistant — Anthropic (AI model) and Meta (WhatsApp).',
        'WhatsApp messages — Meta Platforms (WhatsApp Business Platform).',
        'Payments — Cashfree Payments.',
        'Analytics, only if you accept it — Vercel Web Analytics.',
      ],
      'We will update the Sub-processors page before a new provider starts receiving personal data.',
      'Our video server (LiveKit) and workflow automation (n8n, for example scheduled reminders) run on a server we operate ourselves, so session audio and video are not sent to a separate video company.',
      'Other than our service providers, we share personal data only:',
      [
        'Within a therapy relationship — a client’s records are visible to the therapist who created them; they are not shared with other therapists.',
        'With STAAD administrators, only where needed to run the platform, review plans or resolve a support request. Administrator access to records is limited by role and recorded in an audit log.',
        'When the law requires it, such as a valid court order or a lawful request from a government authority, or when we believe in good faith that disclosure is necessary to protect someone’s life or safety.',
        'If STAAD is involved in a merger, acquisition or sale of assets, in which case the information would remain protected by this policy and we would tell you before it became subject to a different one.',
        'With your direction or consent.',
      ],
    ],
  },
  {
    id: 'transfers',
    title: 'Where your information is stored',
    body: [
      'Some of our service providers store or process data outside India, including in the United States. Where data is transferred outside India, we do so only as the DPDP Act and any government notifications under it permit, and we rely on our providers’ contractual and technical safeguards to protect it to a standard comparable to this policy.',
    ],
  },
  {
    id: 'retention',
    title: 'How long we keep information',
    body: [
      'We keep personal data only for as long as we need it for the purposes in this policy, and then delete or anonymise it:',
      [
        'Live session transcripts and captions — cleared automatically by a daily job after the retention window (24 hours by default), so within 48 hours of the session.',
        'Session audio and video — not recorded or stored by STAAD.',
        'Therapist accounts and profiles — for as long as the account is open. When a therapist deletes their account, we delete their profile, sessions, notes, client records and invites.',
        'Client records, notes, progress data and reports — for as long as the therapist keeps them, or until the therapist’s account is deleted.',
        'Payment and invoicing records — for the period required by tax and accounting law, which is normally up to eight years, even after an account is closed.',
        'WhatsApp delivery records — deleted automatically after 180 days, or earlier when the related account is deleted.',
        'Consent records (policy acceptance, marketing choices, client consent confirmations) — for as long as the account is open and then for as long as we need them to show that consent was given, normally up to three years.',
        'Records of our scheduled jobs — deleted automatically after 90 days.',
        'Support tickets — for as long as needed to resolve the issue and keep a reasonable history of it.',
        'Security access log — one year and one month, then deleted automatically. The DPDP Rules require us to keep such logs for at least one year. It is kept for that period even if you delete your account, and is used only for security.',
        'Server logs — kept only for a limited period: our own servers keep a small, fixed amount of recent logs and overwrite older entries automatically, and our hosting provider keeps its logs for no more than 30 days. Logs needed to investigate an incident may be kept until the investigation ends.',
        'Administrator audit logs — at least one year, and for as long as needed to keep the platform accountable and meet our legal obligations.',
      ],
      'Copies of deleted data may remain in encrypted backups for a short time until those backups are overwritten in the normal cycle.',
    ],
  },
  {
    id: 'security',
    title: 'How we protect information',
    body: [
      'We use reasonable technical and organisational safeguards appropriate to the sensitivity of the information we hold, including:',
      [
        'Encryption in transit — every connection to STAAD uses HTTPS or secure WebSockets.',
        'Encryption at rest wherever our database and storage providers offer it.',
        'Verified sign-in for every request, and access controls that limit each person to their own data: a therapist sees only their own clients, and clients and guests see only the session they were invited to.',
        'Short-lived, session-bound tokens for joining calls and for live transcription, so that links and credentials cannot be reused for other sessions.',
        'API keys for our AI and messaging providers kept on our servers and never sent to browsers.',
        'Role-based permissions for administrators, with administrative actions recorded in an audit log.',
      ],
      'No system is perfectly secure, and we cannot guarantee that information will never be accessed, disclosed or altered in a way this policy does not allow. Please keep your password private and sign out on shared devices. If we become aware of a personal data breach that affects you, we will tell you without delay — what happened, what data was involved, the likely consequences, what we are doing about it and what you can do — and we will report it to the Data Protection Board of India, with a detailed report within 72 hours, as the DPDP Rules require.',
    ],
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: [
      'Subject to the law, you have the right to:',
      [
        'Access — ask for a summary of the personal data we hold about you and how we process it, and the identity of those we have shared it with.',
        'Correction and completion — ask us to correct inaccurate or incomplete data and update data that has changed. Therapists can edit most of their profile directly from Profile.',
        'Erasure — ask us to delete your personal data when it is no longer needed for the purpose it was collected for, unless we must keep it by law. Therapists can delete their account themselves from Profile.',
        'Access and export — therapists can download a copy of all the data STAAD holds about them and their clients from Profile, as a file to keep.',
        'Withdraw consent — at any time, as easily as you gave it. You can decline AI features at the start of any session, turn product update emails off from Profile or the unsubscribe link in any such email, and change your analytics choice from "Cookie settings" at the bottom of any legal page.',
        'Grievance redressal — complain to us and receive a response, and, if you are not satisfied, complain to the Data Protection Board of India.',
        'Nominate — nominate another person to exercise these rights on your behalf in the event of your death or incapacity.',
      ],
      `To exercise any of these rights, email ${SUPPORT_EMAIL} from the address linked to your account, or, if you are a client, contact your therapist. We may need to verify your identity before acting on a request. We will respond within the time the law requires, and in any case within 30 days. Parents and guardians may exercise these rights on behalf of their child.`,
    ],
  },
  {
    id: 'cookies',
    title: 'Cookies, browser storage and analytics',
    body: [
      'STAAD does not use advertising cookies, and we do not use tracking tools that follow you across other websites.',
      'Strictly necessary storage, which the Services need in order to work and which is always on:',
      [
        'Sign-in state, stored by Firebase Authentication so that you stay signed in.',
        'Preferences such as your colour theme, sidebar layout, saved modules and caption settings.',
        'Your cookie choice itself, so that we do not ask again on every visit.',
      ],
      'Optional analytics, only if you choose "Accept analytics" in the cookie banner: Vercel Web Analytics counts page views and visitors without cookies and without identifying you. Until you accept, its script is not loaded at all. You can change your choice at any time from "Cookie settings" at the bottom of any legal page.',
      'Fonts are served from STAAD’s own servers, so opening STAAD does not send your IP address to a font provider. One therapy module loads emoji images from the jsDelivr network, and the session whiteboard loads its fonts from esm.sh, only while they are open (see the Sub-processors page).',
      'You can also clear this storage at any time in your browser settings. If you do, you will be signed out and your preferences will reset.',
    ],
  },
  {
    id: 'emails',
    title: 'Emails and marketing',
    body: [
      'We send therapists service emails that are part of running the account — for example welcome and security notices, plan requests, receipts, cancellations and reminders before a term ends, session confirmations, report-ready notices and support replies. You cannot opt out of these while your account is open.',
      'When a therapist books, moves or cancels a session, we also email the client’s address the therapist entered (usually a parent or guardian). These emails contain only the therapist’s name and the session time — never notes, diagnoses or reports.',
      'Product updates and news are separate. We send them only to therapists who ticked the separate, unticked-by-default box for them, and every such email has a one-click unsubscribe link. You can also turn them off from Profile. We never send marketing to clients, parents, guardians or guests.',
    ],
  },
  {
    id: 'your-responsibilities',
    title: 'Responsibilities of therapists',
    body: [
      'Therapists who use STAAD remain bound by their own professional and legal duties of confidentiality. By using STAAD you agree to:',
      [
        'Obtain any consent the law requires before adding a client, including verifiable parental consent for children.',
        'Enter only the client information needed for therapy.',
        'Send session links only to the client or their parent or guardian, and keep your account credentials secure.',
        'Review AI-generated content before relying on it, and not treat it as a clinical decision.',
        'Respond to clients’ requests to access, correct or delete their records, with our help where needed.',
      ],
    ],
  },
  {
    id: 'links',
    title: 'Other websites and services',
    body: [
      'The Services may link to, or open, services run by other companies — for example the Cashfree payment page or WhatsApp. Those services have their own privacy policies, and we are not responsible for how they handle your information. We encourage you to read their policies.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: [
      'We may update this policy as the Services, the law or our providers change. The date at the top of this page shows when it was last updated. If a change materially affects how we use your personal data, we will tell you by email or within the Services before it takes effect and, where the law requires, ask for your consent again.',
    ],
  },
  {
    id: 'contact',
    title: 'Grievances and contact',
    body: [
      `If you have a question, a request about your data, or a complaint about how we have handled it, contact our Grievance Officer at ${SUPPORT_EMAIL}. Please include enough detail for us to understand and look into your request.`,
      'We aim to acknowledge every grievance within 48 hours and to resolve it within 30 days. If you are not satisfied with our response, you may complain to the Data Protection Board of India.',
      businessContactLines(),
    ],
  },
];
