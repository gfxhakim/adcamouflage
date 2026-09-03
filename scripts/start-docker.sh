#!/usr/bin/env bash
# Start the whole stack with Docker Compose, generating the signing key on the
# first run so `docker compose up` never fails on a missing secret.
#
#   ./scripts/start-docker.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CYAN=$'\033[36m'; BOLD=$'\033[1m'; RED=$'\033[31m'; OFF=$'\033[0m'
say() { printf '%s==>%s %s\n' "$CYAN$BOLD" "$OFF" "$*"; }

command -v docker >/dev/null || {
  printf '%serror%s Docker is required. Install Docker Desktop, or use ./scripts/start.sh instead.\n' "$RED" "$OFF" >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  printf '%serror%s The Docker Compose plugin is required (docker compose version).\n' "$RED" "$OFF" >&2
  exit 1
}

if [ ! -f .env ]; then
  say "Creating .env with a generated signing key"
  cp .env.example .env
fi

# Compose refuses to start without a real signing key, so replace the placeholder.
if grep -qE '^ADCAM_SECRET_KEY=(change-me-in-production)?$' .env; then
  say "Generating ADCAM_SECRET_KEY"
  KEY="$(docker run --rm python:3.11-slim python -c 'import secrets; print(secrets.token_urlsafe(48))')"
  if [ "$(uname)" = "Darwin" ]; then
    sed -i '' "s|^ADCAM_SECRET_KEY=.*|ADCAM_SECRET_KEY=$KEY|" .env
  else
    sed -i "s|^ADCAM_SECRET_KEY=.*|ADCAM_SECRET_KEY=$KEY|" .env
  fi
fi

say "Building and starting the stack (first build takes a few minutes)"
docker compose up --build -d

say "Waiting for the API to report healthy"
for _ in $(seq 1 90); do
  if curl -fsS -m 2 http://localhost:8000/api/v1/health >/dev/null 2>&1; then break; fi
  sleep 2
done

cat <<BANNER

  ${BOLD}AdCamouflage is up${OFF}

    Web UI     ${CYAN}http://localhost:3000${OFF}
    API docs   ${CYAN}http://localhost:8000/api/docs${OFF}

  More capacity:  docker compose up -d --scale worker=4
  Logs:           docker compose logs -f
  Stop:           docker compose down

BANNER
