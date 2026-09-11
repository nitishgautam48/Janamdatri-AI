FROM node:22-slim AS frontend-build
WORKDIR /app/frontend-react
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

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
