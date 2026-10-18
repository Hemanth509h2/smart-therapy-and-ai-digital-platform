/**
 * Terms & Conditions copy.
 *
 * Like privacy.ts, there is no CMS behind this, so the whole document lives
 * here and /terms only renders it. When plans, billing or the rules of use
 * change, update the matching section and bump TERMS_UPDATED.
 */

import { SUPPORT_EMAIL } from '@/content/help';
import type { PolicySection } from '@/content/legal';

export const TERMS_UPDATED = '18 October 2026';

export const TERMS_INTRO: string[] = [
  'These Terms & Conditions (the "Terms") govern your use of STAAD, a collaborative therapy platform for running live online sessions, interactive therapy modules and progress tracking. They form a binding agreement between you and STAAD ("STAAD", "we", "us" or "our"). Please read them carefully, together with our Privacy Policy, which explains how we handle personal data and forms part of these Terms.',
  'These Terms apply to the STAAD web application, the session room, the therapy modules, our WhatsApp and email messages, and any other service that links to this page (together, the "Services"). By creating an account, joining a session or otherwise using the Services, you agree to these Terms. If you do not agree, do not use the Services.',
];

export const TERMS_SECTIONS: PolicySection[] = [
  {
    id: 'about',
    title: 'About STAAD',
    body: [
      'STAAD provides software that therapists use to deliver therapy online. We are a technology provider, not a healthcare provider. STAAD does not provide therapy, diagnosis, medical advice or treatment, and we do not employ, supervise, recommend or vouch for the therapists who use the Services.',
      'The therapeutic relationship is between the therapist and their client. The therapist alone is responsible for the care they provide, for every clinical decision they make and for complying with the professional and legal rules that apply to their practice.',
      'STAAD is not an emergency service. If you or someone you know is in crisis or at risk of harm, contact local emergency services immediately, or in India call 112, or the Tele-MANAS mental health helpline on 14416.',
    ],
  },
  {
    id: 'definitions',
    title: 'Definitions',
    body: [
      [
        '"Therapist" means a professional who creates a STAAD account to manage their practice and run sessions.',
        '"Client" means a person a therapist works with through the Services. Clients do not create STAAD accounts; they join sessions through a private link. Where a client is a child, "Client" includes the parent or guardian who receives the link and accompanies them.',
        '"Guest" means anyone who joins a single session through a guest link without signing in.',
        '"Administrator" means a member of STAAD staff who runs the platform.',
        '"Client Data" means the information a therapist enters into, or generates through, the Services about their clients, including client records, session notes, progress data, transcripts and reports.',
        '"Plan" means a subscription tier that sets which therapy tools and how much usage a therapist’s account includes.',
        '"AI Features" means the optional live captions, transcription, translation, in-session insights, attention scoring and end-of-session reports described in section 8.',
      ],
    ],
  },
  {
    id: 'eligibility',
    title: 'Eligibility',
    body: [
      'You may create a therapist account only if you:',
      [
        'Are at least 18 years old and able to enter into a binding contract under the law that applies to you.',
        'Are a qualified practitioner, or a trainee working under appropriate supervision, permitted to provide the services you deliver through STAAD in the places where you and your clients are located.',
        'Hold any registration, licence or insurance your profession requires, and keep it current for as long as you use the Services.',
        'Have not previously had a STAAD account suspended or terminated for breach of these Terms, unless we have agreed otherwise in writing.',
      ],
      'Clients and guests do not need an account. A child may take part in a session only through a link sent to their parent or guardian or another adult authorised by them, and only with that adult’s consent and, where appropriate, supervision.',
      'We may ask for evidence that you meet these requirements and may refuse, suspend or close an account if you do not.',
    ],
  },
  {
    id: 'accounts',
    title: 'Your account',
    body: [
      'You must give accurate and complete information when you sign up and keep it up to date. Your account is personal to you: do not share your sign-in details, and do not let anyone else use your account.',
      `You are responsible for everything that happens under your account. Choose a strong password, sign out on shared devices, and tell us at once at ${SUPPORT_EMAIL} if you suspect someone has accessed your account without permission.`,
      'Session links and guest links let someone join a specific session without signing in. Treat them as confidential and send them only to the intended client, their parent or guardian, or a guest you have invited. You are responsible for who you send them to.',
      'Administrator accounts are granted by invitation only and may be used only for running the platform.',
    ],
  },
  {
    id: 'therapist-duties',
    title: 'Therapist responsibilities',
    body: [
      'Because you decide what happens in your sessions and what is recorded about your clients, you agree that you will:',
      [
        'Provide your services in line with your professional code of ethics, your scope of practice and every law that applies to you, including laws on health records, telehealth and the protection of children.',
        'Obtain, before you add a client to STAAD, any consent the law requires — including, for a child, verifiable consent from their parent or lawful guardian — and explain to the client how STAAD and its AI Features will be used.',
        'Enter only the client information you need for therapy, keep it accurate, and respond to your clients’ requests to access, correct or delete their records.',
        'Assess whether online therapy is suitable for each client, and have a plan for what to do if a client is in crisis or at risk during or between sessions.',
        'Review every AI-generated caption, insight, flag and report before relying on it, and never treat AI output as a clinical decision or a substitute for your own judgement.',
        'Keep your own records where your profession or the law requires you to, rather than relying on STAAD as your only record-keeping system.',
        'Maintain any professional indemnity insurance your profession requires.',
      ],
      'You confirm that you have the right to enter all Client Data into the Services and that doing so does not breach anyone’s rights or any law.',
    ],
  },
  {
    id: 'client-terms',
    title: 'Clients, parents, guardians and guests',
    body: [
      'If you join a session as a client, parent, guardian or guest, you agree to use the session room only for the session you were invited to, not to record, photograph or screen-capture the session without the agreement of everyone in it, and to follow your therapist’s reasonable instructions.',
      'A parent or guardian who accompanies a child is responsible for the child’s use of the Services and for supervising them as appropriate to their age and needs.',
      'Questions about your therapy, your records or your therapist’s fees should go to your therapist first. STAAD will help where it can, but we are not a party to your agreement with your therapist.',
    ],
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: [
      'You must not, and must not help anyone else to:',
      [
        'Use the Services for anything unlawful, harmful, fraudulent or deceptive, or in breach of anyone’s privacy or confidentiality.',
        'Harass, threaten, abuse, exploit or discriminate against anyone, or share content that is sexually explicit, violent, hateful or harmful to children.',
        'Record, copy or share session audio, video, captions or transcripts without the consent of everyone involved and any consent the law requires.',
        'Access another person’s account, clients, sessions or data, or try to get around any access control, plan limit, consent prompt or security measure.',
        'Probe, scan or test the vulnerability of the Services, or interfere with or disrupt them, including by sending malware, overloading our systems or scraping them with automated tools, unless we have authorised it in writing.',
        'Copy, reverse engineer, decompile or create derivative works of the Services or the therapy modules, except as the law expressly allows.',
        'Resell, sublicense or share access to the Services, or use them to build a competing product.',
        'Impersonate anyone, misrepresent your qualifications, or give false information to us or to your clients.',
        'Upload content that infringes anyone’s intellectual property or other rights.',
      ],
      'We may remove content, restrict features, or suspend or close an account if we reasonably believe these rules have been broken, and we may report unlawful activity to the authorities.',
    ],
  },
  {
    id: 'ai',
    title: 'AI features',
    body: [
      'STAAD offers optional AI Features, including live captions and transcription, caption translation, in-session insights and safety flags for the therapist, attention scoring and end-of-session reports. How they work and what data they use is explained in the "AI features" section of our Privacy Policy.',
      'AI Features run in a session only when both the therapist and the client agree at the start of that session. Either participant may decline, and declining does not affect the rest of the session.',
      'You acknowledge that:',
      [
        'AI output is generated automatically and may be inaccurate, incomplete, out of date, mistranslated or inappropriate for a particular client. Captions may mishear speech, and attention scores are estimates.',
        'The AI observes and summarises; it does not diagnose, treat or make clinical decisions. A missing safety flag does not mean there is no risk, and a flag does not mean there is one.',
        'The therapist is solely responsible for deciding whether and how to use any AI output, and must review it before relying on it or sharing it.',
        'AI Features depend on third-party providers and may change, be limited by your Plan, or be unavailable from time to time.',
      ],
    ],
  },
  {
    id: 'plans',
    title: 'Plans, payments and renewals',
    body: [
      'STAAD offers a free tier and paid Plans. Each Plan sets which therapy tools you can use and may limit the number of active clients, sessions per month or AI session reports per month. The features and prices of each Plan are shown on the Plans page at the time you choose it.',
      'How paid Plans work:',
      [
        'Paid Plans are bought in advance for a fixed term — currently 1, 3, 6 or 12 months — and the price is shown in Indian Rupees before you pay. Prices include or exclude taxes as stated at checkout.',
        'Some Plan requests, such as Plans with a chosen set of tools, are reviewed by an Administrator before they take effect. We may decline a request, in which case any amount you have paid for it will be refunded.',
        'Payments are processed by our payment provider, Cashfree Payments. You agree to their terms when you pay, and STAAD never receives your card, UPI or bank details.',
        'Plans do not renew or charge you automatically. We will email you a reminder before your term ends; to continue, you renew it yourself from the Plans page.',
        'When a term ends without renewal, your account returns to the free tier. Your clients, notes and records are kept, but features outside the free tier will be locked.',
        'Coupons are subject to the conditions shown when you apply them, cannot be exchanged for cash and may be withdrawn at any time before they are used.',
      ],
      'We may change Plan features or prices. A change will not affect a term you have already paid for, and we will tell you before it applies to your next term.',
    ],
  },
  {
    id: 'cancellation',
    title: 'Cancellation and refunds',
    body: [
      'You can cancel a paid Plan at any time from the Plans page. When you cancel, you keep access to your Plan until the end of the term you have paid for, and you can undo the cancellation until then. Your account then returns to the free tier.',
      'Because terms are paid in advance and access continues until the end of the term, payments are not refundable for unused time or for a term you cancel part-way through, except:',
      [
        'Where you were charged twice, charged the wrong amount, or charged for a Plan that was never activated, in which case we will refund the excess.',
        'Where an Administrator declines your Plan request after you have paid.',
        'Where the Services were materially unavailable for a significant part of your term because of a fault on our side.',
        'Where the law requires a refund.',
      ],
      `To ask for a refund, write to ${SUPPORT_EMAIL} within 30 days of the payment with your account email and the payment reference. Approved refunds are made to the original payment method through Cashfree Payments, normally within 7 to 10 working days of approval, although your bank may take longer to show them.`,
    ],
  },
  {
    id: 'client-data',
    title: 'Ownership of your content',
    body: [
      'You keep all rights in the content you put into STAAD, including Client Data and session notes. You give STAAD a limited, non-exclusive licence to host, store, process, transmit and display that content only as needed to provide, secure and support the Services for you, and as described in our Privacy Policy.',
      'We do not sell Client Data, we do not use it for advertising and we do not use the content of sessions or notes to train our own AI models.',
      'You can export your session history from Profile. If you delete your account, we will delete your profile, sessions, notes, client records and invites as described in the Privacy Policy, except for records we must keep by law, such as payment records. Please export anything you need to keep before deleting your account.',
    ],
  },
  {
    id: 'our-ip',
    title: 'STAAD’s intellectual property',
    body: [
      'The Services — including the software, the therapy modules, games and activities, designs, text, graphics, clinical reference material we provide, and the STAAD name and logo — belong to STAAD or our licensors and are protected by intellectual property laws.',
      'For as long as you are allowed to use the Services, we give you a personal, non-exclusive, non-transferable, revocable licence to use them for delivering or receiving therapy, in line with these Terms and your Plan. No other rights are granted.',
      'If you send us feedback or suggestions, we may use them without any obligation to you.',
    ],
  },
  {
    id: 'third-parties',
    title: 'Third-party services',
    body: [
      'The Services rely on, and may link to, services run by other companies, such as our video, authentication, speech-to-text, AI, payment and messaging providers, which are listed in our Privacy Policy. Your use of those services may also be governed by their own terms. We are not responsible for services we do not control, although we choose our providers carefully.',
      'WhatsApp messages are sent through the WhatsApp Business Platform. Recipients must have WhatsApp to receive them, and delivery depends on Meta’s service.',
    ],
  },
  {
    id: 'availability',
    title: 'Availability and changes to the Services',
    body: [
      'We work to keep the Services available and reliable, but we do not promise that they will be uninterrupted, error-free or available at any particular time. Live sessions depend on your internet connection, device, browser, camera and microphone, as well as on our providers.',
      'We may carry out maintenance, which we will try to schedule outside normal working hours and announce in advance where it is planned. We may add, change or remove features, therapy modules or providers to improve the Services, for security, or because the law requires it. If a change materially reduces the features of a paid Plan during a term you have paid for, you may ask for a pro-rata refund for the rest of that term.',
    ],
  },
  {
    id: 'confidentiality',
    title: 'Privacy and confidentiality',
    body: [
      'Our Privacy Policy explains what personal data we collect, how we use and share it, how long we keep it, how we protect it, and the rights you have. By using the Services you agree that we may handle personal data as it describes.',
      'For Client Data, the therapist decides what is collected and why, and STAAD processes it on the therapist’s behalf. We keep Client Data confidential and let our staff access it only where needed to run the platform, resolve a support request or comply with the law.',
    ],
  },
  {
    id: 'disclaimers',
    title: 'Disclaimers',
    body: [
      'To the fullest extent the law allows, the Services are provided "as is" and "as available". We make no promise that the Services, the therapy modules or any AI output will be accurate, complete, suitable for a particular client or purpose, or will achieve any particular therapeutic outcome.',
      'Nothing in the Services is medical, psychological or legal advice. Therapy modules and clinical reference material are tools to support a qualified therapist and are not a substitute for professional judgement.',
      'Nothing in these Terms excludes any right you have under the Consumer Protection Act, 2019 or any other law that cannot be excluded by contract.',
    ],
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    body: [
      'To the fullest extent the law allows:',
      [
        'STAAD is not liable for any indirect, incidental, special or consequential loss, or for loss of profits, revenue, business, goodwill or data, however it arises.',
        'STAAD is not liable for the acts or omissions of therapists, clients or guests, for clinical decisions or outcomes, or for any reliance placed on AI output.',
        'STAAD is not liable for loss caused by your internet connection or devices, by third-party services we do not control, or by events beyond our reasonable control.',
        'STAAD’s total liability to you for all claims arising from or relating to the Services or these Terms in any 12-month period is limited to the amount you paid STAAD for the Services in that period, or ₹5,000 if you paid nothing.',
      ],
      'Nothing in these Terms limits liability for death or personal injury caused by our negligence, for fraud, or for anything else that cannot be limited by law.',
    ],
  },
  {
    id: 'indemnity',
    title: 'Indemnity',
    body: [
      'If you are a therapist, you agree to compensate STAAD, and our directors, employees and agents, for any claim, loss, liability, penalty or reasonable cost (including legal fees) that arises from the services you provide to your clients, the Client Data you enter, your failure to obtain a required consent, or your breach of these Terms or of any law.',
    ],
  },
  {
    id: 'termination',
    title: 'Suspension and termination',
    body: [
      'You can stop using the Services at any time, and you can delete your therapist account from Profile.',
      'We may suspend or close your account, or restrict access to part of the Services, if you seriously or repeatedly breach these Terms, if we must do so by law, if your use puts other users, clients or the Services at risk, or if a payment is reversed or found to be fraudulent. Where it is reasonable and lawful, we will tell you in advance and give you a chance to fix the problem and to export your data.',
      'When an account is closed, the licence in these Terms ends and the data is handled as set out in the Privacy Policy. Sections that by their nature should continue — including ownership, disclaimers, limitation of liability, indemnity and governing law — survive termination.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to these Terms',
    body: [
      'We may update these Terms as the Services, our Plans or the law change. The date at the top of this page shows when they were last updated. If a change is material, we will tell you by email or within the Services at least 14 days before it takes effect, unless a shorter period is needed for legal or security reasons. If you keep using the Services after a change takes effect, you accept the updated Terms; if you do not agree, you should stop using the Services and may cancel your Plan.',
    ],
  },
  {
    id: 'law',
    title: 'Governing law and disputes',
    body: [
      'These Terms are governed by the laws of India. Before starting any formal proceedings, please contact us so that we can try to resolve the problem informally; most concerns can be settled quickly this way.',
      'If a dispute cannot be resolved within 30 days, it will be subject to the exclusive jurisdiction of the competent courts in India where STAAD is registered, without affecting any right you have as a consumer to bring a claim before a consumer commission or court where you live.',
    ],
  },
  {
    id: 'general',
    title: 'General',
    body: [
      [
        'These Terms, together with the Privacy Policy and any terms shown when you buy a Plan, are the whole agreement between you and STAAD about the Services.',
        'If any part of these Terms is found to be unenforceable, the rest remains in effect.',
        'If we do not enforce a right straight away, we can still enforce it later.',
        'You may not transfer your rights under these Terms without our written consent. We may transfer ours as part of a merger, acquisition or sale of assets, and will tell you if we do.',
        'We are not responsible for any delay or failure caused by events beyond our reasonable control, such as natural disasters, network or power failures, or actions of government.',
        `We may send you notices by email to the address on your account or within the Services. You can send notices to us at ${SUPPORT_EMAIL}.`,
      ],
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    body: [
      `If you have any question about these Terms, write to us at ${SUPPORT_EMAIL}. For complaints about how your personal data is handled, see "Grievances and contact" in our Privacy Policy.`,
    ],
  },
];
