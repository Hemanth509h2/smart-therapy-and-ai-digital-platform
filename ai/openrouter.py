"""OpenRouter chat calls, shared by every AI feature in this service.

One OpenRouter account (OPENROUTER_API_KEY), one model setting per feature:
  copilot   live AI insights + safety scan   OPENROUTER_COPILOT_MODEL
  report    end-of-session report            OPENROUTER_MODEL
  agent     call-plan agent                  OPENROUTER_AGENT_MODEL, then OPENROUTER_COPILOT_MODEL
Each falls back to DEFAULT_MODEL.

Prompts ask for "JSON only" instead of forcing JSON mode, which some models
mangle, and replies are parsed tolerantly with extract_json.
"""

import asyncio
import json
import os
import urllib.error
import urllib.request

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
# The free endpoint of nemotron-3-super started returning 404 in Oct 2026. This
# one is free and reliable but slow (~30s a call); for ~3s set the feature's
# model to nvidia/nemotron-3-super-120b-a12b (paid).
DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
TIMEOUT_SECONDS = 180  # a long report on a slow free model can take minutes


class LLMError(RuntimeError):
    pass


def is_configured(env=os.environ):
    return bool(env.get("OPENROUTER_API_KEY"))


def copilot_model(env=os.environ):
    return env.get("OPENROUTER_COPILOT_MODEL") or DEFAULT_MODEL


def report_model(env=os.environ):
    return env.get("OPENROUTER_MODEL") or DEFAULT_MODEL


def agent_model(env=os.environ):
    return env.get("OPENROUTER_AGENT_MODEL") or env.get("OPENROUTER_COPILOT_MODEL") or DEFAULT_MODEL


def _post(messages, model, max_tokens, temperature, env):
    body = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }).encode()
    req = urllib.request.Request(OPENROUTER_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {env.get('OPENROUTER_API_KEY', '')}",
        "Content-Type": "application/json",
        "HTTP-Referer": env.get("OPENROUTER_SITE_URL") or "https://staad.therapy",
        "X-Title": "STAAD Therapy",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as res:
            data = json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise LLMError(f"OpenRouter returned {e.code} for model {model}: {_error_message(e)}") from e
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise LLMError(f"OpenRouter request failed: {type(e).__name__}") from e
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as e:
        raise LLMError("OpenRouter reply had no message") from e


def _error_message(e):
    """OpenRouter's own reason, e.g. a 404 "No endpoints found matching your data
    policy" for free models when the account blocks them. Never includes the prompt."""
    try:
        body = json.loads(e.read())
        return str(body["error"]["message"])[:300]
    except Exception:
        return "no details"


async def chat(messages, model, max_tokens=1500, temperature=0.2, env=os.environ):
    """Returns the model's reply text. Runs the blocking HTTP call off the event loop."""
    return await asyncio.to_thread(_post, messages, model, max_tokens, temperature, env)


def extract_json(raw):
    """Parses the outermost {...} in a model reply, ignoring code fences and prose.
    Returns None when there is no valid object."""
    if not raw:
        return None
    text = raw.strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(text[start:end + 1])
    except ValueError:
        return None
    return value if isinstance(value, dict) else None
