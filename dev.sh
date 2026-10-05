#!/bin/sh
# Build the extension (extension/dist/firefox and extension/dist/chrome). Under WSL, also
# copy the Firefox build to Windows, to load as a temporary add-on in about:debugging:
#   C:\Users\<you>\live-clawd\firefox  (override with LIVE_CLAWD_WIN_DIR=/mnt/c/...)
set -e
cd "$(dirname "$0")/extension"
command -v node >/dev/null || { echo "Needs Node (18+) on the PATH"; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund
node build.mjs
if [ -d /mnt/c/Users ]; then
  WIN_USER=$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r')
  DEST="${LIVE_CLAWD_WIN_DIR:-/mnt/c/Users/$WIN_USER/live-clawd/firefox}"
  mkdir -p "$DEST"
  rm -rf "${DEST:?}"/*
  cp -r dist/firefox/. "$DEST/"
  echo "Copied to $DEST - load or Reload it in about:debugging."
fi
