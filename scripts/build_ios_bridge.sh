#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The physical iOS bridge is built only on macOS."
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV="$ROOT/.build/ios-bridge-venv"
OUT="$ROOT/build/bin"
WORK="$ROOT/.build/ios-bridge-work"

"$PYTHON_BIN" -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$ROOT/scripts/ios_bridge_requirements.txt"

rm -rf "$WORK"
mkdir -p "$OUT"

"$VENV/bin/pyinstaller" \
  --clean \
  --noconfirm \
  --distpath "$OUT" \
  --workpath "$WORK" \
  "$ROOT/scripts/ios_bridge.spec"

chmod +x "$OUT/ios-device-bridge"
"$OUT/ios-device-bridge" --help >/dev/null

echo "Built $OUT/ios-device-bridge"
