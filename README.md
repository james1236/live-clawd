# Live Clawd

A pixel mascot who acts out what Claude Code is doing, right on the localhost dev page you
have open. When Claude edits your UI he walks to the element and paints it, vacuums it up,
rubs it out or rebuilds it as the change lands; he runs your tests, hammers away at builds,
forks baby helpers for subagents, drinks water, sulks when the page breaks, and waves when
Claude needs you.

Two pieces, nothing else to install:

1. **The Claude Code plugin** (hooks + the `clawd` tool):

   ```
   /plugin marketplace add james1236/live-clawd
   /plugin install clawd@live-clawd
   ```

2. **The browser extension** for Firefox or Chrome (from the store, or build it: `./dev.sh`,
   then load `extension/dist/firefox` in `about:debugging` or `extension/dist/chrome` as an
   unpacked extension).

Then open your project's dev server (`http://localhost:<port>`) and start a Claude Code
session in that project. Clawd shows up on the page while Claude works.

## How it works

The plugin's hooks and its `clawd` MCP server talk to a small bridge on `127.0.0.1:47215`
(run by your Claude sessions themselves); the extension connects to it. It finds which tab
to use by matching the dev servers running from your project's directory to the localhost
tabs you have open, so it works under WSL too. Projects whose dev server it can't spot
(Docker, another directory) can be listed in `~/.config/live-clawd/config.json`:

```json
{ "projects": { "~/my-app": ["http://localhost:3000"] }, "ignore": ["~/scratch"] }
```

Only extension pages can connect to the bridge and only local programs can post to it, so
websites you visit can't watch your sessions. The extension's only standing permission is
your localhost pages; the optional "before-pictures" permission (capturing the visible tab)
lets him keep a change hidden until he reveals it.

Turn it off for one session with `CLAWD_LIVE=0`, for a site from the extension's popup, or
everywhere with its switch (or keyboard shortcut).
