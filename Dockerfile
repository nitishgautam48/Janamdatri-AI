FROM node:22-slim AS frontend-build
WORKDIR /app/frontend-react
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

# tesseract-ocr(-hin) is the OCR engine src/document_extractor.py shells
# out to (via pytesseract) for scanned/photographed reports with no PDF
# text layer - English+Hindi, matching the rest of the app's bilingual
# text handling. PyMuPDF renders PDF pages to bitmaps for it without
# needing poppler-utils installed separately.
# ffmpeg is what src/stt.py shells out to, converting a browser's
# recorded webm/opus voice clip to the mono 16-bit PCM WAV Vosk needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-hin ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install deps first so this layer is cached across source-only changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY frontend/ ./frontend/
COPY data/ ./data/
COPY models/ ./models/
COPY --from=frontend-build /app/frontend-react/dist ./frontend-react/dist

EXPOSE 8000

# Shell form (not exec form) so $PORT actually expands - platforms like
# Render assign a port via this env var and health-check against it;
# falls back to 8000 for local `docker run` where PORT isn't set.
CMD uvicorn src.api.main:app --host 0.0.0.0 --port ${PORT:-8000}
