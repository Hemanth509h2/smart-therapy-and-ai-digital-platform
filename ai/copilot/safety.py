"""A dedicated safety pass, run in PARALLEL with the main analysis.

General chat models are inconsistent at catching safety cues (in testing one
named suicidal ideation, another said "none"), so the risk verdict must NOT
depend on whether the suggestion model happened to notice. This call does ONE
job: scan the recent client utterances for risk. Same model, tight prompt.
"""

import os

import openrouter

RISK_LEVELS = ("none", "watch", "urgent")

SAFETY_SYSTEM_PROMPT = """You are a clinical safeguarding monitor for a live child/adolescent tele-therapy session. You do ONE job: scan the transcript for risk and report it. You do not give therapy advice.

Respond with valid JSON only — no markdown, no code fences:
{
  "level": "none" | "watch" | "urgent",
  "cue": "string",        // the exact client phrase or behaviour that concerned you; "" if none
  "rationale": "string"   // one short clinical sentence explaining the concern; "" if none
}

Risk levels:
- "urgent": explicit or strongly implied self-harm, suicide, intent to harm others, abuse disclosure, or immediate danger. Crisis protocol may be warranted.
- "watch": indirect or emerging concern — hopelessness, worthlessness ("what's the point"), passive ideation, escalating distress, hints of harm. Worth the therapist's attention, not yet a crisis.
- "none": no safeguarding concern detected.

Rules:
- Judge ONLY the client's words/behaviour in the transcript. Do not infer beyond what is said.
- Err toward "watch" over "none" when language is ambiguous but concerning (e.g. hopelessness). Reserve "urgent" for genuine, clear danger.
- Keep cue and rationale to a single short line each."""


def parse_verdict(raw):
    p = openrouter.extract_json(raw)
    if p is None:
        # A safety parse failure must never silently read as "safe". Surface it as
        # a soft flag so the therapist still looks, without crying wolf.
        return {"level": "watch", "cue": "",
                "rationale": "Safety check could not be parsed — review the transcript manually."}
    level = p.get("level") if p.get("level") in ("watch", "urgent") else "none"
    return {
        "level": level,
        "cue": p["cue"] if isinstance(p.get("cue"), str) else "",
        "rationale": p["rationale"] if isinstance(p.get("rationale"), str) else "",
    }


async def run_safety_scan(transcript, chat=None, env=os.environ):
    """`chat(messages, max_tokens)` -> reply text; defaults to the copilot model."""
    if not transcript or not transcript.strip():
        return {"level": "none", "cue": "", "rationale": ""}
    chat = chat or (lambda messages, max_tokens: openrouter.chat(messages, openrouter.copilot_model(env),
                                                                  max_tokens, env=env))
    user = (f"RECENT SESSION TRANSCRIPT:\n{transcript}\n\n"
            "Scan the client's utterances for safeguarding risk and return your verdict as JSON.")
    raw = await chat([{"role": "system", "content": SAFETY_SYSTEM_PROMPT},
                      {"role": "user", "content": user}], 256)
    return parse_verdict(raw)
