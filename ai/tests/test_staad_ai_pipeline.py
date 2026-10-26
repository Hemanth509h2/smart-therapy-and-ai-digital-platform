"""Small offline tests for the Python STAAD context pipeline."""

from __future__ import annotations
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from staad_ai.pipeline import _parse_insight  # noqa: E402
from staad_ai.models import (  # noqa: E402
    ClientContext,
    PipelineInput,
    RetrievedContext,
    RetrievedChunk,
    SafetyVerdict,
    TranscriptTurn,
    PreviousNote,
)
from staad_ai.pipeline import (  # noqa: E402
    ContextSecurityError,
    _estimate_tokens,
    analyze,
    process_pipeline_with_details,
)


class FakeRetrieval:
    def __init__(self, *, therapist_id: str = "therapist-1") -> None:
        self.therapist_id = therapist_id

    async def retrieve(self, request: PipelineInput) -> RetrievedContext:
        return RetrievedContext(
            client=ClientContext(
                client_id="client-1",
                therapist_id=self.therapist_id,
                name="Alex Example",
                age=14,
                conditions=["anxiety"],
                phone="555-123-4567",
                parent_email="parent@example.com",
            ),
            session_id="session-1",
            therapist_id=self.therapist_id,
            transcript=[
                TranscriptTurn("I feel worried about school.", "client"),
                TranscriptTurn("I feel worried about school.", "client"),
                TranscriptTurn("ok", "therapist"),
                TranscriptTurn("My parent is parent@example.com", "client"),
            ],
            module_events=[{"module": "grounding-game", "eventType": "completed"}],
            knowledge_chunks=[
                RetrievedChunk(
                    "A grounding exercise uses slow breathing.",
                    "guide.pdf",
                    0,
                    0.82,
                )
            ],
            active_module_id="grounding-game",
        )

class FakeModel:
    async def complete_json(self, system_prompt: str, user_prompt: str) -> str:
        self.prompt = user_prompt
        return (
            '{"emotions":["worried"],"summary":"Client described school worries.",'
            '"steps":["Discuss coping strategies."],"module":"grounding-game",'
            '"riskFlag":false,"riskLevel":"none"}'
        )

    async def scan_safety(self, transcript: str) -> SafetyVerdict:
        self.scanned_transcript = transcript
        return SafetyVerdict(
            "urgent",
            "sample cue",
            "Sample requires immediate therapist review.",
        )


class PipelineInputValidationTests(unittest.TestCase):
    def test_rejects_empty_therapist_id(self):
        with self.assertRaises(ValueError):
            PipelineInput(therapist_id=" ")

    def test_rejects_invalid_intent(self):
        with self.assertRaises(ValueError):
            PipelineInput(therapist_id="therapist-1", intent="invalid")

    def test_rejects_negative_transcript_window(self):
        with self.assertRaises(ValueError):
            PipelineInput(
                therapist_id="therapist-1",
                transcript_window_minutes=-1,
            )

    def test_rejects_similarity_threshold_out_of_range(self):
        for threshold in (-0.1, 1.1):
            with self.subTest(threshold=threshold):
                with self.assertRaises(ValueError):
                    PipelineInput(
                        therapist_id="therapist-1",
                        similarity_threshold=threshold,
                    )

    def test_rejects_boolean_similarity_threshold(self):
        with self.assertRaises(ValueError):
            PipelineInput(
                therapist_id="therapist-1",
                similarity_threshold=True,
            )

    def test_rejects_non_positive_top_k(self):
        for top_k in (0, -1):
            with self.subTest(top_k=top_k):
                with self.assertRaises(ValueError):
                    PipelineInput(
                        therapist_id="therapist-1",
                        top_k=top_k,
                    )

    def test_rejects_non_positive_token_budget(self):
        for budget in (0, -1):
            with self.subTest(budget=budget):
                with self.assertRaises(ValueError):
                    PipelineInput(
                        therapist_id="therapist-1",
                        token_budget=budget,
                    )

    def test_rejects_negative_collection_limits(self):
        for field_name in ("notes_limit", "reports_limit", "metrics_limit"):
            with self.subTest(field_name=field_name):
                with self.assertRaises(ValueError):
                    PipelineInput(
                        therapist_id="therapist-1",
                        **{field_name: -1},
                    )

    def test_rejects_boolean_integer_fields(self):
        for field_name in (
            "transcript_window_minutes",
            "top_k",
            "token_budget",
            "notes_limit",
            "reports_limit",
            "metrics_limit",
        ):
            with self.subTest(field_name=field_name):
                with self.assertRaises(ValueError):
                    PipelineInput(
                        therapist_id="therapist-1",
                        **{field_name: True},
                    )

    def test_accepts_valid_boundary_values(self):
        request = PipelineInput(
            therapist_id="therapist-1",
            transcript_window_minutes=0,
            similarity_threshold=0.0,
            notes_limit=0,
            reports_limit=0,
            metrics_limit=0,
        )
        self.assertEqual(request.transcript_window_minutes, 0)
        self.assertEqual(request.similarity_threshold, 0.0)


