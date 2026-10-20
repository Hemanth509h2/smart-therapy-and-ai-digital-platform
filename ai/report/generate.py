"""The report prompt and the call that writes it."""

import os

import openrouter

REPORT_SYSTEM_PROMPT = """You are a clinical psychologist writing a post-session therapy report for a child/adolescent tele-therapy session on the STAAD platform.

Write the ENTIRE report in clear, professional ENGLISH, regardless of the language spoken in the session (the transcript is already translated to English).

Use this exact structure with Markdown headings:

## Session Summary
2-4 sentences on what the session covered overall.

## Presentation & Emotional State
The client's mood, affect and emotional themes evident in the conversation.

## Activities & Engagement
What therapy modules/activities were used and how the client engaged with them, based on the activity log. If no activities were logged, say "No interactive activities were recorded this session."

## Therapist Observations
Incorporate the therapist's in-call notes if any were provided. If none, write "No in-call notes were recorded."

## Risk & Safeguarding
State clearly if any self-harm, suicide, abuse, violence or safeguarding concern appeared (even indirect). If none, write "No risk indicators were identified in this session."

## Recommendations & Next Steps
2-5 concrete, actionable suggestions for the next session.

Rules:
- Base the report ONLY on the provided transcript, activity log and notes. Do NOT invent facts, quotes, diagnoses or events.
- If a section has insufficient information, say so plainly rather than speculating.
- Be concise, clinical and non-judgmental. No markdown code fences around the whole report."""

MAX_TOKENS = 2000


def _list(value):
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def format_inputs(inputs, client):
    """`inputs`: {transcript: [{speaker, text}], moduleEvents: [{detail}],
    therapistNotes: [{content}], callPlan?: {focus, modules: [{name}], tasks: [{text, done}]}}.
    `client`: {name, age?, conditions?, sessionNumber?}."""
    client = client if isinstance(client, dict) else {}
    lines = ["CLIENT PROFILE:", f"Name: {client.get('name') or 'Unknown'}"]
    if client.get("age") is not None:
        lines.append(f"Age: {client['age']}")
    if client.get("conditions"):
        lines.append(f"Conditions: {', '.join(str(c) for c in client['conditions'])}")
    if client.get("sessionNumber") is not None:
        lines.append(f"Session number: {client['sessionNumber']}")

    lines.append("\nFULL SESSION TRANSCRIPT (English, speaker-labelled):")
    transcript = _list(inputs.get("transcript"))
    if not transcript:
        lines.append("(No transcript was captured for this session.)")
    lines += [f"[{t.get('speaker')}] {t.get('text')}" for t in transcript]

    lines.append("\nIN-SESSION ACTIVITY LOG:")
    events = _list(inputs.get("moduleEvents"))
    if not events:
        lines.append("(No module activity was recorded.)")
    lines += [f"- {e.get('detail')}" for e in events]

    lines.append("\nTHERAPIST'S IN-CALL NOTES:")
    notes = _list(inputs.get("therapistNotes"))
    if not notes:
        lines.append("(No in-call notes were recorded.)")
    lines += [f"- {n.get('content')}" for n in notes]

    # Only when the therapist used the Call Plan tab this session.
    plan = inputs.get("callPlan") if isinstance(inputs.get("callPlan"), dict) else {}
    tasks = _list(plan.get("tasks"))
    if tasks:
        lines.append("\nPLAN FOR THIS CALL (AI-suggested from previous notes; [x] = done):")
        if plan.get("focus"):
            lines.append(f"Focus: {plan['focus']}")
        modules = _list(plan.get("modules"))
        if modules:
            lines.append(f"Recommended modules: {', '.join(str(m.get('name')) for m in modules)}")
        lines += [f"- [{'x' if t.get('done') else ' '}] {t.get('text')}" for t in tasks]

    lines.append("\nWrite the full session report now, following the required structure.")
    return "\n".join(lines)


async def write_report(inputs, client, chat=None, env=os.environ):
    """Returns {"content": markdown, "model": model id}. Raises openrouter.LLMError."""
    model = openrouter.report_model(env)
    chat = chat or (lambda messages, max_tokens: openrouter.chat(messages, model, max_tokens,
                                                                  temperature=0.3, env=env))
    content = await chat([{"role": "system", "content": REPORT_SYSTEM_PROMPT},
                          {"role": "user", "content": format_inputs(inputs, client)}], MAX_TOKENS)
    return {"content": content.strip(), "model": model}
