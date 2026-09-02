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

# The API and the workers run unprivileged and share the storage volume.
RUN useradd --create-home --uid 10001 adcam \
 && mkdir -p /data \
 && chown -R adcam:adcam /app /data
USER adcam

ENV ADCAM_STORAGE_ROOT=/data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8000/api/v1/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
