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
# curl/unzip fetch and unpack the Vosk model just below.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-hin ffmpeg curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Install deps first so this layer is cached across source-only changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY scripts/ ./scripts/
COPY frontend/ ./frontend/
COPY data/ ./data/
COPY models/ ./models/
COPY --from=frontend-build /app/frontend-react/dist ./frontend-react/dist

# Self-hosted Hindi speech-to-text model for src/stt.py (see its docstring
# for the full rationale). Baked into the image at build time, the same
# way tesseract-ocr-hin above is - not fetched lazily at request time,
# so the first voice message doesn't pay a download.
#
# Override VOSK_MODEL_URL to swap in the larger/more accurate
# vosk-model-hi-0.22 (~1.8GB, needs more memory at runtime) instead of the
# ~50MB small model, or to point at an internal mirror.
#
# This step is best-effort: an image built somewhere without a route to
# alphacephei.com still builds and runs - src/stt.py's own "not
# configured" path means the app just falls back to the browser's voice
# recognizer, the same graceful degradation it already has, rather than
# failing the whole build over an enhancement. (This repo's own dev
# sandbox is exactly that case: its network policy allows PyPI/npm but not
# alphacephei.com, so this step was never exercised there - see the
# session notes in src/stt.py.)
ARG VOSK_MODEL_URL=https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip
RUN set -e; \
    mkdir -p /app/models/vosk-hi; \
    if curl -fL --max-time 120 "$VOSK_MODEL_URL" -o /tmp/vosk-model.zip; then \
      unzip -q /tmp/vosk-model.zip -d /tmp/vosk-extract && \
      mv /tmp/vosk-extract/*/* /app/models/vosk-hi/ && \
      rm -rf /tmp/vosk-model.zip /tmp/vosk-extract && \
      echo "Vosk Hindi model provisioned at /app/models/vosk-hi"; \
    else \
      rmdir /app/models/vosk-hi 2>/dev/null || true; \
      echo "WARNING: could not fetch $VOSK_MODEL_URL - shipping without a" \
           "self-hosted STT model; voice input falls back to the browser's" \
           "own recognizer. See src/stt.py for how to provision one later."; \
    fi

# Always set, even if the fetch above failed: _load_model() in src/stt.py
# checks the directory actually exists before treating it as configured,
# so an unprovisioned image just falls back to the browser recognizer
# instead of erroring on a path that isn't there.
ENV VOSK_MODEL_PATH=/app/models/vosk-hi

EXPOSE 8000

# Shell form (not exec form) so $PORT actually expands - platforms like
# Render assign a port via this env var and health-check against it;
# falls back to 8000 for local `docker run` where PORT isn't set.
CMD uvicorn src.api.main:app --host 0.0.0.0 --port ${PORT:-8000}
