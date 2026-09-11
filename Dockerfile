FROM python:3.11-slim

WORKDIR /app

# Install deps first so this layer is cached across source-only changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY frontend/ ./frontend/
COPY data/ ./data/
COPY models/ ./models/

EXPOSE 8000

# Shell form (not exec form) so $PORT actually expands - platforms like
# Render assign a port via this env var and health-check against it;
# falls back to 8000 for local `docker run` where PORT isn't set.
CMD uvicorn src.api.main:app --host 0.0.0.0 --port ${PORT:-8000}
