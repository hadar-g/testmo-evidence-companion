#!/usr/bin/env bash
# Builds dist/testmo-evidence-companion-<version>.zip, the file you upload to the
# Chrome Web Store or hand to a colleague for "Load unpacked".
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
mkdir -p dist
OUT="dist/testmo-evidence-companion-${VERSION}.zip"
rm -f "$OUT"
zip -r "$OUT" manifest.json background.js sidepanel annotate lib recorder icons -x '*.DS_Store' 'icons/src/*' >/dev/null
echo "Built $OUT"
