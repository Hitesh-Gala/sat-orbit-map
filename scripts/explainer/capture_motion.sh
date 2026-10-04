#!/usr/bin/env bash
set -u
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT="$TEMP/shots"; BASE="http://127.0.0.1:8099"
shot () {
  local file="$OUT/$1.png"
  [ -s "$file" ] && { echo "skip $1"; return; }
  timeout 300 "$CHROME" --headless=new --no-sandbox --disable-dev-shm-usage \
    --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
    --window-size=1280,720 --virtual-time-budget="$3" \
    --screenshot="$(cygpath -w "$file")" "$BASE/$2" >/dev/null 2>&1
  [ -s "$file" ] && echo "ok $1" || echo "FAIL $1"
}
# God Mode drifting: one frame every ~4 simulated minutes
for i in 0 1 2 3 4 5 6 7; do shot "godm-$i" "viz3d.html" $((54000 + i*9000)); done
# Debris cloud drifting
for i in 0 1 2 3; do shot "debm-$i" "debris.html" $((50000 + i*9000)); done
echo "MOTION DONE"
