# syntax=docker/dockerfile:1
FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# ffmpeg/ffprobe are the engine; libgl + libglib are OpenCV's runtime deps.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      libgl1 \
      libglib2.0-0 \
      curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

# The API and the workers run unprivileged and share the storage volume.
RUN useradd --create-home --uid 10001 adcam \
 && mkdir -p /data \
 && chmod +x /usr/local/bin/entrypoint.sh \
 && chown -R adcam:adcam /app /data
USER adcam

ENV ADCAM_STORAGE_ROOT=/data

# Railway injects PORT; Compose leaves it unset and 8000 applies.
ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/api/v1/health" || exit 1

# Runs the API alone by default. entrypoint.sh additionally starts the worker
# and beat in-process, which is what Railway needs because a volume can only be
# attached to one service.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
