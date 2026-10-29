#!/bin/sh
# One-step install of Kathara GUI on macOS and Linux (NOTES/MYNOTES.md note 5, F45).
#
# Builds the interface, then installs the kathara-gui command with uv. Run it
# again after a git pull to update. It never installs system software: a
# missing prerequisite is named, with where to get it.
set -e
cd "$(dirname "$0")"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed. It provides Python and installs the application."
  echo "Get it with:  curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "or see https://docs.astral.sh/uv/getting-started/installation/"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed. It is needed once, to build the interface."
  echo "Get it from https://nodejs.org/ or your package manager."
  exit 1
fi

echo "[1/4] Fetching the tools that build the interface (npm ci)..."
npm --prefix frontend ci

echo "[2/4] Building the interface..."
npm --prefix frontend run build

echo "[3/4] Installing the kathara-gui command..."
# Rebuilt every time, so a later git pull reaches the installed copy.
uv tool install --reinstall-package kathara-gui .

echo "[4/4] Checking the installed command..."
# By its full path, so an old copy earlier on PATH cannot answer instead.
"$(uv tool dir --bin)/kathara-gui" --check

# Puts uv's command folder on PATH if it is not there yet; nothing otherwise.
uv tool update-shell >/dev/null 2>&1 || true

echo
echo "Installed. Docker must be running to deploy labs."
echo "If \"kathara-gui\" is not found, open a new terminal first. Then run:"
echo "  kathara-gui"
echo "Labs go to a kathara-labs folder in the folder you start it from."
echo "\"kathara-gui --help\" lists the options."