class PipelineTests(unittest.IsolatedAsyncioTestCase):

    def test_string_false_risk_flag_is_not_treated_as_true(self):
        request = PipelineInput(therapist_id="therapist-1")
        safety = SafetyVerdict("none", "", "")

        insight = _parse_insight(
            {"riskFlag": "false"},
            request,
            safety,
        )

        self.assertFalse(insight.risk_flag)

    def test_string_true_risk_flag_is_not_trusted_as_boolean(self):
        request = PipelineInput(therapist_id="therapist-1")
        safety = SafetyVerdict("none", "", "")

        insight = _parse_insight(
            {"riskFlag": "true"},
            request,
            safety,
        )

        self.assertFalse(insight.risk_flag)

    def test_urgent_safety_overrides_false_model_flag(self):
        request = PipelineInput(therapist_id="therapist-1")
        safety = SafetyVerdict(
            "urgent",
            "urgent cue",
            "Therapist review required.",
        )

        insight = _parse_insight(
            {"riskFlag": False},
            request,
            safety,
        )

        self.assertTrue(insight.risk_flag)
        self.assertEqual(insight.risk_level, "urgent")

    def test_boolean_false_risk_flag_remains_false_without_safety_alert(self):
        request = PipelineInput(therapist_id="therapist-1")
        safety = SafetyVerdict("none", "", "")

        insight = _parse_insight(
            {"riskFlag": False},
            request,
            safety,
        )

        self.assertFalse(insight.risk_flag)

    async def test_transcript_window_excludes_untimestamped_turns_when_stamped_turns_exist(self):
        class MixedTimestampRetrieval(FakeRetrieval):
            async def retrieve(self, request: PipelineInput) -> RetrievedContext:
                context = await super().retrieve(request)
                now = datetime.now(timezone.utc)
                context.transcript = [
                    TranscriptTurn(
                        "UNTIMESTAMPED TURN",
                        "client",
                    ),
                    TranscriptTurn(
                        "RECENT TIMESTAMPED TURN",
                        "client",
                        timestamp=now - timedelta(minutes=1),
                    ),
                ]
                return context

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
            transcript_window_minutes=5,
        )

        payload, _ = await process_pipeline_with_details(
            request, MixedTimestampRetrieval()
        )

        transcript = payload.structured_sections["transcript"]
        self.assertNotIn("UNTIMESTAMPED TURN", transcript)
        self.assertIn("RECENT TIMESTAMPED TURN", transcript)


    async def test_prompt_filters_duplicates_and_redacts_email(self) -> None:
        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )
        payload, _ = await process_pipeline_with_details(request, FakeRetrieval())

        transcript = payload.structured_sections["transcript"]
        self.assertEqual(transcript.count("I feel worried about school."), 1)
        self.assertNotIn("parent@example.com", payload.user_prompt)
        self.assertIn("[REDACTED EMAIL]", payload.user_prompt)
        self.assertIn("grounding-game", payload.user_prompt)

    async def test_rejects_context_from_another_therapist(self) -> None:
        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
        )
        with self.assertRaises(ContextSecurityError):
            await process_pipeline_with_details(
                request, FakeRetrieval(therapist_id="therapist-2")
            )

    async def test_safety_result_overrides_model_risk(self) -> None:
        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )
        model = FakeModel()
        insight = await analyze(request, FakeRetrieval(), model)

        self.assertTrue(insight.risk_flag)
        self.assertEqual(insight.risk_level, "urgent")
        self.assertEqual(
            insight.risk_detail,
            "Sample requires immediate therapist review.",
        )
        self.assertEqual(insight.emotions, ["worried"])
        self.assertNotIn("parent@example.com", model.prompt)
        self.assertNotIn("parent@example.com", model.scanned_transcript)

    async def test_safety_scan_failure_raises_error(self) -> None:
        class FailingSafetyModel(FakeModel):
            async def scan_safety(self, transcript: str):
                raise RuntimeError("Safety service unavailable")

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )

        with self.assertRaisesRegex(
                RuntimeError,
                "AI safety assessment failed because the safety scan could not complete",
        ):
            await analyze(
                request, FakeRetrieval(), FailingSafetyModel()
            )

    async def test_model_failure_raises_error(self) -> None:
        class FailingModel(FakeModel):
            async def complete_json(self, system_prompt: str, user_prompt: str):
                raise RuntimeError("Model service unavailable")

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )

        with self.assertRaisesRegex(
                RuntimeError,
                "AI analysis failed because the model could not generate a response",
        ):
            await analyze(request, FakeRetrieval(), FailingModel())

    async def test_audit_records_successful_analysis(self) -> None:
        class FakeAudit:
            def __init__(self):
                self.persisted = []
                self.events = []
                self.usage = []

            async def persist_insight(self, session_id, insight):
                self.persisted.append((session_id, insight))

            async def append_event(self, session_id, event):
                self.events.append((session_id, event))

            async def record_usage(self, therapist_id, event_type):
                self.usage.append((therapist_id, event_type))

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )
        audit = FakeAudit()

        insight = await analyze(
            request, FakeRetrieval(), FakeModel(), audit=audit
        )

        self.assertEqual(len(audit.persisted), 1)
        self.assertEqual(audit.persisted[0][0], "session-1")
        self.assertEqual(len(audit.events), 1)
        self.assertEqual(audit.events[0][1]["type"], "AI_INSIGHT")
        self.assertEqual(audit.usage, [("therapist-1", "AI_ANALYSIS")])
        self.assertEqual(audit.persisted[0][1], insight.to_dict())

    async def test_audit_persistence_failure_propagates(self) -> None:
        class FailingAudit:
            async def persist_insight(self, session_id, insight):
                raise RuntimeError("Audit persistence unavailable")

            async def append_event(self, session_id, event):
                raise AssertionError(
                    "Event must not be appended after persistence fails"
                )

            async def record_usage(self, therapist_id, event_type):
                raise AssertionError(
                    "Usage must not be recorded after persistence fails"
                )

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )

        with self.assertRaisesRegex(
            RuntimeError, "Audit persistence unavailable"
        ):
            await analyze(
                request, FakeRetrieval(), FakeModel(), audit=FailingAudit()
            )

    async def test_audit_event_failure_propagates(self) -> None:
        class FailingAudit:
            def __init__(self):
                self.persisted = []

            async def persist_insight(self, session_id, insight):
                self.persisted.append((session_id, insight))

            async def append_event(self, session_id, event):
                raise RuntimeError("Audit event unavailable")

            async def record_usage(self, therapist_id, event_type):
                raise AssertionError(
                    "Usage must not be recorded after event failure"
                )

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )
        audit = FailingAudit()

        with self.assertRaisesRegex(
            RuntimeError, "Audit event unavailable"
        ):
            await analyze(
                request, FakeRetrieval(), FakeModel(), audit=audit
            )

        self.assertEqual(len(audit.persisted), 1)

    async def test_audit_usage_failure_propagates(self) -> None:
        class FailingAudit:
            def __init__(self):
                self.persisted = []
                self.events = []

            async def persist_insight(self, session_id, insight):
                self.persisted.append((session_id, insight))

            async def append_event(self, session_id, event):
                self.events.append((session_id, event))

            async def record_usage(self, therapist_id, event_type):
                raise RuntimeError("Usage recording unavailable")

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )
        audit = FailingAudit()

        with self.assertRaisesRegex(
            RuntimeError, "Usage recording unavailable"
        ):
            await analyze(
                request, FakeRetrieval(), FakeModel(), audit=audit
            )

        self.assertEqual(len(audit.persisted), 1)
        self.assertEqual(len(audit.events), 1)

    async def test_audit_persistence_failure_propagates(self) -> None:
        class FailingAudit:
            async def persist_insight(self, session_id, insight):
                raise RuntimeError("Audit persistence unavailable")

            async def append_event(self, session_id, event):
                raise AssertionError(
                    "Event must not be appended after persistence fails"
                )

            async def record_usage(self, therapist_id, event_type):
                raise AssertionError(
                    "Usage must not be recorded after persistence fails"
                )

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )

        with self.assertRaisesRegex(
            RuntimeError, "Audit persistence unavailable"
        ):
            await analyze(
                request, FakeRetrieval(), FakeModel(), audit=FailingAudit()
            )

    async def test_audit_event_failure_propagates(self) -> None:
        class FailingAudit:
            def __init__(self):
                self.persisted = []

            async def persist_insight(self, session_id, insight):
                self.persisted.append((session_id, insight))

            async def append_event(self, session_id, event):
                raise RuntimeError("Audit event unavailable")

            async def record_usage(self, therapist_id, event_type):
                raise AssertionError(
                    "Usage must not be recorded after event failure"
                )

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )
        audit = FailingAudit()

        with self.assertRaisesRegex(
            RuntimeError, "Audit event unavailable"
        ):
            await analyze(
                request, FakeRetrieval(), FakeModel(), audit=audit
            )

        self.assertEqual(len(audit.persisted), 1)

    async def test_audit_usage_failure_propagates(self) -> None:
        class FailingAudit:
            def __init__(self):
                self.persisted = []
                self.events = []

            async def persist_insight(self, session_id, insight):
                self.persisted.append((session_id, insight))

            async def append_event(self, session_id, event):
                self.events.append((session_id, event))

            async def record_usage(self, therapist_id, event_type):
                raise RuntimeError("Usage recording unavailable")

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )
        audit = FailingAudit()

        with self.assertRaisesRegex(
                RuntimeError, "Usage recording unavailable"
        ):
            await analyze(
                request, FakeRetrieval(), FakeModel(), audit=audit
            )

        self.assertEqual(len(audit.persisted), 1)
        self.assertEqual(len(audit.events), 1)

    async def test_private_notes_are_excluded_by_default(self) -> None:
        class PrivateNotesRetrieval(FakeRetrieval):
            async def retrieve(self, request: PipelineInput) -> RetrievedContext:
                context = await super().retrieve(request)
                context.previous_notes = [
                    PreviousNote(
                        session_id="old-session-1",
                        content="Public progress note.",
                        session_number=1,
                        private=False,
                    ),
                    PreviousNote(
                        session_id="old-session-2",
                        content="CONFIDENTIAL PRIVATE NOTE.",
                        session_number=2,
                        private=True,
                    ),
                ]
                return context

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
        )
        payload, _ = await process_pipeline_with_details(
            request, PrivateNotesRetrieval()
        )

        historical = payload.structured_sections["historical"]
        self.assertIn("Public progress note.", historical)
        self.assertNotIn("CONFIDENTIAL PRIVATE NOTE.", historical)

    async def test_private_notes_can_be_included_when_allowed(self) -> None:
        class PrivateNotesRetrieval(FakeRetrieval):
            async def retrieve(self, request: PipelineInput) -> RetrievedContext:
                context = await super().retrieve(request)
                context.previous_notes = [
                    PreviousNote(
                        session_id="old-session-2",
                        content="CONFIDENTIAL PRIVATE NOTE.",
                        session_number=2,
                        private=True,
                    )
                ]
                return context

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
            allow_private_notes=True,
        )
        payload, _ = await process_pipeline_with_details(
            request, PrivateNotesRetrieval()
        )

        self.assertIn(
            "CONFIDENTIAL PRIVATE NOTE.",
            payload.structured_sections["historical"],
        )

    async def test_low_relevance_chunks_are_excluded(self) -> None:
        class RelevanceRetrieval(FakeRetrieval):
            async def retrieve(self, request: PipelineInput) -> RetrievedContext:
                context = await super().retrieve(request)
                context.knowledge_chunks = [
                    RetrievedChunk(
                        text="Relevant grounding exercise.",
                        file_name="relevant.pdf",
                        chunk_index=0,
                        similarity=0.90,
                    ),
                    RetrievedChunk(
                        text="LOW RELEVANCE TEST CONTENT.",
                        file_name="irrelevant.pdf",
                        chunk_index=1,
                        similarity=0.10,
                    ),
                ]
                return context

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
            similarity_threshold=0.25,
        )
        payload, _ = await process_pipeline_with_details(
            request, RelevanceRetrieval()
        )

        knowledge = payload.structured_sections["knowledge"]
        self.assertIn("Relevant grounding exercise.", knowledge)
        self.assertNotIn("LOW RELEVANCE TEST CONTENT.", knowledge)

    async def test_too_small_token_budget_is_rejected(self) -> None:
        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
            token_budget=128,
        )

        with self.assertRaisesRegex(ValueError, "token_budget is too small"):
            await process_pipeline_with_details(request, FakeRetrieval())

    async def test_large_context_fits_requested_token_budget(self) -> None:
        class LargeContextRetrieval(FakeRetrieval):
            async def retrieve(self, request: PipelineInput) -> RetrievedContext:
                context = await super().retrieve(request)
                context.knowledge_chunks = [
                    RetrievedChunk(
                        text=("Grounding and coping guidance. " * 500),
                        file_name="large-guide.txt",
                        chunk_index=0,
                        similarity=0.99,
                    )
                ]
                context.transcript = [
                    TranscriptTurn(
                        "Client: " + ("I feel overwhelmed at school. " * 300),
                        "client",
                    )
                ]
                return context

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
            token_budget=1500,
        )

        payload, _ = await process_pipeline_with_details(
            request, LargeContextRetrieval()
        )

        self.assertLessEqual(payload.token_estimate, request.token_budget)
        self.assertEqual(
            payload.token_estimate,
            _estimate_tokens(payload.system_prompt + "\n" + payload.user_prompt),
        )
        self.assertTrue(
            "[truncated]" in payload.user_prompt
            or "[No relevant information]" in payload.user_prompt
        )


    async def test_transcript_window_excludes_old_timestamped_turns(self):
        class TimestampedRetrieval(FakeRetrieval):
            async def retrieve(self, request: PipelineInput) -> RetrievedContext:
                context = await super().retrieve(request)
                now = datetime.now(timezone.utc)
                context.transcript = [
                    TranscriptTurn(
                        "OLD TURN SHOULD BE EXCLUDED",
                        "client",
                        timestamp=now - timedelta(minutes=20),
                    ),
                    TranscriptTurn(
                        "RECENT TURN SHOULD REMAIN",
                        "client",
                        timestamp=now - timedelta(minutes=2),
                    ),
                ]
                return context

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
            transcript_window_minutes=5,
        )

        payload, _ = await process_pipeline_with_details(
            request, TimestampedRetrieval()
        )

        transcript = payload.structured_sections["transcript"]
        self.assertNotIn("OLD TURN SHOULD BE EXCLUDED", transcript)
        self.assertIn("RECENT TURN SHOULD REMAIN", transcript)

    async def test_transcript_window_zero_excludes_older_turns(self):
        class TimestampedRetrieval(FakeRetrieval):
            async def retrieve(self, request: PipelineInput) -> RetrievedContext:
                context = await super().retrieve(request)
                now = datetime.now(timezone.utc)
                context.transcript = [
                    TranscriptTurn(
                        "OLDER TURN",
                        "client",
                        timestamp=now - timedelta(minutes=1),
                    ),
                    TranscriptTurn(
                        "NEWEST TURN",
                        "client",
                        timestamp=now,
                    ),
                ]
                return context

        request = PipelineInput(
            therapist_id="therapist-1",
            session_id="session-1",
            client_id="client-1",
            transcript_window_minutes=0,
        )

        payload, _ = await process_pipeline_with_details(
            request, TimestampedRetrieval()
        )

        transcript = payload.structured_sections["transcript"]
        self.assertNotIn("OLDER TURN", transcript)
        self.assertIn("NEWEST TURN", transcript)



if __name__ == "__main__":
    unittest.main()