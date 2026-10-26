
"""Read-only PostgreSQL adapters for the STAAD retrieval layer.

Every table read here (ProfileClient, Session, TherapistNote, ProgressNote,
SessionReport, ProgressReport, ProgressMetric, document_chunks) is in the HIPAA
database, DATABASE_URL_2 (backend/prisma/schema.prisma). Connections and
embeddings go through rag.py, so study material is searched with the same
model it was stored with. Does not modify the backend or the Prisma schema.
"""

from __future__ import annotations

import asyncio
import os
from datetime import date, datetime

import rag

from .models import (
    ClientContext,
    PipelineInput,
    PreviousNote,
    RetrievedChunk,
)


def is_configured(env=os.environ) -> bool:
    return rag.is_configured(rag.HIPAA_DB, env)


def _connect(env=os.environ):
    return rag.connect(rag.HIPAA_DB, env)


def session_owner(session_id, env=os.environ) -> str | None:
    """The therapist who owns the session, or None. Blocking."""
    with _connect(env) as conn:
        row = conn.execute('SELECT "therapistId" FROM "Session" WHERE "id" = %s', (session_id,)).fetchone()
    return row[0] if row else None


def _age_from_dob(dob: date | datetime | None) -> int | None:
    if dob is None:
        return None
    today = date.today()
    birth_date = dob.date() if isinstance(dob, datetime) else dob
    return today.year - birth_date.year - (
        (today.month, today.day) < (birth_date.month, birth_date.day)
    )


class PostgresClientRetriever:
    def __init__(self, env=os.environ):
        self.env = env

    async def get_client(
        self,
        client_id: str | None,
        session_id: str | None,
        therapist_id: str,
    ) -> ClientContext:
        return await asyncio.to_thread(
            self._get_client, client_id, session_id, therapist_id
        )

    def _get_client(self, client_id, session_id, therapist_id):
        with _connect(self.env) as conn, conn.cursor() as cur:
            if session_id:
                # ProfileClient."therapistId" is optional; the session's owner is
                # what scopes this lookup, so fall back to it.
                cur.execute(
                    '''
                    SELECT c."id", COALESCE(c."therapistId", s."therapistId"), c."firstName",
                           c."lastName", c."dateOfBirth", c."diagnosis",
                           c."phoneNumber", c."parentEmail"
                    FROM "Session" s
                    JOIN "ProfileClient" c ON c."id" = s."clientId"
                    WHERE s."id" = %s
                      AND s."therapistId" = %s
                      AND (%s::text IS NULL OR s."clientId" = %s)
                    ''',
                    (session_id, therapist_id, client_id, client_id),
                )
            elif client_id:
                cur.execute(
                    '''
                    SELECT "id", "therapistId", "firstName", "lastName",
                           "dateOfBirth", "diagnosis", "phoneNumber", "parentEmail"
                    FROM "ProfileClient"
                    WHERE "id" = %s AND "therapistId" = %s
                    ''',
                    (client_id, therapist_id),
                )
            else:
                raise ValueError("Provide a client_id or session_id.")

            row = cur.fetchone()
            if not row:
                raise PermissionError(
                    "Client or session not found in the requested therapist scope."
                )

            (
                actual_client_id,
                actual_therapist_id,
                first_name,
                last_name,
                dob,
                diagnosis,
                phone,
                parent_email,
            ) = row

            return ClientContext(
                client_id=actual_client_id,
                therapist_id=actual_therapist_id,
                name=" ".join(part for part in [first_name, last_name] if part).strip()
                or "Client",
                age=_age_from_dob(dob),
                conditions=list(diagnosis or []),
                phone=phone,
                parent_email=parent_email,
            )


