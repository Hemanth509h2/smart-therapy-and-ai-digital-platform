"""Plain text from an uploaded notes file (PDF, Word .docx, or text).

Everything happens in memory: the file is never written to disk or kept after
the request.
"""

import io
import zipfile
from xml.etree import ElementTree

from pypdf import PdfReader
from pypdf.errors import PdfReadError

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TEXT_CHARS = 30_000  # roughly 20 pages of notes; the rest is cut off
MAX_DOCX_XML_BYTES = 20 * 1024 * 1024  # uncompressed, guards against zip bombs

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class ExtractError(ValueError):
    """The file can't be read. The message is safe to show to the therapist."""


def _pdf_text(data):
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ExtractError("This PDF is password-protected. Remove the password and upload it again.")
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except PdfReadError as e:
        raise ExtractError("This PDF could not be read.") from e


def _docx_text(data):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > MAX_DOCX_XML_BYTES:
                raise ExtractError("This Word file is too large to read.")
            root = ElementTree.fromstring(z.read(info))
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError) as e:
        raise ExtractError("This Word file could not be read. Save it as .docx or PDF and try again.") from e
    paragraphs = ("".join(t.text or "" for t in p.iter(f"{_W}t")) for p in root.iter(f"{_W}p"))
    return "\n".join(p for p in paragraphs if p.strip())


def extract_text(filename, data):
    """Returns the file's text, trimmed to MAX_TEXT_CHARS. Raises ExtractError."""
    if len(data) > MAX_FILE_BYTES:
        raise ExtractError("The file is larger than 5 MB.")
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        text = _pdf_text(data)
    elif name.endswith(".docx"):
        text = _docx_text(data)
    elif name.endswith((".txt", ".md")):
        text = data.decode("utf-8", "replace")
    else:
        raise ExtractError("Upload a PDF, Word (.docx) or text file.")
    text = text.strip()
    if not text:
        raise ExtractError("No text was found in this file. A scanned PDF needs to be typed or OCR'd first.")
    return text[:MAX_TEXT_CHARS]
