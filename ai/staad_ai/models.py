
"""Typed contracts shared by the Python STAAD AI pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Mapping

RiskLevel = Literal["none", "watch", "urgent"]
Intent = Literal["live_insight", "session_report", "safeguard_scan", "general"]


@dataclass(frozen=True)
class TranscriptTurn:
    text: str
    speaker: Literal["therapist", "client", "unknown"] = "unknown"
    timestamp: datetime | None = None
    is_final: bool = True


@dataclass
class ClientContext:
    client_id: str
    therapist_id: str
    name: str = "Client"
    age: int | None = None
    conditions: list[str] = field(default_factory=list)
    session_number: int | None = None
    goals: list[str] = field(default_factory=list)
    # Kept separate so it can be redacted before any prompt is built.
    phone: str | None = None
    parent_email: str | None = None


@dataclass
class RetrievedChunk:
    text: str
    file_name: str = ""
    chunk_index: int = 0
    similarity: float = 0.0


@dataclass
class PreviousNote:
    session_id: str
    content: str
    created_at: datetime | None = None
    session_number: int | None = None
    private: bool = False


@dataclass
class RetrievedContext:
    client: ClientContext
    session_id: str
    therapist_id: str
    transcript: list[TranscriptTurn] = field(default_factory=list)
    module_events: list[dict[str, Any]] = field(default_factory=list)
    in_call_notes: list[dict[str, Any] | str] = field(default_factory=list)
    previous_notes: list[PreviousNote] = field(default_factory=list)
    reports: list[dict[str, Any] | str] = field(default_factory=list)
    progress_metrics: list[dict[str, Any]] = field(default_factory=list)
    knowledge_chunks: list[RetrievedChunk] = field(default_factory=list)
    active_module_id: str | None = None
    session_state: Mapping[str, Any] = field(default_factory=dict)
    retrieved_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


@dataclass
class PipelineInput:
    therapist_id: str
    session_id: str | None = None
    client_id: str | None = None
    client_profile: Mapping[str, Any] | None = None
    transcript_window_minutes: int = 5
    semantic_query: str | None = None
    module: str | None = None
    event_type: str | None = None
    similarity_threshold: float = 0.25
    top_k: int = 5
    notes_limit: int = 3
    reports_limit: int = 5
    metrics_limit: int = 20
    intent: Intent = "live_insight"
    token_budget: int = 1500
    allow_private_notes: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.therapist_id, str) or not self.therapist_id.strip():
            raise ValueError("therapist_id is required")

        if self.intent not in {
            "live_insight",
            "session_report",
            "safeguard_scan",
            "general",
        }:
            raise ValueError("Invalid intent")

        integer_fields = {
            "transcript_window_minutes": self.transcript_window_minutes,
            "top_k": self.top_k,
            "token_budget": self.token_budget,
            "notes_limit": self.notes_limit,
            "reports_limit": self.reports_limit,
            "metrics_limit": self.metrics_limit,
        }

        for name, value in integer_fields.items():
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"{name} must be an integer")

        if self.transcript_window_minutes < 0:
            raise ValueError("transcript_window_minutes must be non-negative")

        if (
            isinstance(self.similarity_threshold, bool)
            or not isinstance(self.similarity_threshold, (int, float))
            or not 0.0 <= self.similarity_threshold <= 1.0
        ):
            raise ValueError("similarity_threshold must be between 0 and 1")

        if self.top_k <= 0:
            raise ValueError("top_k must be greater than zero")

        if self.token_budget <= 0:
            raise ValueError("token_budget must be greater than zero")

        for name in ("notes_limit", "reports_limit", "metrics_limit"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} must be non-negative")


@dataclass
class PromptPayload:
    system_prompt: str
    user_prompt: str
    structured_sections: dict[str, str]
    token_estimate: int
    metadata: dict[str, Any]


@dataclass
class SafetyVerdict:
    level: RiskLevel = "none"
    cue: str = ""
    rationale: str = ""


@dataclass
class AIInsight:
    emotions: list[str]
    summary: str
    steps: list[str]
    module: str
    risk_flag: bool
    risk_level: RiskLevel
    risk_detail: str
    generated_at: int
    transcript_window_minutes: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "emotions": self.emotions,
            "summary": self.summary,
            "steps": self.steps,
            "module": self.module,
            "riskFlag": self.risk_flag,
            "riskLevel": self.risk_level,
            "riskDetail": self.risk_detail,
            "generatedAt": self.generated_at,
            "transcriptWindowMinutes": self.transcript_window_minutes,
        }
