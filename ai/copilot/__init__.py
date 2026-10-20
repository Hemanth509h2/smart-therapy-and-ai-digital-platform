"""Live session copilot: the AI insight the therapist asks for with "Analyse".

The backend's /api/ai-insight checks the caller, plan and consent, gathers the
session data (transcript, module activity, in-call notes, previous notes) and
sends it here over the internal endpoint (internal.py). This package reads it
alongside the therapist's study material, asks the model for a structured
insight, runs a separate safety scan in parallel, and returns the merged result.
"""

from copilot.analysis import run_analysis

__all__ = ["run_analysis"]
