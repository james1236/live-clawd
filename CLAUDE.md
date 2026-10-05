# CLAUDE.md

## Recording and replaying Live Clawd sessions

A replay plays back a recorded Claude Code session against Live Clawd with no Claude usage,
so overlay/bridge changes can be tried on the same real session again and again. Recordings
live in `replays/<name>/`, which is gitignored: **never commit a recording.**

**Record** (needs Node ≥ 20; tmux shells here may default to 18, so give the full path):

```sh
tmux new-window -d -n '󱙺 !rec' "cd ~/clawdify && ~/.nvm/versions/node/v24.21.0/bin/node bridge/clawd-record.mjs --project <dev project> --out replays/<name>; exec zsh -i"
# ...the session works on <dev project> (a git repo with a running dev server)...
tmux send-keys -t '󱙺 !rec' C-c   # stops it and copies the session transcript in
```

The recorded project must be at a commit with its source files clean when recording starts,
so that a replay can reset to that state.

**Replay** (into the visible localhost tab of that project's dev server):

```sh
node bridge/clawd-replay.mjs replays/<name> --dry-run                                   # print the timeline
node bridge/clawd-replay.mjs replays/<name> --max-gap 1.5 --max-tool 12 --long-tool 22 --long-gap 25 --duration 220
```

That squeezes the session to 3:40 but keeps the overlay's slow animations reachable: long
tools and subagent trips last 22s (Clawd sits with a book or knitting at 20s - a coin flip
in the overlay), the two longest mid-turn pauses 25s (chalkboard, water break and bottle
toss), a compaction 8s.

- By default only the hook events `~/.claude/settings.json` runs `live-hook.sh` for are sent,
  as in a live session; `--hooks all` sends every one the replay can rebuild.
- **Reload the extension between two replays of the same recording.** The bridge remembers
  each file's last content and would diff against the previous run's end state.
- A replay rewrites the project's files to each recorded version; it ends at the recording's
  end state (`--restore` puts the base back).

**Keep the replay in step with the live path.** `clawd-replay.mjs`'s `buildTimeline()`
rebuilds each hook event in the shape `host.js`'s `relayLive()` reads: `agent_id`/`agent_type`
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
