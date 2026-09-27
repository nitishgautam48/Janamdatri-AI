"""
Extracts plain text from an uploaded document so it can feed the report
analyzer (see src/dynamic_eval/report_analyzer.py).

Three paths, tried in this order for a PDF, and directly for an image:

1. .txt - decoded as-is.
2. .pdf with a real text layer - pypdf's fast, exact extraction.
3. .pdf with NO text layer (a scanned or photographed page saved as PDF),
   or a direct image upload (.jpg/.jpeg/.png/.webp) - OCR via Tesseract:
   each page is rendered to a bitmap with PyMuPDF (no external `poppler`
   binary needed) and read with pytesseract, in English+Hindi since the
   rest of this app is bilingual.

OCR is a best-effort reading, not a guarantee - Tesseract does
reasonably on printed/typed text but poorly on a doctor's handwriting,
which is exactly what most Indian prescriptions actually look like. The
frontend shows the extracted text back to the person before/alongside
the medication schedule for this reason: always follow the actual
prescription over this tool's reading of it.

If the Tesseract system binary isn't installed on a given deployment,
OCR is skipped rather than crashing - the caller gets the same honest
"paste the text yourself" message this module has always given for a
scanned document, just now only as a genuine fallback instead of the
only option.
"""

import io

from pypdf import PdfReader

try:
    import fitz  # PyMuPDF - renders a PDF page to a bitmap without needing poppler installed
    import pytesseract
    from PIL import Image

    _OCR_AVAILABLE = True
except ImportError:
    _OCR_AVAILABLE = False

# Bilingual, matching the rest of the app's English+Hindi symptom/UI text.
_OCR_LANG = "eng+hin"
# OCR is far more expensive than pypdf's text extraction - bound it so a
# huge multi-page upload can't tie up the request indefinitely.
_MAX_OCR_PAGES = 12
_MIN_USABLE_OCR_CHARS = 15

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")


class ExtractionError(Exception):
    pass


def _ocr_image(image: "Image.Image") -> str:
    return pytesseract.image_to_string(image, lang=_OCR_LANG)


def _ocr_pdf_pages(content: bytes) -> str:
    doc = fitz.open(stream=content, filetype="pdf")
    try:
        texts = []
        # 2x zoom - Tesseract does noticeably better on scanned prescription
        # photos above roughly 200 DPI than at a PDF page's native 72 DPI.
        matrix = fitz.Matrix(2, 2)
        for page in doc[:_MAX_OCR_PAGES]:
            pixmap = page.get_pixmap(matrix=matrix)
            image = Image.open(io.BytesIO(pixmap.tobytes("png")))
            texts.append(_ocr_image(image))
        return "\n".join(texts).strip()
    finally:
        doc.close()


def extract_text(filename: str, content: bytes) -> str:
    name = (filename or "").lower()

    if name.endswith(".txt"):
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return content.decode("latin-1", errors="replace")

    if name.endswith(IMAGE_EXTENSIONS):
        if not _OCR_AVAILABLE:
            raise ExtractionError(
                "This deployment can't read photos yet - please paste the report's text directly instead."
            )
        try:
            text = _ocr_image(Image.open(io.BytesIO(content))).strip()
        except Exception as exc:
            raise ExtractionError(f"Could not read this image: {exc}") from exc
        if len(text) < _MIN_USABLE_OCR_CHARS:
            raise ExtractionError(
                "Couldn't make out readable text in this photo - try a clearer, well-lit, flat photo, "
                "or paste the report's text directly instead."
            )
        return text

    if name.endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(content))
        except Exception as exc:
            raise ExtractionError(f"Could not read this PDF: {exc}") from exc

        pages_text = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(pages_text).strip()
        if text:
            return text

        # No text layer - likely a scanned/photographed page saved as a PDF.
        if not _OCR_AVAILABLE:
            raise ExtractionError(
                "No text could be extracted from this PDF - it may be a scanned image without a text "
                "layer. Please paste the report's text directly instead."
            )
        try:
            ocr_text = _ocr_pdf_pages(content)
        except Exception as exc:
            raise ExtractionError(f"Could not read this PDF: {exc}") from exc
        if len(ocr_text) < _MIN_USABLE_OCR_CHARS:
            raise ExtractionError(
                "This looks like a scanned or photographed page, and OCR couldn't make out readable "
                "text on it - try a clearer photo/scan, or paste the report's text directly instead."
            )
        return ocr_text

    raise ExtractionError(
        f"Unsupported file type for '{filename}'. Please upload a .pdf, .txt, or photo "
        "(.jpg/.png), or paste the report's text directly."
    )