class PostgresSessionRetriever:
    def __init__(self, env=os.environ):
        self.env = env

    async def get_session(
        self,
        session_id: str | None,
        client_id: str,
        therapist_id: str,
        transcript_window_minutes: int,
    ):
        return await asyncio.to_thread(
            self._get_session,
            session_id,
            client_id,
            therapist_id,
            transcript_window_minutes,
        )

    def _get_session(self, session_id, client_id, therapist_id, transcript_window_minutes):
        if not session_id:
            raise ValueError("A session_id is required for session retrieval.")

        with _connect(self.env) as conn, conn.cursor() as cur:
            cur.execute(
                '''
                SELECT "id", "therapistId", "clientId", "status",
                       "startedAt", "endedAt"
                FROM "Session"
                WHERE "id" = %s
                  AND "clientId" = %s
                  AND "therapistId" = %s
                ''',
                (session_id, client_id, therapist_id),
            )
            row = cur.fetchone()

        if not row:
            raise PermissionError(
                "Session not found in the requested therapist/client scope."
            )

        actual_session_id, actual_therapist_id, actual_client_id, status, started, ended = row

        # The Session table has no transcript or module-event columns; the
        # backend sends those with the request (staad_ai/service.py).
        return {
            "sessionId": actual_session_id,
            "therapistId": actual_therapist_id,
            "clientId": actual_client_id,
            "transcript": [],
            "moduleEvents": [],
            "inCallNotes": [],
            "activeModuleId": None,
            "state": {
                "status": str(status) if status is not None else None,
                "startedAt": started.isoformat() if started else None,
                "endedAt": ended.isoformat() if ended else None,
                "transcriptWindowMinutes": transcript_window_minutes,
            },
        }


class PostgresHistoricalRetriever:
    def __init__(self, env=os.environ):
        self.env = env

    async def get_history(
        self,
        client_id: str,
        therapist_id: str,
        request: PipelineInput,
    ):
        return await asyncio.to_thread(
            self._get_history, client_id, therapist_id, request
        )

    def _get_history(self, client_id, therapist_id, request):
        previous_notes = []
        reports = []
        metrics = []

        with _connect(self.env) as conn, conn.cursor() as cur:
            # Private notes are excluded in SQL unless explicitly allowed.
            private_clause = "" if request.allow_private_notes else 'AND n."isPrivate" = FALSE'

            cur.execute(
                f'''
                SELECT n."sessionId", n."content", n."createdAt", n."isPrivate"
                FROM "TherapistNote" n
                JOIN "Session" s ON s."id" = n."sessionId"
                WHERE s."therapistId" = %s
                  AND s."clientId" = %s
                  {private_clause}
                ORDER BY n."createdAt" DESC
                LIMIT %s
                ''',
                (therapist_id, client_id, request.notes_limit),
            )
            for session_id, content, created_at, is_private in cur.fetchall():
                previous_notes.append(
                    PreviousNote(
                        session_id=session_id,
                        content=content,
                        created_at=created_at,
                        private=bool(is_private),
                    )
                )

            progress_private_clause = (
                "" if request.allow_private_notes else 'AND "isPrivate" = FALSE'
            )
            cur.execute(
                f'''
                SELECT "id", "content", "createdAt", "isPrivate"
                FROM "ProgressNote"
                WHERE "therapistId" = %s
                  AND "clientId" = %s
                  {progress_private_clause}
                ORDER BY "createdAt" DESC
                LIMIT %s
                ''',
                (therapist_id, client_id, request.notes_limit),
            )
            for note_id, content, created_at, is_private in cur.fetchall():
                reports.append(
                    {
                        "type": "progress_note",
                        "id": note_id,
                        "content": content,
                        "createdAt": created_at.isoformat() if created_at else None,
                        "private": bool(is_private),
                    }
                )

            cur.execute(
                '''
                SELECT "id", "sessionId", "content", "language",
                       "generatedAt", "visibleToClient"
                FROM "SessionReport"
                WHERE "therapistId" = %s AND "clientId" = %s
                ORDER BY "generatedAt" DESC
                LIMIT %s
                ''',
                (therapist_id, client_id, request.reports_limit),
            )
            for report_id, session_id, content, language, generated_at, visible in cur.fetchall():
                reports.append(
                    {
                        "type": "session_report",
                        "id": report_id,
                        "sessionId": session_id,
                        "content": content,
                        "language": language,
                        "generatedAt": generated_at.isoformat() if generated_at else None,
                        "visibleToClient": visible,
                    }
                )

            cur.execute(
                '''
                SELECT "id", "title", "summary", "periodStart", "periodEnd",
                       "metricsSnapshot", "status"
                FROM "ProgressReport"
                WHERE "therapistId" = %s AND "clientId" = %s
                ORDER BY "periodEnd" DESC
                LIMIT %s
                ''',
                (therapist_id, client_id, request.reports_limit),
            )
            for report_id, title, summary, start, end, snapshot, status in cur.fetchall():
                reports.append(
                    {
                        "type": "progress_report",
                        "id": report_id,
                        "title": title,
                        "summary": summary,
                        "periodStart": start.isoformat() if start else None,
                        "periodEnd": end.isoformat() if end else None,
                        "metricsSnapshot": snapshot,
                        "status": status,
                    }
                )

            cur.execute(
                '''
                SELECT "id", "metricType", "value", "unit", "notes",
                       "recordedAt", "sessionId"
                FROM "ProgressMetric"
                WHERE "therapistId" = %s AND "clientId" = %s
                ORDER BY "recordedAt" DESC
                LIMIT %s
                ''',
                (therapist_id, client_id, request.metrics_limit),
            )
            for metric_id, metric_type, value, unit, notes, recorded_at, session_id in cur.fetchall():
                metrics.append(
                    {
                        "id": metric_id,
                        "metricType": metric_type,
                        "value": value,
                        "unit": unit,
                        "notes": notes,
                        "recordedAt": recorded_at.isoformat() if recorded_at else None,
                        "sessionId": session_id,
                    }
                )

        return {
            "previousNotes": previous_notes,
            "reports": reports,
            "progressMetrics": metrics,
        }


