"""Composable retrieval layer for client, session, history, and vector knowledge."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import Any, Mapping, Protocol

from .models import ClientContext, PipelineInput, PreviousNote, RetrievedChunk, RetrievedContext, TranscriptTurn


class ClientRetriever(Protocol):
    async def get_client(self, client_id: str | None, session_id: str | None, therapist_id: str) -> ClientContext: ...

class SessionRetriever(Protocol):
    async def get_session(self, session_id: str | None, client_id: str, therapist_id: str,
                          transcript_window_minutes: int) -> Mapping[str, Any]: ...

class HistoricalRetriever(Protocol):
    async def get_history(self, client_id: str, therapist_id: str, request: PipelineInput) -> Mapping[str, Any]: ...

class SemanticRetriever(Protocol):
    async def search(self, query: str, therapist_id: str, client_id: str, top_k: int,
                     similarity_threshold: float) -> list[RetrievedChunk]: ...


class UnifiedRetriever:
    """Coordinates storage-specific adapters and enforces scope at the boundary.

    Implementations can wrap Prisma/Postgres, Firestore, pgvector, or test fakes.
    All adapters must apply therapist/client filters in their own database query;
    the final checks here are defense in depth, not a substitute for query scope.
    """

    def __init__(self, clients: ClientRetriever, sessions: SessionRetriever,
                 history: HistoricalRetriever, semantic: SemanticRetriever):
        self.clients = clients
        self.sessions = sessions
        self.history = history
        self.semantic = semantic

    async def retrieve(self, request: PipelineInput) -> RetrievedContext:
        client = await self.clients.get_client(request.client_id, request.session_id, request.therapist_id)
        if client.therapist_id != request.therapist_id:
            raise PermissionError("Client belongs to a different therapist")
        if request.client_id and client.client_id != request.client_id:
            raise PermissionError("Client retriever returned a different client")

        session_task = self.sessions.get_session(request.session_id, client.client_id,
                                                 request.therapist_id, request.transcript_window_minutes)
        history_task = self.history.get_history(client.client_id, request.therapist_id, request)
        query = request.semantic_query or request.module or ""
        semantic_task = (self.semantic.search(query, request.therapist_id, client.client_id,
                                               request.top_k, request.similarity_threshold)
                         if query.strip() else _empty_chunks())
        session, history, chunks = await asyncio.gather(session_task, history_task, semantic_task)

        if not isinstance(session, Mapping):
            raise TypeError("Session retriever must return a mapping")

        if not isinstance(history, Mapping):
            raise TypeError("History retriever must return a mapping")

        if not isinstance(chunks, list):
            raise TypeError("Semantic retriever must return a list of chunks")


        if not all(isinstance(chunk, RetrievedChunk) for chunk in chunks):
            raise TypeError(
                "Semantic retriever must return only RetrievedChunk objects"
            )

        resolved_session = str(session.get("sessionId") or "").strip()
        session_therapist_id = session.get("therapistId")
        session_client_id = session.get("clientId")

        # Require explicit ownership metadata; never infer it from the request.
        if not isinstance(session_therapist_id, str) or not session_therapist_id.strip():
            raise PermissionError("Session is missing therapist ownership metadata")

        if not isinstance(session_client_id, str) or not session_client_id.strip():
            raise PermissionError("Session is missing client ownership metadata")

        if not resolved_session:
            raise PermissionError("Session is missing session ID metadata")

        if request.session_id and resolved_session != request.session_id:
            raise PermissionError("Session retriever returned a different session")

        if session_therapist_id != request.therapist_id:
            raise PermissionError("Session belongs to a different therapist")

        if session_client_id != client.client_id:
            raise PermissionError("Session belongs to a different client")

        return RetrievedContext(
            client=client,
            session_id=resolved_session,
            therapist_id=request.therapist_id,
            transcript=list(session.get("transcript", [])),
            module_events=list(session.get("moduleEvents", [])),
            in_call_notes=list(session.get("inCallNotes", [])),
            previous_notes=list(history.get("previousNotes", [])),
            reports=list(history.get("reports", [])),
            progress_metrics=list(history.get("progressMetrics", [])),
            knowledge_chunks=chunks,
            active_module_id=session.get("activeModuleId"),
            session_state=session.get("state", {}),
        )


async def _empty_chunks() -> list[RetrievedChunk]:
    return []
