from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "Staad_Team_Workdown (2) (1).docx"
OUTPUT = ROOT / "docs" / "STAAD_Actual_Work_Remaining_and_Therapist_Beta_Plan_2026-09-07_to_2026-10-31.docx"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def run(text="", style=None, bold=False, color=None, size=None):
    props = []
    if bold:
        props.append("<w:b/>")
    if color:
        props.append(f'<w:color w:val="{color}"/>')
    if size:
        props.append(f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>')
    space = ' xml:space="preserve"' if text.startswith(" ") or text.endswith(" ") else ""
    rpr = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    return f"<w:r>{rpr}<w:t{space}>{escape(str(text))}</w:t></w:r>"


def para(text="", style=None, bold=False, align=None, before=None, after=100, keep=False):
    ppr = []
    if style:
        ppr.append(f'<w:pStyle w:val="{style}"/>')
    if align:
        ppr.append(f'<w:jc w:val="{align}"/>')
    if before is not None or after is not None:
        ppr.append(f'<w:spacing w:before="{before or 0}" w:after="{after or 0}"/>')
    if keep:
        ppr.append("<w:keepNext/>")
    pp = f"<w:pPr>{''.join(ppr)}</w:pPr>" if ppr else ""
    return f"<w:p>{pp}{run(text, bold=bold)}</w:p>"


def bullet(text):
    return para("• " + text, after=70)


def table(headers, rows, widths=None):
    n = len(headers)
    widths = widths or [int(9000 / n)] * n
    grid = "".join(f'<w:gridCol w:w="{x}"/>' for x in widths)
    def cell(value, header=False, width=1800):
        shade = '<w:shd w:fill="1F4E78"/>' if header else ('<w:shd w:fill="DDEBF7"/>' if str(value).startswith("TOTAL") else "")
        tcpr = f'<w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{shade}<w:vAlign w:val="center"/></w:tcPr>'
        color = "FFFFFF" if header else None
        return f"<w:tc>{tcpr}<w:p><w:pPr><w:spacing w:after=\"40\"/></w:pPr>{run(value, bold=header, color=color)}</w:p></w:tc>"
    trs = ["<w:tr>" + "".join(cell(h, True, widths[i]) for i, h in enumerate(headers)) + "</w:tr>"]
    for row in rows:
        trs.append("<w:tr>" + "".join(cell(v, False, widths[i]) for i, v in enumerate(row)) + "</w:tr>")
    borders = '<w:tblBorders>' + ''.join(f'<w:{e} w:val="single" w:sz="4" w:color="A6A6A6"/>' for e in ['top','left','bottom','right','insideH','insideV']) + '</w:tblBorders>'
    return f'<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>{borders}<w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{"".join(trs)}</w:tbl>'


parts = []
parts += [
    para("STAAD", bold=True, align="center", after=40),
    para("Smart Therapy & Assistance Digital Platform", bold=True, align="center", after=40),
    para("Beta Launch Team Work Breakdown & Execution Plan", bold=True, align="center", after=40),
    para("8-Member Cross-Functional Team", align="center", after=30),
    para("7 September 2026 – 31 October 2026", align="center", after=30),
    para("Prepared for Team Execution and Incubator Review", align="center", after=300),
    para("1. Programme Overview", style="Heading1"),
    para("This plan is based on the work demonstrably left in the STAAD repository. It takes the product through a September completion-and-hardening phase and then a full month of supervised therapist testing from 1 October to 31 October 2026. During October, therapists will report issues whenever they encounter them; the team will triage, fix, verify and release improvements in parallel while selected AI, product and operational development continues."),
    para("The operating principle is evidence before expansion. From 7–30 September the team closes the beta-critical technical, design, security and operational gaps. From 1–31 October the product remains in controlled therapist beta: real usage, feedback and incidents become the highest-priority backlog, while non-blocking AI and product improvements continue behind clear release controls."),
    para("A weekly review will be presented to D. Hari Krishna, Associate Dean, MDP. Scope changes affecting launch date, privacy, safety, or clinical workflows require co-founder approval and must be recorded in the decision log."),
    para("1.1 Team Composition", style="Heading2"),
    table(["Role", "Count", "Primary ownership"], [
        ["UI/UX Design", "2", "Product flows, responsive screens, design system, usability validation, launch assets"],
        ["AI Engineering", "2", "Copilot/STT/RAG quality, WhatsApp intelligence, guardrails, evaluation and monitoring"],
        ["Backend Engineering", "1", "Authorization, APIs, data integrity, webhooks, logging, deployment readiness"],
        ["Frontend Engineering", "1", "Design implementation, integrations, responsiveness, accessibility, error states"],
        ["Co-founder / Product Lead", "1", "Scope, clinical/stakeholder validation, prioritization, QA gates, beta operations"],
        ["Social Media & Community", "1", "Pre-launch awareness, content, beta recruitment, feedback and launch communication"],
    ], [1900,700,6400]),
    para("1.2 Programme Outcomes", style="Heading2"),
]
for x in [
    "A therapist can be onboarded, invite a patient, conduct a consent-gated session, use the required therapy tools, review AI-assisted notes, and complete follow-up without a launch-blocking defect.",
    "Therapists can access only their own assigned patients; authorization is enforced server-side and verified with negative tests.",
    "AI output is assistive, traceable, clearly labelled, and covered by consent, safety, escalation, and human-review controls.",
    "The product works on agreed desktop/tablet/mobile breakpoints with usable loading, empty, error, and recovery states.",
    "Monitoring, incident ownership, rollback steps, support intake, privacy copy, onboarding material, and feedback collection are ready before external beta invitations.",
    "Beta communication makes no unsupported clinical claims and accurately sets expectations about limited access and human oversight.",
    "Therapists actively test the platform for the complete period from 1–31 October, with every issue or suggestion captured, prioritized, assigned, fixed or formally deferred, and communicated back to the reporter.",
    "The co-founder builds the client pipeline, closes suitable beta and paid opportunities, finalizes commercials, manages the team, and owns day-to-day operations throughout the programme.",
]: parts.append(bullet(x))

parts += [
    para("2. College Hour Justification", style="Heading1"),
    para("The schedule continues the approved student-working model from the reference plan. Monday remains a full college day with no STAAD work. Tuesday and Wednesday combine a 3-hour permission block with 2 evening hours. Thursday, Friday, and Saturday provide 6 project hours each. Sunday is protected as an off day. This creates a sustainable 28-hour standard week while retaining one non-negotiable college day and one recovery day."),
    table(["Day", "College permission", "Planned STAAD contribution", "Justification"], [
        ["Sunday", "Not applicable", "Off", "Recovery and schedule buffer; not counted in committed capacity"],
        ["Monday", "None", "Off", "Full college attendance; no project absence requested"],
        ["Tuesday", "Half-day", "5 hours", "3-hour permission block plus 8:00–10:00 PM independent work"],
        ["Wednesday", "Half-day", "5 hours", "Same limited-permission structure; suited to reviews and integration"],
        ["Thursday", "Full-day", "6 hours", "Protected deep-work block for design, engineering and test execution"],
        ["Friday", "Full-day", "6 hours", "Core build/integration day; holiday reductions applied where relevant"],
        ["Saturday", "Full-day", "6 hours, flexed", "Work may be split around the existing 2–3 hour NCC commitment"],
    ], [1050,1500,1850,4600]),
    para("Standard weekly commitment: 28 hours per member. Meetings are included in these hours; they are not additional workload."),
    para("3. Holidays and Capacity", style="Heading1"),
    para("The calendar below uses the notified Telangana 2026 general holidays relevant to this period. Holidays already falling on a planned off-day do not reduce project capacity. Any college-specific vacation or examination schedule must be added by the co-founder when officially confirmed."),
    table(["Date", "Day", "Occasion", "Capacity treatment"], [
        ["14 Sep 2026", "Monday", "Vinayaka Chavithi", "No reduction: Monday is already off"],
        ["02 Oct 2026", "Friday", "Mahatma Gandhi Jayanti", "6 hours removed"],
        ["11 Oct 2026", "Sunday", "Bathukamma starting day", "No reduction: Sunday is already off"],
        ["19 Oct 2026", "Monday", "Durgashtami / Mahanavami", "No reduction: Monday is already off"],
        ["20 Oct 2026", "Tuesday", "Vijaya Dasami / Dussehra", "5 hours removed"],
    ], [1500,1000,2900,3600]),
    para("3.1 Week-by-Week Capacity per Member", style="Heading2"),
    table(["Week", "Date range", "Hours", "Primary programme gate"], [
        ["Week 1", "7–13 Sep", "28", "Repository-gap validation, ownership and beta journey freeze"],
        ["Week 2", "14–20 Sep", "28", "Security, design, AI and API contracts approved"],
        ["Week 3", "21–27 Sep", "28", "Critical implementation, integration and therapist recruitment"],
        ["Week 4", "28 Sep–4 Oct", "22", "Readiness gate; therapist testing begins 1 Oct; Gandhi Jayanti excluded"],
        ["Week 5", "5–11 Oct", "28", "Therapist feedback, P0/P1 fixes and controlled improvements"],
        ["Week 6", "12–18 Oct", "28", "Therapist testing, AI evaluation and commercial follow-up"],
        ["Week 7", "19–25 Oct", "23", "Therapist testing, stability fixes and client onboarding; Dussehra excluded"],
        ["Week 8", "26–31 Oct", "28", "Final test-week, outcomes review and November handoff"],
        ["TOTAL", "7 Sep–31 Oct", "213", "Per member; 1,704 team-hours across 8 members"],
    ], [1200,1900,900,5000]),
    para("Capacity is a planning ceiling, not a requirement to fill time. Launch-critical defects, privacy/safety controls, and complete user journeys take priority over lower-value feature additions."),
    para("4. Repository-Based Work Remaining", style="Heading1"),
    para("The following baseline comes from the current application code and project knowledge documents. It replaces generic feature planning with work that is still incomplete, partially implemented, manually operated or awaiting production validation."),
    table(["Observed project state", "Work remaining before/during beta", "Primary owners", "Why it is required"], [
        ["API routes currently trust client-passed IDs", "Add Firebase ID-token verification, role checks and therapist–patient ownership enforcement across protected APIs", "Backend", "This is the highest-priority privacy and tenant-isolation gap before external therapist use"],
        ["Formal healthcare/DPDP-style handling is not completed", "Document consent records, retention, access, incident and data-minimization procedures; obtain appropriate review", "Co-founder + Backend", "Therapist testing involves sensitive information and needs explicit operating controls"],
        ["WhatsApp invite delivery exists; conversational service is not complete", "Stabilize invite delivery/status first; build only approved reminder, FAQ and human-handoff flows after the core beta path is reliable", "Backend + AI 2", "This keeps WhatsApp work aligned with actual implementation and avoids unsafe over-scoping"],
        ["Module activity logging is wired into only part of the library", "Add meaningful-event logging to beta-priority modules and verify that reports receive the events", "Frontend + AI 1", "AI reports should reflect what happened in therapy modules, not only the transcript"],
        ["Attention scoring exists but is not connected to the remote-video path", "Validate consent, usefulness and performance with therapists before controlled wiring or deferral", "AI 1 + Frontend", "Attention inference is sensitive and should not be launched simply because a hook exists"],
        ["Plan prices are placeholders; payment automation is not built", "Finalize commercial packages and use documented manual approval/collection for beta; defer automated billing unless essential", "Co-founder + Backend", "Commercial readiness is necessary, but payment scope must not displace safety and core reliability"],
        ["SMTP support requires production credentials", "Configure and test support email delivery and fallback ownership", "Backend + Co-founder", "Therapists need a reliable support route throughout the month-long test"],
        ["Client progress/streak data includes illustrative placeholders", "Replace with real data or label/remove from beta", "Frontend + UI/UX", "Test users must not mistake mock indicators for genuine clinical progress"],
        ["Multiple screens have passed type checks but await visual validation", "Run responsive, theme, browser, accessibility and end-to-end visual QA", "UI/UX + Frontend", "A therapist beta will expose workflow and device issues that compile checks cannot find"],
        ["AI depends on external STT, model and embedding providers", "Establish evaluation baselines, failure fallbacks, latency/cost monitoring and human-review rules", "AI team + Backend", "Provider failures or poor outputs must not interrupt or mislead a therapy session"],
    ], [2450,3000,1450,2100]),
    para("5. Therapist Testing Model — 1 to 31 October", style="Heading1"),
    para("Therapist testing is not a final one-day acceptance event. It is the main operating mode for the whole of October. The beta remains controlled, consented and supported; new participants are added only at a pace the team can service."),
    table(["Step", "Service rule", "Evidence"], [
        ["1. Capture", "Therapists submit an issue whenever found through the in-product support route or agreed channel. The team records reporter, date, role, device, session, steps, expected/actual result and consent-safe evidence.", "Unique feedback/defect ID"],
        ["2. Triage", "Co-founder plus relevant lead reviews new items daily. P0 safety/privacy/session-stopping issues receive immediate containment; P1 within 24 hours; lower priorities enter the weekly backlog.", "Severity, owner and target date"],
        ["3. Build", "Engineering/design reproduce and resolve the issue. AI changes use a versioned evaluation set; backend changes include authorization/regression tests; UI changes cover responsive states.", "Fix plus test evidence"],
        ["4. Verify", "A second team member verifies on staging. The reporting therapist is asked to retest material workflow issues before closure.", "Verified/reopened status"],
        ["5. Release", "Small controlled releases are preferred. Every release has notes, monitoring and rollback/disable steps.", "Release ID and change note"],
        ["6. Learn", "Saturday review groups recurring feedback into product, AI, usability, training, commercial and support themes.", "Weekly insight and decision log"],
    ], [1100,6100,1800]),
    para("5.1 October Severity and Response Targets", style="Heading2"),
    table(["Severity", "Meaning", "Target response"], [
        ["P0", "Privacy/security breach, unsafe AI escalation, data loss or session cannot continue", "Acknowledge immediately; contain/disable first; co-founder owns communication"],
        ["P1", "Core workflow blocked with no reasonable workaround", "Triage within 24 hours; prioritize next safe release"],
        ["P2", "Workflow degraded but workaround exists", "Review in weekly planning and schedule by impact/frequency"],
        ["P3", "Suggestion, polish or future capability", "Record, validate pattern and place in post-beta roadmap if not essential"],
    ], [1100,4500,3400]),
    para("6. Shared Operating Rhythm and Accountability", style="Heading1"),
]
for x in [
    "Tuesday: weekly planning, dependency check, and measurable outcome selection (30 minutes). During October, unresolved therapist P0/P1 items are reviewed first.",
    "Wednesday: design/API/AI contract review so handoffs are approved before implementation drifts.",
    "Friday: integrated demo and controlled release review. During October, fixes are demonstrated against the original therapist feedback before closure.",
    "Saturday: QA, documentation, analytics review, retrospective, and mentor-ready progress summary.",
    "Every task must have one owner, acceptance criteria, evidence link, target date, status, and blocker. A task is complete only when reviewed in the integrated product or approved deliverable.",
]: parts.append(bullet(x))


def role_section(number, title, mission, stages):
    out = [para(f"{number}. {title}", style="Heading1"), para(mission)]
    for heading, training, items in stages:
        out.append(para(heading, style="Heading2"))
        out.append(para("Focused training: " + training, bold=True))
        out.append(table(["Owned work", "Deliverable / acceptance evidence", "Why this work is justified"], items, [2850,3050,3100]))
    return out


parts += role_section("7", "UI/UX Design — Two Designers",
"The designers work as separate owners with a shared design system. UI/UX Designer 1 owns therapist and administrative journeys; UI/UX Designer 2 owns patient/therapy experiences and launch-support visuals. Both participate in research, critique, accessibility review, and handoff. This split increases parallel output without producing two inconsistent products.", [
    ("September Stage 1 — Audit and Flow Freeze (7–19 Sep)", "healthcare UX, trauma-informed design, accessibility basics, responsive components, and developer-ready Figma handoff.", [
        ["Designer 1: audit therapist onboarding, dashboard, patient invite, session setup, AI notes and follow-up flows.", "Prioritized audit plus complete therapist beta journey with normal, empty, loading and error states approved by co-founder/frontend.", "The therapist journey is the operational backbone of the beta; missing states create support load and failed sessions."],
        ["Designer 2: audit patient onboarding, consent, session-room entry, child/adult therapy modules and feedback flow.", "Patient journey map and priority screens tested with at least 3 representative users or structured internal proxies.", "Patients need low-friction, emotionally safe guidance; usability failure directly reduces completion and trust."],
        ["Both: consolidate tokens, typography, components and interaction rules.", "One versioned design library with naming, variants, spacing, accessibility notes and handoff conventions.", "A shared system prevents inconsistent implementation and speeds the single frontend engineer."],
    ]),
    ("September Stage 2 — Build Support and Pre-beta Validation (20–30 Sep)", "design QA, accessibility checks, moderated usability testing, and concise defect reporting.", [
        ["Designer 1: deliver therapist/admin responsive screens and review implemented builds twice weekly.", "Approved annotated screens; implementation QA log with severity and resolved evidence.", "Early design QA avoids expensive late-stage rework and protects core professional workflows."],
        ["Designer 2: finalize high-priority therapy modules, consent, session controls, feedback and recovery states.", "Clickable prototype and handoff package; task completion and comprehension results from usability checks.", "The beta must test therapy value, not users' ability to guess controls."],
        ["Both: run an end-to-end usability pass on the golden path.", "Top findings ranked by launch blocker/high/medium/low; blocker/high issues assigned and retested.", "Evidence-based prioritization keeps the final weeks focused on genuine user barriers."],
    ]),
    ("October Stage — Therapist Feedback, Iteration and Handoff (1–31 Oct)", "beta observation, accessible content, issue reproduction, release QA, and maintaining a design decision log.", [
        ["Designer 1: refine therapist onboarding, product tour, settings/help and support-contact surfaces.", "Release-ready screens and concise onboarding guide approved during pilot.", "Closed-pilot feedback usually concentrates around onboarding and recovery; resolving it improves activation."],
        ["Designer 2: create in-product beta labels, feedback prompts and approved social/demo visual templates.", "Reusable assets aligned with real product behavior and reviewed for claim accuracy.", "Consistent launch visuals reduce confusion and prevent marketing from promising unavailable features."],
        ["Both: complete visual/accessibility QA and archive final design documentation.", "No unresolved launch-blocking design issue; final library, flows and decision log handed over.", "A stable source of truth supports maintenance after the deadline."],
    ]),
])

parts += role_section("8", "AI Engineering — Two Engineers",
"AI Engineer 1 owns the session Copilot pipeline; AI Engineer 2 owns WhatsApp automation and safety routing. They share evaluation datasets, privacy rules, observability, API schemas, and incident playbooks. AI output remains assistive and requires human review; the beta does not position the system as an autonomous therapist.", [
    ("September Stage 1 — Baseline, Contracts and Safety (7–19 Sep)", "consent-gated processing, clinical-AI boundaries, prompt safety, data minimization, evaluation methodology, and Indian-English transcription variability.", [
        ["AI 1: baseline STT, RAG retrieval, insight generation and AI-note quality on representative scenarios.", "Versioned evaluation set, metrics, failure taxonomy and reproducible baseline report.", "A baseline is required to prove improvement and prevents subjective 'looks good' approval."],
        ["AI 2: freeze WhatsApp intents for booking, reminders, FAQs, check-ins, fallback and human escalation.", "Conversation map, safe-response policy and backend API/event contract approved.", "Tight intent boundaries reduce unsafe advice and stop scope creep before integration."],
        ["Both: define shared consent, redaction, retention, logging and prompt/model version rules.", "Written AI safety checklist with test cases and named human owner for escalation.", "Sensitive mental-health data and distress signals require predictable controls before external use."],
    ]),
    ("September Stage 2 — Implementation and Pre-beta Evaluation (20–30 Sep)", "retrieval diagnostics, structured output, hallucination testing, multilingual fallbacks, and webhook-safe conversational state.", [
        ["AI 1: improve transcription handling, context assembly, citations/traceability and structured Copilot outputs.", "Schema-valid responses, quality comparison against baseline, and graceful failure when evidence is insufficient.", "Therapists need concise, attributable assistance; confident unsupported output creates clinical risk."],
        ["AI 2: implement bot intent handling, approved templates, state transitions, FAQ grounding and human handoff.", "Tested sandbox flows with retries, duplicate events, ambiguity and distress-message escalation.", "The bot must be reliable operationally while refusing clinical counselling and escalating safely."],
        ["Both: build automated regression evaluation and cost/latency tracking.", "Repeatable evaluation report per model/prompt version with agreed thresholds.", "Launch decisions need quality, speed and operating-cost evidence—not demos alone."],
    ]),
    ("October Stage — Live Therapist Evaluation and Parallel AI Improvement (1–31 Oct)", "therapist feedback analysis, red-team testing, drift monitoring, incident response, rollback and human review operations.", [
        ["AI 1: analyze pilot failures by accent, noise, retrieval and note quality; fix highest-risk patterns.", "Release-candidate evaluation with documented known limitations and rollback version.", "Pilot evidence reveals real conditions that synthetic tests miss."],
        ["AI 2: stress-test escalation, opt-out, rate limits, handoff and message-template behavior.", "All safety-critical scenarios pass; unresolved noncritical limits are disclosed.", "External messaging can affect vulnerable users and needs deterministic escape routes."],
        ["Both: add dashboards/alerts and hand over model cards, prompts, runbooks and evaluation assets.", "Owner can detect failure, identify deployed version and disable AI independently.", "A beta is supportable only when the team can monitor and contain failures."],
    ]),
])

parts += role_section("9", "Backend Engineering — One Engineer",
"The backend engineer owns the trust boundary: identity, authorization, data contracts, persistence, integrations, auditability and release operations. The plan intentionally limits new feature work so one engineer can secure and stabilize the complete beta path.", [
    ("September Stage 1 — Security and Contract Freeze (7–19 Sep)", "least privilege, healthcare-data handling, API contract design, webhook verification, environment separation and migration safety.", [
        ["Audit authentication, roles, therapist–patient ownership and every patient/session endpoint.", "Access-control matrix plus automated positive/negative tests showing cross-therapist denial.", "UI hiding is not security; server-side tenant isolation is the beta's highest-priority privacy control."],
        ["Freeze contracts for onboarding, invites, sessions, notes, feedback, AI and WhatsApp events.", "Versioned schemas with validation, error codes and sample payloads accepted by consumers.", "Stable contracts let frontend and AI work concurrently and reduce integration churn."],
    ]),
    ("September Stage 2 — Integration and Beta Readiness (20–30 Sep)", "idempotency, retries, rate limits, structured logging, data validation, backups and operational diagnostics.", [
        ["Implement/harden beta APIs, database constraints, migrations and audit events.", "Integration tests pass; migrations tested on staging copy; invalid/unauthorized requests fail safely.", "Data correctness and auditability are prerequisites for trustworthy therapy records."],
        ["Securely connect AI pipeline and WhatsApp webhooks with queues/retries where needed.", "Signature verification, deduplication, timeout/failure paths and test evidence.", "External services retry and fail unpredictably; idempotency prevents duplicate actions or messages."],
        ["Add health checks, privacy-conscious logs and error monitoring.", "Staging dashboard exposes failures without transcript or sensitive-data leakage.", "The small team needs rapid diagnosis while maintaining data minimization."],
    ]),
    ("October Stage — Therapist-Beta Reliability and Continuous Fixes (1–31 Oct)", "production issue triage, load testing, backup/restore, incident response, deployment gates, rollback and secrets hygiene.", [
        ["Support pilot defects, tune slow endpoints and validate concurrency on the golden path.", "Agreed latency/error thresholds met under expected beta load; critical defects closed.", "Performance problems during sessions feel like product failure and can lose user trust."],
        ["Complete production configuration, backup/restore drill, deployment and rollback runbook.", "Release checklist signed; secrets rotated where needed; restore and rollback demonstrated.", "Recovery evidence lowers the impact of launch-day mistakes or service failures."],
    ]),
])

parts += role_section("10", "Frontend Engineering — One Engineer",
"The frontend engineer owns the implemented user experience and coordinates tightly with both designers, backend and AI. Work follows a single prioritized golden path before secondary polish, because one frontend owner cannot safely build all screens in parallel.", [
    ("September Stage 1 — Foundation and Critical Journey (7–19 Sep)", "existing architecture, component standards, accessibility, responsive behavior, API/error conventions and analytics instrumentation.", [
        ["Audit routes/components and implement shared tokens, components and page-state patterns.", "Reusable implementation matches approved library and passes agreed breakpoint/accessibility checks.", "Foundation work compounds across screens and prevents duplicated fixes."],
        ["Complete therapist sign-in/onboarding, patient invite and session-entry path against stable contracts.", "Golden path demonstrated on staging with loading, empty, validation and error recovery.", "This is the minimum route needed to reach and test the platform's core value."],
    ]),
    ("September Stage 2 — Session, AI and Feedback Integration (20–30 Sep)", "real-time state, safe rendering of AI output, failure recovery, cross-browser testing and event analytics.", [
        ["Implement session room, priority therapy tools, AI panel/notes and consent indicators.", "Integrated staging demo using real APIs; AI is labelled and never shown before consent.", "The beta must validate the complete therapy experience, including safe AI assistance."],
        ["Implement dashboards, follow-up, feedback, help and WhatsApp-status surfaces.", "Core flows functional on supported devices with meaningful user-facing failures.", "Follow-up and feedback close the service loop and provide evidence for iteration."],
        ["Add funnel/error events without sensitive content.", "Analytics events verified in staging and documented.", "The team needs activation and drop-off evidence while respecting privacy."],
    ]),
    ("October Stage — Therapist-Issue Fixing and Controlled Improvements (1–31 Oct)", "therapist issue reproduction, browser/device QA, performance profiling, accessibility regression, release flags and rollback.", [
        ["Fix pilot defects by severity; improve responsiveness, keyboard use and perceived performance.", "No open launch blocker; agreed browsers/breakpoints pass release checklist.", "Limited beta users should test product value, not known interface failures."],
        ["Add safe feature flags, error boundaries and production monitoring hooks; document frontend handoff.", "Features can be disabled without emergency code changes; support can trace client failures.", "Containment and diagnosis are essential during a beta with a small engineering team."],
    ]),
])

parts += role_section("11", "Co-founder / Business, Product and Operations Lead — One Owner",
"The co-founder converts strategy into decisions, removes cross-team blockers, protects safety and controls release scope. The co-founder is accountable for outcomes and approvals, but does not become the hidden implementer for every incomplete task.", [
    ("September Stage 1 — Scope, Commercials and Operating System (7–19 Sep)", "beta programme management, sales pipeline discipline, pricing and proposal development, clinical boundaries, privacy-by-design, risk classification, and evidence-based acceptance.", [
        ["Define target beta users, golden path, success metrics, exclusions and launch gates.", "One-page beta charter approved and communicated; backlog ranked Must/Should/Later.", "A fixed definition of success prevents eight roles from optimizing different products."],
        ["Confirm clinical adviser/therapist review, consent/privacy wording and escalation ownership.", "Named reviewers, decision dates and signed-off safety content before pilot.", "Product leadership must not delegate clinical and legal-risk decisions to individual engineers."],
        ["Maintain dependency, risk and decision logs; conduct weekly mentor review.", "Current dashboard and evidence-based weekly report.", "Fast documented decisions protect the deadline and preserve accountability."],
        ["Define commercial packages, beta terms, pricing assumptions, proposal templates and manual payment/approval process.", "Approved rate card and commercial pack; every concession and commitment recorded.", "Repository prices are placeholders and automated billing is not built, so a controlled manual commercial process is required."],
        ["Build and qualify a therapist/clinic/client pipeline; schedule demos and follow-ups.", "CRM-style tracker with stage, value, next action, owner and probability for every lead.", "The beta needs active therapist users and the business needs a repeatable route to paying clients."],
    ]),
    ("September Stage 2 — Beta Lock, Client Conversion and Team Readiness (20–30 Sep)", "structured acceptance testing, negotiation, onboarding operations, interview ethics, pilot recruitment, support triage and launch-readiness review.", [
        ["Accept/reject integrated work against criteria; prevent unreviewed scope additions.", "Weekly signed gate results with owner/date for every exception.", "Feature completion must reflect usable integrated behavior, not isolated team output."],
        ["Recruit and onboard a small consented pilot cohort; run feedback sessions and triage findings.", "Participant tracker, consent evidence, support channel and ranked findings without unnecessary sensitive data.", "Controlled feedback validates readiness while limiting operational risk."],
        ["Move qualified therapists/clinics toward signed beta or commercial commitment and confirm onboarding dates.", "Proposal/follow-up record, agreed terms and October test calendar for each confirmed participant.", "Testing cannot start meaningfully on 1 October without committed users and scheduled onboarding."],
        ["Allocate work, resolve blockers, check attendance/capacity and ensure every function has measurable weekly outcomes.", "Current team board and one-to-one/escalation record where required.", "With a small cross-functional team, operating discipline is necessary to protect delivery and morale."],
    ]),
    ("October Stage — Clients, Commercials, Team and Full Beta Operations (1–31 Oct)", "sales closing, account management, go/no-go governance, incident command, user communication, finance/admin control, rollback decisions and metric interpretation.", [
        ["Chair release-candidate review across product, privacy, AI safety, reliability and support.", "Written go/no-go decision; blockers cannot be waived without owner, rationale and mitigation.", "A single accountable launch decision prevents ambiguity under deadline pressure."],
        ["Coordinate beta release, daily launch monitoring and first improvement backlog.", "Launch log, issue ownership, user updates and November backlog based on observed evidence.", "The release is the start of learning; disciplined monitoring converts it into useful product evidence."],
        ["Acquire and close additional suitable clients without exceeding support capacity.", "Weekly pipeline review covering new leads, demos, conversions, commercial value and next steps.", "Commercial validation must run alongside product validation, but onboarding must remain controlled."],
        ["Own therapist relationships: onboarding, check-ins, feedback acknowledgement, expectation management and renewal/paid-conversion discussion.", "Account record for each therapist with issues, commitments, satisfaction and commercial next action.", "Close client care improves retention and converts testing into trusted business relationships."],
        ["Run all company operations: team priorities, approvals, vendor/accounts tracking, documentation, mentor/stakeholder updates and incident decisions.", "Weekly operating dashboard covering product, people, clients, cash/commercials, risks and decisions.", "One accountable operator is needed to coordinate the full system while specialists execute their domains."],
    ]),
])

parts += role_section("12", "Social Media & Community — One Owner",
"The social-media lead begins now because beta success depends on expectation-setting, appropriate participant recruitment and a reliable feedback loop—not only reach. All clinical claims, user stories and screenshots require co-founder approval and consent where applicable.", [
    ("September Stage 1 — Positioning and Channel Setup (7–19 Sep)", "STAAD product boundaries, responsible mental-health communication, consent, privacy, brand voice, audience definition and basic analytics.", [
        ["Audit channels and define therapist/parent/student audience segments, message pillars and prohibited claims.", "Approved messaging guide, profile updates, FAQ and response/escalation rules.", "Responsible positioning builds trust and prevents unsupported medical or outcome claims."],
        ["Create an 8-week content calendar tied to real build milestones.", "Calendar includes owner, format, approval date, CTA, metric and reusable asset need.", "Milestone-linked content stays accurate and makes limited production capacity predictable."],
    ]),
    ("September Stage 2 — Education, Therapist Recruitment and Beta Assets (20–30 Sep)", "content production, community moderation, accessible captions, beta recruitment, UTM tracking and ethical testimonial collection.", [
        ["Publish educational/build-in-public content and team/product explainers at a sustainable cadence.", "Approved posts shipped; weekly reach, saves, replies and qualified-interest report.", "Education establishes context before the invitation and measures message resonance."],
        ["Run controlled beta-interest campaign with clear eligibility and limited-access expectations.", "Tracked landing-form funnel and screened lead list handed to co-founder; no sensitive health details collected in public channels.", "The beta needs suitable participants rather than unqualified high-volume attention."],
        ["Produce launch kit: demo script, short walkthrough, stills, captions, email/DM copy and FAQ responses.", "All assets reflect release-candidate behavior and pass product/claim review.", "Pre-approved assets enable a coordinated launch without last-minute inaccurate content."],
    ]),
    ("October Stage — Month-long Beta Communication and Listening (1–31 Oct)", "community support boundaries, crisis-message escalation, social listening, therapist-feedback content loops, rapid correction and insight reporting.", [
        ["Schedule countdown, beta announcement and onboarding reminders; moderate comments and DMs.", "Every inquiry acknowledged within agreed service window and routed by category.", "Responsive communication reduces confusion and keeps sensitive cases away from public threads."],
        ["Capture objections, FAQs and sentiment; report qualified conversions rather than vanity metrics.", "Launch report covers funnel, content performance, recurring concerns and recommended product/content changes.", "The role must create actionable learning and beta adoption, not impressions alone."],
    ]),
])

parts += [
    para("13. Cross-Functional Milestones and Testing Gates", style="Heading1"),
    table(["Deadline", "Milestone", "Required evidence", "Release consequence"], [
        ["12 Sep", "Beta charter and baseline", "Scope, users, metrics, risks, current quality/security baseline", "No feature work outside approved Must list"],
        ["19 Sep", "Design/API/AI contract freeze", "Approved flows, schemas, safety rules and content boundaries", "Changes require impact decision"],
        ["30 Sep", "Therapist-beta readiness", "Golden path, security gate, support channel, onboarding, monitoring and known limits approved", "Testing opens only to confirmed, consented therapists"],
        ["1 Oct", "Month-long therapist testing begins", "Therapists onboarded; feedback IDs and daily triage operating", "Real feedback becomes the primary backlog"],
        ["10 Oct", "Testing checkpoint 1", "Security, AI, UX and integration findings with fixes/releases", "P0/P1 findings take precedence over new development"],
        ["17 Oct", "Testing checkpoint 2", "Usage, AI usefulness, recurring issues and commercial feedback reviewed", "Scope adjusted from evidence"],
        ["24 Oct", "Stability checkpoint", "Critical issues closed; remaining work documented; client pipeline reviewed", "Final-week changes tightly controlled"],
        ["31 Oct", "Therapist test-month close", "Full feedback register, release history, outcomes, commercials and November backlog", "Go/limited-go/extend-test decision"],
    ], [1200,1900,3850,2050]),
    para("14. Success Measures", style="Heading1"),
]
for x in [
    "Activation: invited users who complete onboarding and reach their first intended session step.",
    "Journey completion: successful completion of the agreed therapist–patient golden path.",
    "Reliability: error rate, failed sessions, webhook failures and recovery time within agreed thresholds set in Week 1.",
    "Safety and privacy: zero unresolved critical authorization, consent, sensitive-logging or escalation defects at launch.",
    "AI quality: release-candidate evaluation meets Week 1 thresholds and known limitations are documented for human reviewers.",
    "Usability: all launch-blocking findings closed; pilot users can complete priority tasks without team intervention.",
    "Community: qualified beta interest, completed onboarding and actionable feedback are reported separately from reach/follower metrics.",
]: parts.append(bullet(x))

parts += [
    para("15. Risk Controls and Scope Rules", style="Heading1"),
    table(["Risk", "Control", "Owner"], [
        ["Scope expansion delays beta", "Must/Should/Later backlog; post-freeze changes require impact approval", "Co-founder"],
        ["Sensitive-data exposure", "Server-side authorization, redacted logs, least privilege, consent and negative tests", "Backend + Co-founder"],
        ["Unsafe or unsupported AI output", "Bounded use cases, evaluation, human review, traceability, escalation and kill switch", "AI team + Co-founder"],
        ["Single-person engineering bottlenecks", "Early contract freeze, paired reviews, documentation and strict golden-path priority", "Co-founder + engineers"],
        ["Marketing overclaims", "Approved wording, prohibited-claims list, consent for stories/assets and rapid correction", "Social Media + Co-founder"],
        ["Launch-day failure", "Staging rehearsal, monitoring, support roster, feature flags, backup and rollback runbooks", "Backend + Frontend + Co-founder"],
    ], [2200,5100,1700]),
    para("16. Mentorship, Reporting and Change Control", style="Heading1"),
    para("Each weekly mentor review will show: planned versus completed outcomes; integrated demo evidence; quality/safety metrics; user or pilot evidence; risks and decisions required; and the next week's launch gate. Hours alone are not evidence of progress."),
    para("This plan is the baseline as of 7 September 2026. Minor sequencing changes are permitted when dependencies shift, but the owner, reason, impact, revised date and approval must be recorded. Privacy, consent, authorization, AI safety and crisis-escalation controls cannot be descoped to protect the deadline."),
    para("End of document", align="center", before=300, after=0),
]

sect = ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="900" w:right="780" w:bottom="900" w:left="780" w:header="450" w:footer="450" w:gutter="0"/>'
        '<w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>')
document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:document xmlns:w="{W}"><w:body>{"".join(parts)}{sect}</w:body></w:document>')

with ZipFile(SOURCE, "r") as src, ZipFile(OUTPUT, "w", ZIP_DEFLATED) as dst:
    for item in src.infolist():
        data = document.encode("utf-8") if item.filename == "word/document.xml" else src.read(item.filename)
        dst.writestr(item, data)

print(OUTPUT)
