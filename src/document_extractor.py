"""
Extracts plain text from an uploaded document so it can feed the report
analyzer (see src/dynamic_eval/report_analyzer.py). Deliberately narrow
scope: .txt and .pdf only. A scanned/photographed report (an image, or a
PDF that is just a scanned image with no text layer) has no extractable
text without OCR, which needs a system-level engine (Tesseract) this
deployment does not install - rather than silently returning nothing for
those, extraction raises a clear error so the caller can tell the person
to paste the text by hand instead, which sidesteps the OCR problem
entirely and is honest about the limitation instead of pretending to
support image uploads.
"""

import io

from pypdf import PdfReader


class ExtractionError(Exception):
    pass


def extract_text(filename: str, content: bytes) -> str:
    name = (filename or "").lower()

    if name.endswith(".txt"):
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return content.decode("latin-1", errors="replace")

    if name.endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(content))
        except Exception as exc:
            raise ExtractionError(f"Could not read this PDF: {exc}") from exc

        pages_text = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(pages_text).strip()
        if not text:
            raise ExtractionError(
                "No text could be extracted from this PDF - it may be a scanned image without a text "
                "layer. Please paste the report's text directly instead."
            )
        return text

    raise ExtractionError(
        f"Unsupported file type for '{filename}'. Please upload a .pdf or .txt file, "
        "or paste the report's text directly."
    )
