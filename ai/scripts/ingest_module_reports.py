"""Load the STAAD therapy-module reports (.docx) into module_report_chunks, for the
call-plan agent's search (call_plan/module_reports.py).

Each report has numbered sections ("1. Module overview" ... "13. Advantages ..."),
so every section becomes one chunk, prefixed with the module name and category
so it still makes sense on its own.

    cd ai && source .venv/bin/activate
    python scripts/ingest_module_reports.py <folder> --dry-run   # check first
    python scripts/ingest_module_reports.py <folder>

<folder> holds one sub-folder per category (adhd, sld, "cbt, act", ...) with the
.docx files inside. Re-running replaces a file's chunks. Needs DATABASE_URL and
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
from call_plan.extract import _docx_text  # noqa: E402

EMBED_BATCH_SIZE = 16
EMBED_TIMEOUT_SECONDS = 60
EMBED_ATTEMPTS = 5
EXPECTED_SECTIONS = 13

CATEGORY_LABELS = {
    "adhd": "ADHD",
    "anxiety and depression": "Anxiety & Depression",
    "cbt, act": "CBT & ACT",
    "id": "Intellectual Disability",
    "skill development": "Skill Development",
    "sld": "SLD",
}

SETUP_SQL = [
    "CREATE EXTENSION IF NOT EXISTS vector",
    f"""CREATE TABLE IF NOT EXISTS module_report_chunks (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      module_name     TEXT NOT NULL,
      category        TEXT NOT NULL,
      file_name       TEXT NOT NULL,
      section_number  INTEGER NOT NULL,
      section_title   TEXT NOT NULL,
      chunk_index     INTEGER NOT NULL,
      chunk_text      TEXT NOT NULL,
      embedding       vector({rag.EMBEDDING_DIMENSIONS}) NOT NULL,
      metadata        JSONB NOT NULL DEFAULT '{{}}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT module_report_chunks_file_chunk_key UNIQUE (file_name, chunk_index)
    )""",
    # HNSW rather than IVFFlat: IVFFlat needs far more rows than a few hundred
    # chunks to give good recall.
    """CREATE INDEX IF NOT EXISTS module_report_chunks_embedding_idx
      ON module_report_chunks USING hnsw (embedding vector_cosine_ops)""",
    "CREATE INDEX IF NOT EXISTS module_report_chunks_category_idx ON module_report_chunks (category)",
    "CREATE INDEX IF NOT EXISTS module_report_chunks_module_name_idx ON module_report_chunks (module_name)",
]


def find_docx_files(folder):
    return sorted(p for p in Path(folder).rglob("*.docx")
                  if "__MACOSX" not in p.parts and not p.name.startswith("~$"))


def category_for(path):
    folder = path.parent.name
    return CATEGORY_LABELS.get(folder.lower(), folder)


def module_name_for(preamble, path):
    """Titles vary: "STAAD — Worry Box", "STAAD – Simon Says Module Report", or a
    generic "STAAD | SLD THERAPY MODULE" line followed by "Pixel Art Coding"."""
    for line in preamble:
        name = re.sub(r"^STAAD\s*[—–-]\s*", "", line)
        name = re.sub(r"\s*(Final\s+)?Module Report$", "", name, flags=re.I).strip()
        if name and not re.match(r"^STAAD\b", name) and not re.search(r"[|:]", name) \
                and not re.search(r"report$", name, re.I):
            return name
    stem = re.sub(r"^STAAD_", "", path.stem)
    stem = re.sub(r"_(Concise|Reaudited|Section|RAG|Module|Final|Verified|Report|Numbering|Corrected).*$", "", stem)
    return stem.replace("_", " ")


def split_sections(paragraphs):
    """Splits on headings numbered 1, 2, 3 ... in order, so a body paragraph that
    happens to start with a number isn't mistaken for a heading."""
    preamble, sections = [], []
    for para in paragraphs:
        heading = re.match(r"^(\d{1,2})\.\s+(.{3,80})$", para)
        if heading and int(heading.group(1)) == len(sections) + 1:
            sections.append({"number": int(heading.group(1)), "title": para, "body": ""})
        elif not sections:
            preamble.append(para)
        else:
            current = sections[-1]
            current["body"] = f"{current['body']}\n{para}" if current["body"] else para
    return preamble, sections


