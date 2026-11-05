#!/usr/bin/env bash
# One-command launch for macOS and Linux. Safe to run repeatedly: finished steps are skipped.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
backend="$root/backend"
frontend="$root/frontend"
python="$backend/.venv/bin/python"

if [ ! -x "$python" ]; then
  echo "Creating the Python environment..."
  python3 -m venv "$backend/.venv"
fi

stamp="$backend/.venv/.requirements-installed"
if [ ! -f "$stamp" ] || [ "$backend/requirements.txt" -nt "$stamp" ]; then
  echo "Installing Python packages. The first time takes a few minutes..."
  "$python" -m pip install --quiet --disable-pip-version-check -r "$backend/requirements.txt"
  touch "$stamp"
fi

if [ ! -d "$frontend/node_modules" ]; then
  echo "Installing interface packages..."
  npm --prefix "$frontend" ci
fi

if [ ! -f "$frontend/dist/index.html" ]; then
  echo "Building the interface..."
  npm --prefix "$frontend" run build
fi

echo
echo "QANTUM is starting at http://127.0.0.1:8000"
echo "Press Ctrl+C to stop."
cd "$backend"
exec "$python" -m qantum
