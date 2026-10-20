"""OpenRouter chat calls for the call-plan agent.

Uses the same OpenRouter account as the backend's copilot (OPENROUTER_API_KEY).
Like the backend, it asks for "JSON only" in the prompt instead of forcing JSON
mode, which some free models mangle, and parses the reply tolerantly.
"""

import asyncio
import json
import os
import urllib.error
import urllib.request

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
TIMEOUT_SECONDS = 90


class LLMError(RuntimeError):
    pass


def model_name(env=os.environ):
    return env.get("OPENROUTER_AGENT_MODEL") or env.get("OPENROUTER_COPILOT_MODEL") or DEFAULT_MODEL


def is_configured(env=os.environ):
    return bool(env.get("OPENROUTER_API_KEY"))


def _post(messages, max_tokens, env):
    body = json.dumps({
        "model": model_name(env),
        "messages": messages,
        "temperature": 0.2,
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
        raise LLMError(f"OpenRouter returned {e.code} for model {model_name(env)}: {_error_message(e)}") from e
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


async def chat(messages, max_tokens=1500, env=os.environ):
    """Returns the model's reply text. Runs the blocking HTTP call off the event loop."""
    return await asyncio.to_thread(_post, messages, max_tokens, env)


def extract_json(raw):
    """Parses the outermost {...} in a model reply, ignoring code fences and prose.
    Returns None when there is no valid object (mirrors backend extractJSON)."""
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
