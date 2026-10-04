#!/usr/bin/env bash
# Capture the NAZAR pages headlessly at 1280x720 for the explainer video.
# Each frame is a fresh Chrome run; a longer virtual-time budget means the page
# has propagated further, so a pair of frames gives real motion.
set -u
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT="$TEMP/shots"
BASE="http://127.0.0.1:8099"
mkdir -p "$OUT"

shot () {           # shot <name> <url-path> <virtual-time-ms>
  local name="$1" path="$2" budget="$3"
  local file="$OUT/$name.png"
  [ -s "$file" ] && { echo "skip  $name"; return; }
  timeout 300 "$CHROME" --headless=new --no-sandbox --disable-dev-shm-usage \
    --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
    --window-size=1280,720 --virtual-time-budget="$budget" \
    --screenshot="$(cygpath -w "$file")" "$BASE/$path" >/dev/null 2>&1
  if [ -s "$file" ]; then echo "ok    $name  $(stat -c%s "$file") bytes"; else echo "FAIL  $name"; fi
}

shot main-a   "index.html"         28000
shot main-b   "index.html"         40000
shot god-a    "viz3d.html"         40000
shot god-b    "viz3d.html"         52000
shot ops-a    "sats-by-ops.html"   40000
shot ops-b    "sats-by-ops.html"   52000
shot twod-a   "2d-views.html"      40000
shot twod-b   "2d-views.html"      52000
shot debris-a "debris.html"        45000
shot debris-b "debris.html"        57000
shot stats-a  "sat-stats.html"     26000
echo "ALL DONE"
