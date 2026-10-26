"""Offline tests for STAAD's unified retrieval layer."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from staad_ai.models import (
    ClientContext,
    PipelineInput,
    RetrievedChunk,
    RetrievedContext,
)
from staad_ai.retrieval import UnifiedRetriever


# -----------------------------
# Fake retriever implementations
# -----------------------------

class FakeClients:
    async def get_client(self, client_id, session_id, therapist_id):
        return ClientContext(
            client_id=client_id or "client-1",
            therapist_id=therapist_id,
            name="Test Client",
        )


class FakeSessions:
    async def get_session(
        self, session_id, client_id, therapist_id,
        transcript_window_minutes
    ):
        return {
            "sessionId": session_id or "session-1",
            "clientId": client_id,
            "therapistId": therapist_id,
            "transcript": [],
            "moduleEvents": [],
            "inCallNotes": [],
            "state": {},
        }


class FakeHistory:
    async def get_history(self, client_id, therapist_id, request):
        return {
            "previousNotes": [],
            "reports": [],
            "progressMetrics": [],
        }


class FakeSemantic:
    async def search(
        self, query, therapist_id, client_id,
        top_k, similarity_threshold
    ):
        return [
            RetrievedChunk(
                text="Example grounding exercise",
                file_name="guide.txt",
                chunk_index=0,
                similarity=0.9,
            )
        ]


# -----------------------------
# Retrieval layer tests
# -----------------------------

class RetrievalTests(unittest.IsolatedAsyncioTestCase):


    async def test_semantic_search_receives_requested_client_and_therapist_scope(self):
        class RecordingSemantic:
            def __init__(self):
                self.received = None

            async def search(
                self, query, therapist_id, client_id,
                top_k, similarity_threshold
            ):
                self.received = (therapist_id, client_id)
                return []

        semantic = RecordingSemantic()
        retriever = UnifiedRetriever(
            FakeClients(),
            FakeSessions(),
            FakeHistory(),
            semantic,
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
            semantic_query="grounding",
        )

        await retriever.retrieve(request)

        self.assertEqual(
            semantic.received,
            ("therapist-1", "client-1"),
        )


    async def test_history_receives_requested_client_and_therapist_scope(self):
        class RecordingHistory:
            def __init__(self):
                self.received = None

            async def get_history(self, client_id, therapist_id, request):
                self.received = (client_id, therapist_id)
                return {
                    "previousNotes": [],
                    "reports": [],
                    "progressMetrics": [],
                }

        history = RecordingHistory()
        retriever = UnifiedRetriever(
            FakeClients(),
            FakeSessions(),
            history,
            FakeSemantic(),
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
            semantic_query="grounding",
        )

        await retriever.retrieve(request)

        self.assertEqual(
            history.received,
            ("client-1", "therapist-1"),
        )


    async def test_rejects_invalid_semantic_chunk_type(self):
        class InvalidChunkSemantic:
            async def search(
                self, query, therapist_id, client_id,
                top_k, similarity_threshold
            ):
                return ["untrusted raw text"]

        retriever = UnifiedRetriever(
            FakeClients(),
            FakeSessions(),
            FakeHistory(),
            InvalidChunkSemantic(),
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
            semantic_query="grounding",
        )

        with self.assertRaises(TypeError):
            await retriever.retrieve(request)


    async def test_rejects_session_missing_therapist_id(self):
        class MissingTherapistIdSession(FakeSessions):
            async def get_session(
                self,
                session_id,
                client_id,
                therapist_id,
                transcript_window_minutes,
            ):
                return {
                    "sessionId": session_id,
                    "clientId": client_id,
                    # therapistId deliberately missing
                    "transcript": [],
                    "moduleEvents": [],
                    "inCallNotes": [],
                    "state": {},
                }

        retriever = UnifiedRetriever(
            FakeClients(),
            MissingTherapistIdSession(),
            FakeHistory(),
            FakeSemantic(),
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
        )

        with self.assertRaises(PermissionError):
            await retriever.retrieve(request)

    async def test_rejects_session_missing_client_id(self):
        class MissingClientIdSession(FakeSessions):
            async def get_session(
                self,
                session_id,
                client_id,
                therapist_id,
                transcript_window_minutes,
            ):
                return {
                    "sessionId": session_id,
                    # clientId deliberately missing
                    "therapistId": therapist_id,
                    "transcript": [],
                    "moduleEvents": [],
                    "inCallNotes": [],
                    "state": {},
                }

        retriever = UnifiedRetriever(
            FakeClients(),
            MissingClientIdSession(),
            FakeHistory(),
            FakeSemantic(),
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
        )

        with self.assertRaises(PermissionError):
            await retriever.retrieve(request)


    async def test_unified_retriever_assembles_context(self):
        retriever = UnifiedRetriever(
            FakeClients(),
            FakeSessions(),
            FakeHistory(),
            FakeSemantic(),
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
            semantic_query="grounding",
        )

        result = await retriever.retrieve(request)

        self.assertIsInstance(result, RetrievedContext)
        self.assertEqual(result.therapist_id, "therapist-1")
        self.assertEqual(result.client.client_id, "client-1")
        self.assertEqual(result.session_id, "session-1")
        self.assertEqual(len(result.knowledge_chunks), 1)
        self.assertIn(
            "grounding",
            result.knowledge_chunks[0].text.lower(),
        )

    async def test_rejects_malformed_history_result(self):
        class MalformedHistory:
            async def get_history(self, client_id, therapist_id, request):
                return None

        retriever = UnifiedRetriever(
            FakeClients(),
            FakeSessions(),
            MalformedHistory(),
            FakeSemantic(),
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
            semantic_query="grounding",
        )

        with self.assertRaises((TypeError, AttributeError)):
            await retriever.retrieve(request)

    async def test_rejects_malformed_semantic_result(self):
        class MalformedSemantic:
            async def search(
                self, query, therapist_id, client_id,
                top_k, similarity_threshold
            ):
                return None

        retriever = UnifiedRetriever(
            FakeClients(),
            FakeSessions(),
            FakeHistory(),
            MalformedSemantic(),
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
            semantic_query="grounding",
        )

        with self.assertRaises((TypeError, AttributeError)):
            await retriever.retrieve(request)

    async def test_rejects_client_from_another_therapist(self):
        class WrongOwnerClient(FakeClients):
            async def get_client(
                self, client_id, session_id, therapist_id
            ):
                return ClientContext(
                    client_id=client_id or "client-1",
                    therapist_id="therapist-2",
                    name="Wrong Owner",
                )

        retriever = UnifiedRetriever(
            WrongOwnerClient(),
            FakeSessions(),
            FakeHistory(),
            FakeSemantic(),
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
        )

        with self.assertRaises(PermissionError):
            await retriever.retrieve(request)

    async def test_skips_semantic_search_without_query(self):
        class TrackingSemantic(FakeSemantic):
            def __init__(self):
                self.called = False

            async def search(
                self, query, therapist_id, client_id,
                top_k, similarity_threshold
            ):
                self.called = True
                return []

        semantic = TrackingSemantic()

        retriever = UnifiedRetriever(
            FakeClients(),
            FakeSessions(),
            FakeHistory(),
            semantic,
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
        )

        result = await retriever.retrieve(request)

        self.assertFalse(semantic.called)
        self.assertEqual(result.knowledge_chunks, [])

    async def test_rejects_session_from_another_therapist(self):
        class WrongTherapistSession(FakeSessions):
            async def get_session(
                self, session_id, client_id, therapist_id,
                transcript_window_minutes
            ):
                return {
                    "sessionId": session_id,
                    "clientId": client_id,
                    "therapistId": "therapist-2",
                    "transcript": [],
                    "moduleEvents": [],
                    "inCallNotes": [],
                    "state": {},
                }

        retriever = UnifiedRetriever(
            FakeClients(),
            WrongTherapistSession(),
            FakeHistory(),
            FakeSemantic(),
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
        )

        with self.assertRaises(PermissionError):
            await retriever.retrieve(request)

    async def test_rejects_session_from_another_client(self):
        class WrongClientSession(FakeSessions):
            async def get_session(
                self, session_id, client_id, therapist_id,
                transcript_window_minutes
            ):
                return {
                    "sessionId": session_id,
                    "clientId": "client-2",
                    "therapistId": therapist_id,
                    "transcript": [],
                    "moduleEvents": [],
                    "inCallNotes": [],
                    "state": {},
                }

        retriever = UnifiedRetriever(
            FakeClients(),
            WrongClientSession(),
            FakeHistory(),
            FakeSemantic(),
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
        )

        with self.assertRaises(PermissionError):
            await retriever.retrieve(request)

    async def test_history_and_semantic_retrievers_receive_correct_scope(
        self
    ):
        class TrackingHistory(FakeHistory):
            def __init__(self):
                self.received = None

            async def get_history(
                self, client_id, therapist_id, request
            ):
                self.received = (client_id, therapist_id)
                return await super().get_history(
                    client_id, therapist_id, request
                )

        class TrackingSemantic(FakeSemantic):
            def __init__(self):
                self.received = None

            async def search(
                self, query, therapist_id, client_id,
                top_k, similarity_threshold
            ):
                self.received = (therapist_id, client_id)
                return []

        history = TrackingHistory()
        semantic = TrackingSemantic()

        retriever = UnifiedRetriever(
            FakeClients(),
            FakeSessions(),
            history,
            semantic,
        )

        request = PipelineInput(
            therapist_id="therapist-1",
            client_id="client-1",
            session_id="session-1",
            semantic_query="grounding",
        )

        await retriever.retrieve(request)

        self.assertEqual(
            history.received,
            ("client-1", "therapist-1"),
        )
        self.assertEqual(
            semantic.received,
            ("therapist-1", "client-1"),
        )

    async def test_rejects_wrong_session_id(self):
            class WrongSessionId(FakeSessions):
                async def get_session(
                        self, session_id, client_id, therapist_id,
                        transcript_window_minutes
                ):
                    return {
                        "sessionId": "different-session",
                        "clientId": client_id,
                        "therapistId": therapist_id,
                        "transcript": [],
                        "moduleEvents": [],
                        "inCallNotes": [],
                        "state": {},
                    }

            retriever = UnifiedRetriever(
                FakeClients(),
                WrongSessionId(),
                FakeHistory(),
                FakeSemantic(),
            )

            request = PipelineInput(
                therapist_id="therapist-1",
                client_id="client-1",
                session_id="session-1",
            )

            with self.assertRaisesRegex(
                    PermissionError, "different session"
            ):
                await retriever.retrieve(request)

    async def test_rejects_wrong_client_id(self):
            class WrongClientId(FakeClients):
                async def get_client(
                        self, client_id, session_id, therapist_id
                ):
                    return ClientContext(
                        client_id="different-client",
                        therapist_id=therapist_id,
                        name="Wrong Client",
                    )

            retriever = UnifiedRetriever(
                WrongClientId(),
                FakeSessions(),
                FakeHistory(),
                FakeSemantic(),
            )

            request = PipelineInput(
                therapist_id="therapist-1",
                client_id="client-1",
                session_id="session-1",
            )

            with self.assertRaisesRegex(
                    PermissionError, "different client"
            ):
                await retriever.retrieve(request)


if __name__ == "__main__":
    unittest.main()
