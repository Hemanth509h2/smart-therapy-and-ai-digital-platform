
import asyncio

from staad_ai.dataset_benchmark import (
    DATASETS_ROOT,
    PACKAGES,
    _lexical_score,
    _read_jsonl,
    _record_text,
    _tokens,
)

QUERY = (
    "What is Specific Learning Disorder "
    "and which academic domains can be affected?"
)
TARGET_ID = "KB-COND-SLD"


async def main():
    paths = PACKAGES["ADHD_SLD"]
    records = _read_jsonl(DATASETS_ROOT / paths["knowledge"])

    scored = []

    for record in records:
        record_id = str(record.get("record_id", ""))
        text = _record_text(record)
        score = _lexical_score(QUERY, text)
        scored.append((score, record_id, text))

    scored.sort(key=lambda row: (-row[0], row[1]))

    print("QUERY TOKENS:")
    print(sorted(_tokens(QUERY)))

    target = next(
        (row for row in scored if row[1] == TARGET_ID),
        None,
    )

    print(f"\nTARGET: {TARGET_ID}")
    if target:
        rank = next(
            i for i, row in enumerate(scored, start=1)
            if row[1] == TARGET_ID
        )
        print(f"Rank: {rank} / {len(scored)}")
        print(f"Score: {target[0]:.4f}")
        print(f"Text preview: {target[2][:400]}")
    else:
        print("Target record not found.")

    print("\nTOP 5 RECORDS:")
    for rank, (score, record_id, text) in enumerate(
        scored[:5], start=1
    ):
        print(f"\n{rank}. ID={record_id}, score={score:.4f}")
        print(text[:250])


if __name__ == "__main__":
    asyncio.run(main())
