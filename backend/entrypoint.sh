#!/usr/bin/env bash
# Entrypoint for the ProteusFlow API service on Railway.
#
# Railway attaches a volume to exactly ONE service, but the API writes uploads
# and serves outputs while the workers write renders - they must see the same
# disk. So this runs the API, a Celery worker and the beat scheduler inside a
# single service that owns the volume.
#
# Renders still go through the queue, so a long encode never blocks an HTTP
# request; they simply run in a sibling process rather than a sibling service.
#
# Scaling note: to move the workers onto their own Railway service later, the
# storage has to move off the local disk first (S3/R2), because two services
# cannot share one volume.

set -euo pipefail

PORT="${PORT:-8000}"
WORKER_CONCURRENCY="${ADCAM_WORKER_CONCURRENCY:-5}"

# Railway's private network is IPv6-only, so binding 0.0.0.0 would leave the
# service unreachable at api.railway.internal. :: accepts IPv4 too.
BIND_HOST="${BIND_HOST:-::}"

export OMP_NUM_THREADS="${OMP_NUM_THREADS:-1}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-1}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-1}"
export NUMEXPR_NUM_THREADS="${NUMEXPR_NUM_THREADS:-1}"
export VECLIB_MAXIMUM_THREADS="${VECLIB_MAXIMUM_THREADS:-1}"
export OPENCV_FOR_THREADS_NUM="${OPENCV_FOR_THREADS_NUM:-2}"
export OPENCV_FFMPEG_CAPTURE_OPTIONS="${OPENCV_FFMPEG_CAPTURE_OPTIONS:-threads;2}"

log() { printf '[entrypoint] %s\n' "$*"; }

log "thread caps: OMP=${OMP_NUM_THREADS} OPENBLAS=${OPENBLAS_NUM_THREADS} OPENCV=${OPENCV_FOR_THREADS_NUM} FFMPEG_CAP=${OPENCV_FFMPEG_CAPTURE_OPTIONS}"

children=()

shutdown() {
  log "shutting down"
  for pid in "${children[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap shutdown EXIT INT TERM

if [ "${ADCAM_RUN_WORKER:-true}" = "true" ]; then
  log "starting celery worker (concurrency ${WORKER_CONCURRENCY})"
  celery -A app.celery_app.celery_app worker \
    -Q mutations -c "${WORKER_CONCURRENCY}" --loglevel=info &
  children+=($!)

  log "starting celery beat (retention sweeps)"
  celery -A app.celery_app.celery_app beat --loglevel=warning &
  children+=($!)
fi

log "starting api on [${BIND_HOST}]:${PORT}"
exec uvicorn app.main:app --host "${BIND_HOST}" --port "${PORT}" --proxy-headers --forwarded-allow-ips '*'
