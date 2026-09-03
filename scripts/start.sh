#!/usr/bin/env bash
# Launch AdCamouflage on macOS or Linux.
#
#   ./scripts/start.sh
#
# All the real work lives in start.py so Windows, macOS and Linux run the same
# tested code path.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for candidate in python3.13 python3.12 python3.11 python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    exec "$candidate" "$DIR/start.py" "$@"
  fi
done

printf '\n  error: Python 3.11+ was not found on PATH.\n\n' >&2
printf '  macOS:  brew install python@3.12\n' >&2
printf '  Linux:  sudo apt-get install python3 python3-venv\n\n' >&2
exit 1
