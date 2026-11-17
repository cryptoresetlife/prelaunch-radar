#!/usr/bin/env bash
# Renders the three screenshots from the built page with headless Chrome. Usage, from the repository root:
#   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json> && tools/shoot.sh out
# Each view is a link (radar.js readHash), so a screenshot is the real page at that link, nothing staged.
set -euo pipefail
OUT="${1:-out}"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
PAGE="file:///$(cd "$OUT/dashboard" && pwd -W 2>/dev/null || pwd)/index.html"
shoot() { # name, hash, height
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="1440,${3:-1180}" \
    --virtual-time-budget=3000 --screenshot="$(pwd -W 2>/dev/null || pwd)/screenshots/$1" "$PAGE$2" >/dev/null 2>&1
  echo "screenshots/$1 $(wc -c < "screenshots/$1") bytes"
}
mkdir -p screenshots
shoot 1-board.png ""
shoot 2-detail.png "#p=${DETAIL:-hyperithm}" 1084
shoot 3-filtered.png "#cls=early&verdict=Farm&sort=perK&dir=desc"
