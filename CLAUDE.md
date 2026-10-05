# CLAUDE.md

Live Clawd: a pixel mascot that acts out what Claude Code sessions are doing, on their
localhost dev page in the browser. Three parts:

- `plugin/` — the Claude Code plugin (listed by `.claude-plugin/marketplace.json` at the repo
  root). `hooks/hooks.json` runs `server/hook.mjs` (async) on every hook event; `.mcp.json`
  starts `server/clawd.mjs`, the MCP server with the `clawd` tool and its instructions (sent
  at initialize, so nothing goes into anyone's CLAUDE.md). Each session's MCP server also
  runs the bridge (`server/bridge.mjs`): whichever gets 127.0.0.1:47215 first serves it,
  the rest (and the hooks) post events to it, and another takes over within 3s if it goes.
  `server/relay.mjs` turns events into what the extension needs (project, dev-server ports,
  on-disk diff, narration, failures); `server/ws.mjs` is a dependency-free WebSocket server.
- `extension/` — the browser extension, one source for Firefox (MV2, persistent background)
  and Chrome (MV3 service worker, offscreen page for sounds, `probe.js` in the page's world
  to find React components). `src/background.js` connects to the bridge and drives
  `src/overlay.js` (Clawd himself) in the visible localhost tab.
- `tools/` — record a real session and replay it with no Claude usage (below).

No pairing: the bridge only accepts WebSockets from extension origins (pages can't fake
Origin) and event posts with `X-Clawd: 1` and no Origin (pages can't send those without a
CORS preflight it never answers). Keep both checks.

**Build:** `./dev.sh` builds `extension/dist/{firefox,chrome}` with esbuild and, under WSL,
copies the Firefox build to `C:\Users\<you>\live-clawd\firefox` (load it in about:debugging).
Plugin changes: `/reload-plugins` in a Claude session, or start a new one; the bridge
restarts with whichever session serves it.

The userscript-generating extension this grew out of (a Violentmonkey fork with a native
messaging bridge) is gone from the tree; it's kept at the `archive/clawdify-userscripts` tag.

## Recording and replaying Live Clawd sessions

A replay plays back a recorded Claude Code session against Live Clawd with no Claude usage,
so overlay/bridge changes can be tried on the same real session again and again. Recordings
live in `replays/<name>/`, which is gitignored: **never commit a recording.**

**Record** (needs Node ≥ 20; tmux shells here may default to 18, so give the full path):

```sh
tmux new-window -d -n '󱙺 !rec' "cd ~/clawdify && ~/.nvm/versions/node/v24.21.0/bin/node tools/clawd-record.mjs --project <dev project> --out replays/<name>; exec zsh -i"
# ...the session works on <dev project> (a git repo with a running dev server)...
tmux send-keys -t '󱙺 !rec' C-c   # stops it and copies the session transcript in
```

The recorded project must be at a commit with its source files clean when recording starts,
so that a replay can reset to that state.

**Replay** (into the visible localhost tab of that project's dev server):

```sh
node tools/clawd-replay.mjs replays/<name> --dry-run                                   # print the timeline
node tools/clawd-replay.mjs replays/<name> --max-gap 1.5 --max-tool 12 --long-tool 22 --long-gap 25 --duration 220
```

That squeezes the session to 3:40 but keeps the overlay's slow animations reachable: long
tools and subagent trips last 22s (Clawd sits with a book or knitting at 20s - a coin flip
in the overlay), the two longest mid-turn pauses 25s (chalkboard, water break and bottle
toss), a compaction 8s.

- By default only the hook events `plugin/hooks/hooks.json` lists are sent, as in a live
  session; `--hooks all` sends every one the replay can rebuild.
- The replay posts to the bridge; with no Claude session running it serves the bridge
  itself. **Between two replays of the same recording, restart whatever serves the bridge**
  (it remembers each file's last content and would diff against the previous run's end
  state): with no session running that happens by itself.
- A replay rewrites the project's files to each recorded version; it ends at the recording's
  end state (`--restore` puts the base back).

**Keep the replay in step with the live path.** `clawd-replay.mjs`'s `buildTimeline()`
rebuilds each hook event in the shape `plugin/server/relay.mjs`'s `relay()` reads: `agent_id`/`agent_type`
pairing SubagentStart with SubagentStop, `PostToolUseFailure` with `error` for a failed tool,
`tool_input.run_in_background` for the background timer, `tool_use_id` for holding an action
until its tool ends. When the hooks or the bridge start reading a new field or event, add it
there too, or replays silently stop exercising it (that is how the first replays showed no
subagent helper). A Claude session's own cwd may not be the recorded project; the replay
always reports `--project`'s path as cwd.

**Recorder traps** (both cost a recording once):
- Never `fs.watch(project, {recursive: true})` on a project root: on Linux Node walks every
  directory in JS, and an `npm install` into `node_modules` pegged it at ~90% CPU with no
  events and SIGINT ignored. The recorder watches top-level source directories instead.
- If the watcher missed edits anyway, `clawd-record.mjs --rebuild --out replays/<name>`
  recovers every version by re-running the transcript's edit commands on a scratch clone,
  and refuses unless the result matches the project exactly. It only sees Bash
  `sed -i`/python-heredoc/`git checkout <file>` edits, not the Edit/Write tools.

Both scripts' header comments have the details.
