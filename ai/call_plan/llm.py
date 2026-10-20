"""OpenRouter chat calls for the call-plan agent: the shared client (openrouter.py)
with the agent's model (OPENROUTER_AGENT_MODEL, then OPENROUTER_COPILOT_MODEL)."""

import os

import openrouter
from openrouter import LLMError, extract_json, is_configured  # noqa: F401  (re-exported)

DEFAULT_MODEL = openrouter.DEFAULT_MODEL


def model_name(env=os.environ):
    return openrouter.agent_model(env)


async def chat(messages, max_tokens=1500, env=os.environ):
    """Returns the model's reply text."""
    return await openrouter.chat(messages, model_name(env), max_tokens, env=env)
