"""Dataset-driven test runner for the STAAD Python retrieval/context pipeline.

This is an engineering baseline using deterministic lexical retrieval, not the
live STAAD vector database and not clinical validation.
Run from ai/:
    python -m staad_ai.dataset_benchmark
"""
from __future__ import annotations

import asyncio
import csv
import json
import re
from dataclasses import asdict
from pathlib import Path
from typing import Any, Mapping

from .models import ClientContext, PipelineInput, RetrievedChunk
from .pipeline import process_pipeline_with_details
from .retrieval import UnifiedRetriever


PACKAGE_ROOT = Path(__file__).resolve().parent
DATASETS_ROOT = PACKAGE_ROOT / "datasets"
OUTPUT_ROOT = PACKAGE_ROOT / "benchmark_results"
TOP_K = 5

# Paths are relative to staad_ai/datasets.
PACKAGES: dict[str, dict[str, str]] = {
    "ADHD_SLD": {
        "knowledge": "STAAD_ADHD_SLD_Final_Test_Package_v2/knowledge_memory/adhd_sld_knowledge_base.jsonl",
        "tests": "STAAD_ADHD_SLD_Final_Test_Package_v2/testing/retrieval_test_cases.jsonl",
    },
    "Anxiety": {
        "knowledge": "STAAD_Anxiety_Final_Test_Package/STAAD_Anxiety_Final_Test_Package/knowledge_memory/anxiety_knowledge_base_testing_candidate.jsonl",
        "tests": "STAAD_Anxiety_Final_Test_Package/STAAD_Anxiety_Final_Test_Package/testing/retrieval_test_cases.jsonl",
    },
    "Depression": {
        "knowledge": "STAAD_Depression_Final_Test_Package_v2/STAAD_Depression_Final_Test_Package_v2/knowledge_memory/depression_knowledge_base_testing_candidate.jsonl",
        "tests": "STAAD_Depression_Final_Test_Package_v2/STAAD_Depression_Final_Test_Package_v2/testing/retrieval_test_cases.jsonl",
    },
    "Intellectual_Disability": {
        "knowledge": "STAAD_Intellectual_Disability_Final_Test_Package/STAAD_Intellectual_Disability_Final_Test_Package/knowledge_memory/intellectual_disability_knowledge_base_testing_candidate.jsonl",
        "tests": "STAAD_Intellectual_Disability_Final_Test_Package/STAAD_Intellectual_Disability_Final_Test_Package/testing/retrieval_test_cases.jsonl",
    },
    "CBT": {
        "knowledge": "STAAD_CBT_Final_Test_Package_v3/STAAD_CBT_Final_Test_Package/knowledge_memory/CBT_Candidate_v3.jsonl",
        "tests": "STAAD_CBT_Final_Test_Package_v3/STAAD_CBT_Final_Test_Package/test_cases/cbt_retrieval_test_cases.jsonl",
    },
    "DBT": {
        "knowledge": "STAAD_DBT_Final_Test_Package_v3/STAAD_DBT_Final_Test_Package/knowledge_memory/DBT_Candidate_v3.jsonl",
        "tests": "STAAD_DBT_Final_Test_Package_v3/STAAD_DBT_Final_Test_Package/test_cases/dbt_retrieval_test_cases.jsonl",
    },
}

TOKEN_RE = re.compile(r"[a-z0-9]+")
STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "describe",
    "do", "does", "for", "from", "how", "i", "in", "into", "is", "it",
    "of", "on", "or", "should", "the", "this", "to", "what", "when",
    "which", "with", "without", "would", "you",
}
TEXT_FIELDS = (
    "record_id", "condition", "topic", "subtopic_path", "content_type",
    "age_group", "evidence_type", "safety_level", "content", "keywords",
    "retrieval_questions", "knowledge_type", "therapy", "category", "title",
    "clinical_caution", "claim", "staad_caveat", "suggested_questions",
    "applicability_tags", "intended_use",
)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise FileNotFoundError(f"Required dataset file not found: {path}")
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as stream:
        for line_no, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON in {path}, line {line_no}: {exc}") from exc
            if not isinstance(item, dict):
                raise ValueError(f"Expected a JSON object in {path}, line {line_no}")
            rows.append(item)
    return rows


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple, set)):
        return " ".join(_stringify(part) for part in value)
    if isinstance(value, dict):
        return " ".join(f"{key} {_stringify(val)}" for key, val in value.items())
    return str(value)


def _record_text(record: Mapping[str, Any]) -> str:
    parts = []
    for field in TEXT_FIELDS:
        value = record.get(field)
        if value is not None:
            text = _stringify(value).strip()
            if text:
                parts.append(text)
    return " ".join(parts)


def _tokens(text: str) -> set[str]:
    return {token for token in TOKEN_RE.findall(text.casefold()) if token not in STOP_WORDS}