class NvidiaPgvectorSemanticRetriever:
    """Semantic retrieval over document_chunks, embedded with rag.EMBEDDING_MODEL
    (the model scripts/study_material.py stores them with). Without an NVIDIA
    key there is no search, and the pipeline goes on without study material."""

    def __init__(self, env=os.environ):
        self.env = env

    async def search(
        self,
        query: str,
        therapist_id: str,
        client_id: str,
        top_k: int,
        similarity_threshold: float,
    ) -> list[RetrievedChunk]:
        if not rag.can_embed(self.env):
            return []
        [embedding] = await asyncio.to_thread(rag.embed, [query], "query", self.env)
        return await asyncio.to_thread(
            self._search,
            rag.vector_literal(embedding),
            therapist_id,
            top_k,
            similarity_threshold,
        )

    def _search(self, vector_literal, therapist_id, top_k, threshold):
        with _connect(self.env) as conn, conn.cursor() as cur:
            # Only therapist-owned chunks are searched. If chunks are session-bound,
            # they are excluded here until the request-specific session scope is wired in.
            cur.execute(
                '''
                SELECT chunk_text, file_name, chunk_index,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM document_chunks
                WHERE therapist_id = %s
                  AND session_id IS NULL
                  AND embedding IS NOT NULL
                  AND 1 - (embedding <=> %s::vector) >= %s
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                ''',
                (
                    vector_literal,
                    therapist_id,
                    vector_literal,
                    threshold,
                    vector_literal,
                    top_k,
                ),
            )
            rows = cur.fetchall()

        return [
            RetrievedChunk(
                text=row[0],
                file_name=row[1] or "",
                chunk_index=int(row[2] or 0),
                similarity=float(row[3]),
            )
            for row in rows
        ]


def create_postgres_retriever(env=os.environ):
    """Factory for UnifiedRetriever; no data is fetched until retrieve() is called."""
    from .retrieval import UnifiedRetriever

    return UnifiedRetriever(
        clients=PostgresClientRetriever(env),
        sessions=PostgresSessionRetriever(env),
        history=PostgresHistoricalRetriever(env),
        semantic=NvidiaPgvectorSemanticRetriever(env),
    )
