#!/bin/sh
# Claude Code hook for Live Clawd (installed by bridge/install-hooks.mjs as an async hook).
#
# Spools the hook's JSON for the Clawdify bridge, which animates Clawd on any open tab
# of the project's local dev server. Purely cosmetic: prints nothing, never blocks,
# always exits 0, and does nothing at all unless Firefox is listening (the bridge
# touches ~/.claudemonkey/live/alive every 5s while it is).
#
# Turn it off for a session with CLAWDIFY_LIVE=0.

[ "${CLAWDIFY_LIVE:-1}" = 0 ] && exit 0
dir="$HOME/.claudemonkey/live"
[ -n "$(find "$dir/alive" -newermt '20 seconds ago' 2>/dev/null)" ] || exit 0
spool="$dir/spool"
mkdir -p "$spool" 2>/dev/null || exit 0
f="$spool/$(date +%s%N)-$$.json"
# Cap the size (a big Write carries the whole file); the bridge drops what won't parse.
head -c 262144 > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f" 2>/dev/null
rm -f "$f.tmp" 2>/dev/null
exit 0