def _lexical_score(query: str, text: str) -> float:
    """Simple deterministic query-token coverage score, scaled to [0, 1]."""
    query_tokens = _tokens(query)
    if not query_tokens:
        return 0.0
    document_tokens = _tokens(text)
    return len(query_tokens & document_tokens) / len(query_tokens)


def _expected_ids(test: Mapping[str, Any]) -> list[str]:
    raw = test.get("expected_record_ids", [])
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = [part.strip() for part in raw.split(",") if part.strip()]
    if not isinstance(raw, list):
        return []
    return [str(value) for value in raw if value is not None and str(value).strip()]


def _query(test: Mapping[str, Any]) -> str:
    for field in ("query", "query_or_scenario", "query_text"):
        value = test.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


class DatasetSemanticRetriever:
    """SemanticRetriever-compatible local lexical baseline for one package."""

    def __init__(self, records: list[dict[str, Any]], package_name: str):
        self.package_name = package_name
        self.records = records


    async def search(
        self,
        query: str,
        therapist_id: str,
        client_id: str,
        top_k: int,
        similarity_threshold: float,
    ) -> list[RetrievedChunk]:
        del therapist_id, client_id

        scored = []

        for index, record in enumerate(self.records):
            record_id = str(record.get("record_id", f"row-{index + 1}"))
            text = _record_text(record)

            score = _lexical_score(query, text)

            if score >= similarity_threshold and score > 0:
                content_score = _lexical_score(
                    query, _stringify(record.get("content", ""))
                )

                questions_score = _lexical_score(
                    query, _stringify(record.get("retrieval_questions", ""))
                )

                is_condition_profile = (
                    str(record.get("content_type", "")).casefold()
                    == "condition_profile"
                )

                scored.append(
                    (
                        score,
                        content_score,
                        questions_score,
                        is_condition_profile,
                        record_id,
                        index,
                        text,
                    )
                )

        scored.sort(
            key=lambda row: (
                -row[0],
                -row[1],
                -row[2],
                -int(row[3]),
                row[4],
            )
        )

        return [
            RetrievedChunk(
                text=text,
                file_name=record_id,
                chunk_index=index,
                similarity=score,
            )
            for (
                score,
                _content_score,
                _questions_score,
                _is_condition_profile,
                record_id,
                index,
                text,
            ) in scored[:max(0, top_k)]
        ]



class _ClientAdapter:
    async def get_client(self, client_id, session_id, therapist_id):
        del session_id
        if not client_id:
            client_id = "benchmark-client"
        return ClientContext(
            client_id=client_id,
            therapist_id=therapist_id,
            name="Benchmark Client",
        )


class _SessionAdapter:
    async def get_session(self, session_id, client_id, therapist_id, transcript_window_minutes):
        del transcript_window_minutes
        return {
            "sessionId": session_id or "benchmark-session",
            "clientId": client_id,
            "therapistId": therapist_id,
            "transcript": [],
            "moduleEvents": [],
            "inCallNotes": [],
            "state": {},
        }


class _HistoryAdapter:
    async def get_history(self, client_id, therapist_id, request):
        del client_id, therapist_id, request
        return {"previousNotes": [], "reports": [], "progressMetrics": []}


def _make_retriever(records: list[dict[str, Any]], package_name: str) -> UnifiedRetriever:
    return UnifiedRetriever(
        clients=_ClientAdapter(),
        sessions=_SessionAdapter(),
        history=_HistoryAdapter(),
        semantic=DatasetSemanticRetriever(records, package_name),
    )