def chunk_report(path):
    paragraphs = [" ".join(p.split()) for p in _docx_text(path.read_bytes()).split("\n")]
    preamble, sections = split_sections([p for p in paragraphs if p])
    module_name, category = module_name_for(preamble, path), category_for(path)
    warnings = [] if len(sections) == EXPECTED_SECTIONS else \
        [f"expected {EXPECTED_SECTIONS} sections, found {len(sections)}"]

    # The preamble's classification line (category | focus | duration) is useful
    # context, so it goes into the overview chunk.
    details = [p for p in preamble if re.search(r"[|:]", p) and not re.match(r"^STAAD\s*\|", p)]
    chunks = []
    for i, section in enumerate(sections):
        body = "\n".join([*details, section["body"]]) if i == 0 and details else section["body"]
        if not body:
            warnings.append(f"section {section['number']} is empty")
        text = "\n".join([f"Module: {module_name}", f"Category: {category}", f"Section: {section['title']}", "", body])
        chunks.append({
            "file_name": path.name,
            "module_name": module_name,
            "category": category,
            "section_number": section["number"],
            "section_title": re.sub(r"^\d+\.\s+", "", section["title"]),
            "chunk_index": i,
            "chunk_text": text,
            "word_count": len(text.split()),
        })
    return chunks, warnings


def store(conn, chunks, embeddings):
    """Replaces the file's chunks in one transaction, so a re-run never leaves a mix."""
    metadata = {"embeddingModel": rag.EMBEDDING_MODEL, "dimensions": rag.EMBEDDING_DIMENSIONS}
    with conn.transaction():
        conn.execute("DELETE FROM module_report_chunks WHERE file_name = %s", (chunks[0]["file_name"],))
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO module_report_chunks
                     (module_name, category, file_name, section_number, section_title,
                      chunk_index, chunk_text, embedding, metadata)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector, %s::jsonb)""",
                [(c["module_name"], c["category"], c["file_name"], c["section_number"], c["section_title"],
                  c["chunk_index"], c["chunk_text"], rag.vector_literal(e),
                  json.dumps({"wordCount": c["word_count"], **metadata}))
                 for c, e in zip(chunks, embeddings)],
            )


def main(argv):
    dry_run = "--dry-run" in argv
    folder = next((a for a in argv if not a.startswith("--")), None)
    if not folder or not Path(folder).is_dir():
        sys.exit("Usage: python scripts/ingest_module_reports.py <folder> [--dry-run]")
    server.load_env_file(AI_DIR / ".env")

    files = find_docx_files(folder)
    print(f"Found {len(files)} .docx reports in {folder}\n")
    reports, names, warning_count = [], set(), 0
    for path in files:
        if path.name in names:
            sys.exit(f"Duplicate file name: {path.name}")
        names.add(path.name)
        chunks, warnings = chunk_report(path)
        reports.append(chunks)
        warning_count += len(warnings)
        first = chunks[0] if chunks else {}
        print(f"  {first.get('category', '?')} / {first.get('module_name', path.name)}: "
              f"{len(chunks)} chunks, {sum(c['word_count'] for c in chunks)} words"
              + (f"  ! {'; '.join(warnings)}" if warnings else ""))

    all_chunks = [c for chunks in reports for c in chunks]
    if not all_chunks:
        sys.exit("No sections found.")
    sizes = [c["word_count"] for c in all_chunks]
    print(f"\n{len(all_chunks)} chunks total, {min(sizes)}-{max(sizes)} words each"
          + (f", {warning_count} warnings" if warning_count else ""))
    if dry_run:
        print("\nDry run: nothing embedded or written. Sample chunk:\n")
        print(all_chunks[0]["chunk_text"])
        return

    if not (rag.is_configured(rag.APP_DB) and rag.can_embed()):
        sys.exit("DATABASE_URL and NVIDIA_API_KEY must be set (ai/.env).")
    with rag.connect(rag.APP_DB) as conn:
        for statement in SETUP_SQL:
            conn.execute(statement)
        conn.commit()
        print("\nmodule_report_chunks table and indexes ready")

        stored = 0
        for chunks in reports:
            if not chunks:
                continue
            embeddings = []
            for i in range(0, len(chunks), EMBED_BATCH_SIZE):
                batch = [c["chunk_text"] for c in chunks[i:i + EMBED_BATCH_SIZE]]
                embeddings += rag.embed(batch, "passage", timeout=EMBED_TIMEOUT_SECONDS, attempts=EMBED_ATTEMPTS)
            store(conn, chunks, embeddings)
            stored += len(chunks)
            print(f"  {chunks[0]['module_name']}: {len(chunks)} chunks stored ({stored}/{len(all_chunks)})")
        count = conn.execute("SELECT COUNT(*) FROM module_report_chunks").fetchone()[0]
    print(f"\nDone: {stored} chunks stored; module_report_chunks now has {count} rows")


if __name__ == "__main__":
    main(sys.argv[1:])
