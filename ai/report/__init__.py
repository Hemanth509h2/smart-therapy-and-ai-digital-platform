"""End-of-session report: writes the narrative report from the session's transcript,
module activity, in-call notes and call plan.

The backend's /api/session-report checks the caller and plan, reads that data,
computes the session statistics itself (plain counts, no AI), sends the data
here over the internal endpoint (internal.py), and saves what comes back.
"""

from report.generate import write_report

__all__ = ["write_report"]