async def _evaluate_test(
    package_name: str,
    test: dict[str, Any],
    retriever: UnifiedRetriever,
    k: int = TOP_K,
) -> dict[str, Any]:
    query = _query(test)
    test_id = str(test.get("test_id") or test.get("testId") or "UNKNOWN")
    expected = _expected_ids(test)
    if not query:
        return {
            "package": package_name,
            "test_id": test_id,
            "query": "",
            "expected_ids": json.dumps(expected),
            "retrieved_ids": "[]",
            "hits": 0,
            "expected_count": len(expected),
            "recall_at_k": None,
            "precision_at_k": None,
            "retrieval_status": "UNSCORABLE_NO_QUERY",
            "behavior_expectation": _stringify(test.get("expected_retrieval_or_behavior") or test.get("acceptance_criteria")),
            "safety_expectation": _stringify(test.get("safety_assertion") or test.get("safety_expectation")),
        }

    request = PipelineInput(
        therapist_id="benchmark-therapist",
        client_id="benchmark-client",
        session_id="benchmark-session",
        semantic_query=query,
        top_k=k,
        # The lexical baseline is evaluated before the pipeline's thresholding;
        # separate unit tests already exercise threshold filtering.
        similarity_threshold=0.0,
        token_budget=1500,
        intent="general",
    )
    payload, context = await process_pipeline_with_details(request, retriever)

    retrieved = context.knowledge_chunks[:k]
    retrieved_ids = [chunk.file_name for chunk in retrieved]
    hits = len(set(expected) & set(retrieved_ids))
    recall = hits / len(set(expected)) if expected else None
    precision = hits / k if expected else None

    if expected:
        status = "SCORED"
    else:
        status = "MANUAL_BEHAVIOR_REVIEW_REQUIRED"

    # The prompt section can be inspected to confirm that context construction
    # completed; this does not by itself validate clinical safety.
    knowledge_prompt_present = bool(payload.structured_sections.get("knowledge", "").strip())
    return {
        "package": package_name,
        "test_id": test_id,
        "query": query,
        "expected_ids": json.dumps(expected, ensure_ascii=False),
        "retrieved_ids": json.dumps(retrieved_ids, ensure_ascii=False),
        "hits": hits,
        "expected_count": len(set(expected)),
        "recall_at_k": round(recall, 4) if recall is not None else None,
        "precision_at_k": round(precision, 4) if precision is not None else None,
        "retrieval_status": status,
        "knowledge_in_prompt": knowledge_prompt_present,
        "behavior_expectation": _stringify(
            test.get("expected_retrieval_or_behavior")
            or test.get("expected_behavior")
            or test.get("acceptance_criteria")
        ),
        "safety_expectation": _stringify(
            test.get("safety_assertion") or test.get("safety_expectation")
        ),
    }


async def run_benchmark() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    results: list[dict[str, Any]] = []
    package_summaries: list[dict[str, Any]] = []

    for package_name, paths in PACKAGES.items():
        knowledge_path = DATASETS_ROOT / paths["knowledge"]
        tests_path = DATASETS_ROOT / paths["tests"]
        records = _read_jsonl(knowledge_path)
        tests = _read_jsonl(tests_path)
        ids = [str(record.get("record_id", "")) for record in records]
        nonempty_ids = [record_id for record_id in ids if record_id]
        duplicate_ids = sorted({record_id for record_id in nonempty_ids if nonempty_ids.count(record_id) > 1})
        retriever = _make_retriever(records, package_name)

        package_results = []
        for test in tests:
            package_results.append(await _evaluate_test(package_name, test, retriever))
        results.extend(package_results)

        scored = [row for row in package_results if row["recall_at_k"] is not None]
        summaries_with_recall = [row["recall_at_k"] for row in scored]
        summaries_with_precision = [row["precision_at_k"] for row in scored]
        package_summaries.append({
            "package": package_name,
            "knowledge_records": len(records),
            "tests": len(tests),
            "records_without_id": sum(not record_id for record_id in ids),
            "duplicate_record_ids": json.dumps(duplicate_ids),
            "tests_with_expected_ids": len(scored),
            "tests_needing_manual_behavior_review": sum(
                row["retrieval_status"] == "MANUAL_BEHAVIOR_REVIEW_REQUIRED"
                for row in package_results
            ),
            "mean_recall_at_5": round(sum(summaries_with_recall) / len(summaries_with_recall), 4) if summaries_with_recall else None,
            "mean_precision_at_5": round(sum(summaries_with_precision) / len(summaries_with_precision), 4) if summaries_with_precision else None,
            "retrieval_method": "deterministic lexical baseline (not live vector retrieval)",
        })

    return results, package_summaries


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    fields: list[str] = []
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)
    with path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    results, summaries = asyncio.run(run_benchmark())
    details_path = OUTPUT_ROOT / "dataset_benchmark_results.csv"
    summary_path = OUTPUT_ROOT / "dataset_benchmark_summary.csv"
    json_path = OUTPUT_ROOT / "dataset_benchmark_summary.json"
    _write_csv(details_path, results)
    _write_csv(summary_path, summaries)
    json_path.write_text(json.dumps({
        "notice": (
            "Engineering baseline only. Lexical retrieval is simulated and does not "
            "validate the live STAAD vector database, generated clinical responses, "
            "or clinical safety."
        ),
        "packages": summaries,
        "test_results": results,
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\nSTAAD DATASET BENCHMARK — LOCAL LEXICAL BASELINE")
    print("=" * 58)
    for item in summaries:
        recall = item["mean_recall_at_5"]
        precision = item["mean_precision_at_5"]
        print(
            f'{item["package"]}: records={item["knowledge_records"]}, '
            f'tests={item["tests"]}, mean_recall@5={recall}, '
            f'mean_precision@5={precision}, '
            f'manual_behavior_review={item["tests_needing_manual_behavior_review"]}'
        )
    print("\nFiles written:")
    print(f"  {details_path}")
    print(f"  {summary_path}")
    print(f"  {json_path}")
    print("\nReminder: these are lexical-baseline results, not live STAAD or clinical validation.")


if __name__ == "__main__":
    main()
