#!/usr/bin/env bash
#
# Local helper (not upstream): pull upstream ClaudeMonkey, rebuild, AMO-sign (unlisted)
# and drop the signed XPI into the Windows folder Firefox installs from.
#
#   ./update.sh            # merge origin/main, then build + sign
#   ./update.sh --no-pull  # just rebuild + sign the current checkout
#
# Needs AMO API keys in ~/.config/amo.env (AMO_JWT_ISSUER / AMO_JWT_SECRET).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WIN_DIR=/mnt/c/Users/James/claudemonkey
cd "$DIR"

# Node 24 from nvm (the repo requires >= 24; the nvm default may be older).
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1
NODE_BIN="$(nvm which 24)"
export PATH="$(dirname "$NODE_BIN"):$PATH"

if [ "${1:-}" != "--no-pull" ]; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "ERROR: uncommitted changes; commit or stash them first." >&2
    exit 1
  fi
  git fetch origin
  git merge --no-edit origin/main
fi

# The gecko id must stay ours: AMO rejects claudemonkey@local (owned by another account).
grep -q "claudemonkey@james.local" src/manifest.yml || {
  echo "ERROR: extension id in src/manifest.yml is no longer claudemonkey@james.local." >&2
  exit 1
}

pnpm install --frozen-lockfile

# AMO rejects a version it has already signed, so append minutes-since-epoch as a 4th
# component: always increasing, and still sorts below the next upstream release.
BASE_VERSION="$(node -p "require('./scripts/version-helper').getVersion()")"
export VERSION="$BASE_VERSION.$(( $(date +%s) / 60 ))"
echo "Building version $VERSION"
pnpm build

# Re-register the bridge in case host.js or the node path changed (idempotent).
CLAUDEMONKEY_NODE_BIN="$NODE_BIN" bash bridge/install.sh

set -a
# shellcheck disable=SC1091
. "$HOME/.config/amo.env"
set +a
npx -y web-ext@latest sign --source-dir=dist --channel=unlisted \
  --artifacts-dir=web-ext-artifacts \
  --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET"

XPI="$(ls -t web-ext-artifacts/*.xpi | head -1)"
OUT="$WIN_DIR/claudemonkey-$VERSION-signed.xpi"
cp "$XPI" "$OUT"
echo
echo "Signed XPI: $OUT"
echo "Install it over the top: drag it into Firefox (about:addons keeps your scripts)."
(cd /mnt/c && explorer.exe "$(wslpath -w "$WIN_DIR")") || true
