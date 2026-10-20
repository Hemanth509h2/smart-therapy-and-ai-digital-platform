"""A therapist's own study material (PDFs) in document_chunks, which the copilot
searches during "Analyse" (copilot/study_material.py).

    cd ai && source .venv/bin/activate
    python scripts/study_material.py setup                          # table + indexes, once
    python scripts/study_material.py ingest <therapistUid> <file.pdf> [--session <sessionId>]
    python scripts/study_material.py list <therapistUid>
    python scripts/study_material.py delete <therapistUid> <fileName>

<therapistUid> is the therapist's Firebase uid (the copilot searches by it).
Ingesting a file again replaces its chunks. Needs DATABASE_URL and
NVIDIA_API_KEY (from ai/.env).
"""

import json
import re
import sys
from pathlib import Path

AI_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AI_DIR))

import rag  # noqa: E402
import server  # noqa: E402
from pypdf import PdfReader  # noqa: E402

CHUNK_WORDS = 400
CHUNK_OVERLAP = 80
EMBED_BATCH_SIZE = 16
EMBED_TIMEOUT_SECONDS = 60
EMBED_ATTEMPTS = 5

SETUP_SQL = [
    "CREATE EXTENSION IF NOT EXISTS vector",
    f"""CREATE TABLE IF NOT EXISTS document_chunks (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      therapist_id  TEXT NOT NULL,
      session_id    TEXT,
      file_name     TEXT NOT NULL,
      chunk_index   INTEGER NOT NULL,
      chunk_text    TEXT NOT NULL,
      embedding     vector({rag.EMBEDDING_DIMENSIONS}),
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      metadata      JSONB DEFAULT '{{}}'::jsonb
    )""",
    """CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
      ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)""",
    "CREATE INDEX IF NOT EXISTS document_chunks_therapist_idx ON document_chunks (therapist_id)",
]


def clean_pdf_text(raw):
    """Joins words hyphenated across lines and lines broken mid-sentence; a page
    break becomes a paragraph break."""
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", raw)
    text = re.sub(r"\n(?=[a-z])", " ", text)
    return text.replace("\f", "\n\n").strip()


def chunk_text(text):
    """~400-word chunks overlapping by 80 words: [{text, index, word_count}]."""
    words = text.split()
    chunks, start = [], 0
    while start < len(words):
        part = words[start:start + CHUNK_WORDS]
        chunks.append({"text": " ".join(part), "index": len(chunks), "word_count": len(part)})
        start += CHUNK_WORDS - CHUNK_OVERLAP
        if len(words) - start <= CHUNK_OVERLAP:
            break
    return chunks


def pdf_text(path):
    reader = PdfReader(str(path))
    return clean_pdf_text("\f".join(page.extract_text() or "" for page in reader.pages))


def setup(conn):
    for statement in SETUP_SQL:
        conn.execute(statement)
    conn.commit()
    print("document_chunks table and indexes ready")


def ingest(conn, therapist_uid, path, session_id=None):
    path = Path(path)
    chunks = chunk_text(pdf_text(path))
    if not chunks:
        sys.exit(f"No text found in {path.name}")
    print(f"{path.name}: {len(chunks)} chunks of ~{CHUNK_WORDS} words")
    embeddings = []
    for i in range(0, len(chunks), EMBED_BATCH_SIZE):
        batch = [c["text"] for c in chunks[i:i + EMBED_BATCH_SIZE]]
        embeddings += rag.embed(batch, "passage", timeout=EMBED_TIMEOUT_SECONDS, attempts=EMBED_ATTEMPTS)
        print(f"  embedded {min(i + EMBED_BATCH_SIZE, len(chunks))}/{len(chunks)}")
    # Replace the file's chunks in one transaction, so a re-run never leaves a mix.
    with conn.transaction():
        conn.execute("DELETE FROM document_chunks WHERE therapist_id = %s AND file_name = %s",
                     (therapist_uid, path.name))
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO document_chunks
                     (therapist_id, session_id, file_name, chunk_index, chunk_text, embedding, metadata)
                   VALUES (%s, %s, %s, %s, %s, %s::vector, %s::jsonb)""",
                [(therapist_uid, session_id, path.name, c["index"], c["text"], rag.vector_literal(e),
                  json.dumps({"wordCount": c["word_count"], "chunkSize": len(chunks),
                              "embeddingModel": rag.EMBEDDING_MODEL}))
                 for c, e in zip(chunks, embeddings)],
            )
    print(f"Stored {len(chunks)} chunks")


def list_files(conn, therapist_uid):
    rows = conn.execute(
        """SELECT file_name, COUNT(*), MIN(created_at) FROM document_chunks
           WHERE therapist_id = %s GROUP BY file_name ORDER BY MIN(created_at) DESC""",
        (therapist_uid,)).fetchall()
    for name, count, created in rows:
        print(f"{created:%Y-%m-%d}  {count:4d} chunks  {name}")
    if not rows:
        print("No study material for this therapist.")


def delete(conn, therapist_uid, file_name):
    deleted = conn.execute("DELETE FROM document_chunks WHERE therapist_id = %s AND file_name = %s",
                           (therapist_uid, file_name)).rowcount
    conn.commit()
    print(f"Deleted {deleted} chunks")


def main(argv):
    server.load_env_file(AI_DIR / ".env")
    if not (rag.is_configured() and rag.can_embed()):
        sys.exit("DATABASE_URL and NVIDIA_API_KEY must be set (ai/.env).")
    command, args = (argv[0] if argv else ""), argv[1:]
    session = None
    if "--session" in args:
        i = args.index("--session")
        session, args = (args[i + 1] if i + 1 < len(args) else None), args[:i] + args[i + 2:]
    with rag.connect() as conn:
        if command == "setup" and not args:
            setup(conn)
        elif command == "ingest" and len(args) == 2:
            ingest(conn, args[0], args[1], session)
        elif command == "list" and len(args) == 1:
            list_files(conn, args[0])
        elif command == "delete" and len(args) == 2:
            delete(conn, args[0], args[1])
        else:
            sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
