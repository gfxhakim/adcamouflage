#!/usr/bin/env bash
# Start AdCamouflage locally: API, render worker and web UI, in one terminal.
#
#   ./scripts/start.sh
#
# Installs anything missing on first run, then starts every process under this
# shell and shuts them all down together on Ctrl-C.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BOLD=$'\033[1m'; DIM=$'\033[2m'; CYAN=$'\033[36m'; RED=$'\033[31m'; YEL=$'\033[33m'; OFF=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$CYAN$BOLD" "$OFF" "$*"; }
warn() { printf '%s warn%s %s\n' "$YEL" "$OFF" "$*"; }
die()  { printf '%s error%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }

API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"

# --- prerequisites ---------------------------------------------------------
command -v python3 >/dev/null || die "python3 is required (3.11+)."
command -v node    >/dev/null || die "node is required (20+)."
command -v npm     >/dev/null || die "npm is required."

if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  die "ffmpeg and ffprobe must be on PATH.
     macOS:          brew install ffmpeg
     Debian/Ubuntu:  sudo apt-get install ffmpeg
     Windows:        winget install Gyan.FFmpeg"
fi

python3 - <<'PY' || die "Python 3.11 or newer is required."
import sys
sys.exit(0 if sys.version_info >= (3, 11) else 1)
PY

# --- environment -----------------------------------------------------------
if [ ! -f .env ]; then
  say "Creating .env with a generated signing key"
  cp .env.example .env
  KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  python3 - "$KEY" <<'PY'
import pathlib, sys
key = sys.argv[1]
path = pathlib.Path(".env")
path.write_text(
    "\n".join(
        f"ADCAM_SECRET_KEY={key}" if line.startswith("ADCAM_SECRET_KEY=") else line
        for line in path.read_text().splitlines()
    )
    + "\n"
)
PY
fi

set -a; . ./.env; set +a

# Each service runs from its own directory, so a relative storage root would
# resolve differently per process. Anchor it to the repo root.
ADCAM_STORAGE_ROOT="${ADCAM_STORAGE_ROOT:-$ROOT/storage}"
case "$ADCAM_STORAGE_ROOT" in
  /*) ;;
  *) ADCAM_STORAGE_ROOT="$ROOT/${ADCAM_STORAGE_ROOT#./}" ;;
esac
export ADCAM_STORAGE_ROOT
mkdir -p "$ADCAM_STORAGE_ROOT"

# --- dependencies ----------------------------------------------------------
if [ ! -x .venv/bin/python ]; then
  say "Creating the Python virtualenv"
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
fi

if ! .venv/bin/python -c "import fastapi, celery, cv2" 2>/dev/null; then
  say "Installing backend dependencies (this takes a minute the first time)"
  .venv/bin/pip install --quiet -r backend/requirements.txt
fi

if [ ! -d frontend/node_modules ]; then
  say "Installing frontend dependencies"
  (cd frontend && npm install --no-audit --no-fund)
fi

# --- redis / worker mode ---------------------------------------------------
REDIS_URL="${ADCAM_REDIS_URL:-redis://localhost:6379/0}"
redis_up() { .venv/bin/python - "$REDIS_URL" <<'PY'
import sys, redis
try:
    redis.Redis.from_url(sys.argv[1], socket_connect_timeout=1.5).ping()
except Exception:
    sys.exit(1)
PY
}

REDIS_PID=""
if ! redis_up; then
  if command -v redis-server >/dev/null; then
    say "Starting Redis"
    redis-server --port 6379 --save '' --appendonly no --daemonize no >/dev/null 2>&1 &
    REDIS_PID=$!
    for _ in $(seq 1 20); do redis_up && break; sleep 0.25; done
  fi
fi

if redis_up; then
  export ADCAM_INLINE_WORKER=false
  MODE="Celery worker + Redis"
else
  # No Redis available: fall back to in-process rendering so the app still runs.
  export ADCAM_INLINE_WORKER=true
  MODE="inline worker (no Redis found - fine for a test drive, not production)"
  warn "Redis is not reachable at $REDIS_URL; using the inline worker."
fi

# --- frontend build --------------------------------------------------------
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:$API_PORT}"

PIDS=()
cleanup() {
  printf '\n'
  say "Shutting down"
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  [ -n "$REDIS_PID" ] && kill "$REDIS_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- launch ----------------------------------------------------------------
say "Starting the API on :$API_PORT"
( cd backend && exec ../.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" ) &
PIDS+=($!)

if [ "$ADCAM_INLINE_WORKER" = "false" ]; then
  say "Starting the render worker"
  ( cd backend && exec ../.venv/bin/celery -A app.celery_app.celery_app worker \
      -Q mutations -c 2 --loglevel=warning ) &
  PIDS+=($!)
fi

say "Starting the web UI on :$WEB_PORT"
( cd frontend && exec npx next dev -p "$WEB_PORT" ) &
PIDS+=($!)

# Wait for the UI to answer before printing the banner.
for _ in $(seq 1 60); do
  if curl -fsS -m 2 "http://localhost:$WEB_PORT/" >/dev/null 2>&1; then break; fi
  sleep 1
done

cat <<BANNER

  ${BOLD}AdCamouflage is up${OFF}

    Web UI     ${CYAN}http://localhost:$WEB_PORT${OFF}
    API docs   ${CYAN}http://localhost:$API_PORT/api/docs${OFF}
    Engine     $MODE
    Storage    ${DIM}$ADCAM_STORAGE_ROOT${OFF}

  ${DIM}Ctrl-C stops everything.${OFF}

BANNER

wait
