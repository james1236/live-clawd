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
node bridge/clawd-replay.mjs replays/<name> --max-gap 1.5 --max-tool 12 --duration 120  # ~2 minutes
```

- `--hooks all` also sends hook events the live hooks don't send yet (SubagentStart/Stop,
  PreCompact, BackgroundTaskStop); the default sends only the installed ones.
- **Reload the extension between two replays of the same recording.** The bridge remembers
  each file's last content and would diff against the previous run's end state.
- A replay rewrites the project's files to each recorded version; it ends at the recording's
  end state (`--restore` puts the base back).

Both scripts' header comments have the details.
