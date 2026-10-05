# ClaudeMonkey setup & testing

ClaudeMonkey = Violentmonkey's full userscript engine + an AI textbox. You describe a
change to the current site; a local **Claude Code** process writes/edits the userscript,
streaming progress into the Firefox sidebar. It uses your Claude **subscription** (the
bridge strips `ANTHROPIC_API_KEY` so `claude -p` never falls back to a metered API key).

> This checkout's `local` branch is **Clawdify** — see [Clawdify (this fork)](#clawdify-this-fork)
> at the end for what it adds and how it's set up (Windows Firefox + WSL bridge, Live Clawd).

## One-time setup

```bash
pnpm i            # install deps (Node >= 24)
pnpm build        # or `pnpm dev` for a watch build -> dist/
bash bridge/install.sh   # registers the native-messaging host with Firefox
```

`bridge/install.sh` resolves your `claude` binary into `bridge/config.json` and writes
`~/.mozilla/native-messaging-hosts/claudemonkey.bridge.json` (allowlisted to the extension
id `claudemonkey@local`). On macOS the manifest goes to
`~/Library/Application Support/Mozilla/NativeMessagingHosts/` instead. It needs `node` on
PATH (host.js is a Node script) and generates `bridge/host-launcher.sh`, which execs that
exact node against `host.js`; the manifest points at the launcher. This is deliberate:
`#!/usr/bin/env node` resolves against the PATH of whoever launched Firefox, and a
GUI-launched Firefox has a minimal one (`/usr/bin:/bin:/usr/sbin:/sbin` on macOS) with no
Homebrew/nvm/nix node in it — the host would die at startup with exit 127. Both the
launcher and the manifest hard-code absolute paths, so **re-run the installer if you move
the checkout or change node** — relevant with nvm, whose node path contains its version.
If `node` is a shell function, alias or shim the installer can't resolve, point it at the
real binary with `CLAUDEMONKEY_NODE_BIN=/path/to/node bash bridge/install.sh`.

### Using a specific Claude account profile

Shell aliases that run `claude` with a custom `CLAUDE_CONFIG_DIR` aren't visible to the
native-messaging host, since Firefox launches it via `spawn`, not a shell. To run
generations under a specific account profile, set `claudeConfigDir` in
`bridge/config.json` (host.js exports it as `CLAUDE_CONFIG_DIR` for the `claude` process):

```json
{
  "claudeBin": "/home/you/.local/bin/claude",
  "claudeConfigDir": "/home/you/.claude-accounts/work/.claude"
}
```

`bridge/install.sh` picks this up automatically if `CLAUDEMONKEY_CLAUDE_CONFIG_DIR`
(or your current `CLAUDE_CONFIG_DIR`) is set when you run it. You can also override at
runtime with the `CLAUDEMONKEY_CLAUDE_CONFIG_DIR` env var.

### `claude` is logged in in my terminal but says "Not logged in" here

Firefox launches the native host from the GUI session, so **nothing your shell profile
sets is present** — no aliases, no exported variables. If your credential lives in an
environment variable (e.g. `CLAUDE_CODE_OAUTH_TOKEN`), `claude` is authenticated when you
run it yourself and unauthenticated when the bridge runs it.

`bridge/install.sh` captures `CLAUDE_CODE_OAUTH_TOKEN` from the environment you run it in
and records it under `env` in `bridge/config.json`; host.js merges that into the
environment of the `claude` process. To forward other variables:

```bash
CLAUDEMONKEY_ENV_PASSTHROUGH="CLAUDE_CODE_OAUTH_TOKEN,HTTPS_PROXY" bash bridge/install.sh
```

Note that captured values are stored **in plaintext** in `bridge/config.json`. The
installer creates it with mode 600 and it is gitignored, but it lives in the checkout —
so if your checkout is inside a synced folder (Dropbox, iCloud Drive, …), the credential
syncs along with it. Keep such checkouts out of shared sync folders, or don't pass
tokens through and rely on `claude login` instead.

They must be **exported** to be visible to the script. `ANTHROPIC_API_KEY` is never
forwarded, even if you list it: host.js strips it after applying `env`, so generations
always bill against the subscription. To reproduce what the bridge sees, strip your
environment the same way Firefox does:

```bash
env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  "$(command -v claude)" -p 'Reply with the single word OK' < /dev/null
```

### Reading a failed run

Each run narrates where it got to, so a failure tells you which layer broke:

| Last line you see | What it means |
|---|---|
| nothing at all | the job never started — the error is in the popup, not the sidebar |
| `Capturing <domain>…` | DOM/asset/screenshot capture is stuck or threw |
| (no `Bridge ready`) | the native host isn't answering a ping — host not launching, wrong path in the manifest, or node missing from Firefox's PATH |
| `Bridge ready — claude: …` | the host is alive; the path and profile shown are what it will actually use |
| `Sending ~N MB of page context…` | request handed to the host; if nothing follows, the host isn't processing messages (watch that N — a huge page makes a huge message) |
| `claude produced no output for …` | the host is fine and `claude` itself is wedged |

To check the host by hand, without Firefox:

```bash
node bridge/test-client.js "hide all images" example.com https://example.com/
```

### When `claude` gets stuck

If the `claude` process emits nothing for 300s, host.js kills it and reports the stall
(with any stderr) instead of leaving the sidebar spinning forever. Tune or disable it
with `stallTimeoutMs` in `bridge/config.json` (0 disables), or `CLAUDEMONKEY_STALL_MS`
at runtime. Long generations are unaffected — any output resets the timer.

## Load the extension in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → pick `dist/manifest.json`.
   (The fixed gecko id `claudemonkey@local` must match the native-host allowlist. Packing
   `dist/` preserves that id — see below — but don't hand-edit it.)

Temporary add-ons are dropped when Firefox quits.

## Installing it permanently

```bash
pnpm run xpi     # build + package -> dist-assets/claudemonkey.xpi
```

Release and Beta Firefox refuse unsigned extensions unconditionally — no pref or policy
changes that. Two ways round it:

**Unsigned, in a build that allows it.** Developer Edition and Nightly honor
`xpinstall.signatures.required` (so does ESR). Set it to `false` in `about:config`, then
`about:addons` → gear → **Install Add-on From File…** → `dist-assets/claudemonkey.xpi`.
Note these use a separate profile, so existing userscripts don't come along — export them
from the dashboard first. Remove the temporary add-on before installing, or two copies of
`claudemonkey@local` will collide.

**Signed by AMO, for Release Firefox.** Unlisted signing is automated review only and is
never published to the gallery:

```bash
npx web-ext sign --source-dir=dist --channel=unlisted \
  --api-key=<jwt-issuer> --api-secret=<jwt-secret>   # credentials from addons.mozilla.org
```

AMO rejects a version it has already seen, so `pnpm bumpVersion` before each signed build.

Either way the id stays `claudemonkey@local`, so the native-messaging host keeps working
and `bridge/install.sh` does not need re-running. After a code change, re-run
`pnpm run xpi` and reinstall the file over the top.

## End-to-end test

1. Open a normal site (e.g. `https://example.com`).
2. Click the ClaudeMonkey toolbar button → a textbox appears. Type e.g.
   *"add a fixed red banner at the top that says ClaudeMonkey works"* → **Ask Claude**.
3. The **sidebar** opens and streams a transcript: your request, ⚙ tool chips
   (Grep/Read DOM, Read/Edit `userscript.user.js`, Ran `curl …`), and Claude's narration.
   Watch the working dir `~/.claudemonkey/sites/example.com/` (see [Files & logs](#files--logs)).
4. **Verify loop:** after the first draft, ClaudeMonkey installs the script, **reloads the
   tab so it actually runs**, captures any console errors and a fresh DOM snapshot, and
   resumes the same Claude session with that feedback so it can confirm the change worked
   or fix it — up to 3 rounds (so the tab may reload a few times). When it converges the
   final, verified userscript is shown and left installed (a Violentmonkey script named
   `ClaudeMonkey - example.com`); **Apply & reload** re-applies it if you want.
5. **Refine:** type a follow-up in the sidebar (*"make it blue"*) → it edits the same
   script in the same Claude session.
6. **Subscription check:** generation should succeed with no `ANTHROPIC_API_KEY` set and
   not consume API credits (the `init` event reports `apiKeySource: "none"`).
7. The normal Violentmonkey dashboard/editor is still available via **Manage scripts** in
   the popup (the options page).

## CLI smoke test (no browser)

Exercises the whole bridge → claude → userscript path without Firefox:

```bash
node bridge/test-client.js "hide all images" example.com https://example.com/
```

## Files & logs

Everything ClaudeMonkey writes lives under `~/.claudemonkey/`:

```
~/.claudemonkey/
├─ sites/<domain>/          per-site working dir (the cwd of the claude process)
│  ├─ userscript.user.js    THE script Claude edits; overwritten each pass
│  ├─ page-context.md       generated notes: what each file is + how to use it
│  ├─ page-dom.html         DOM snapshot, styles stripped (default view)
│  ├─ page-dom-styled.html  DOM keeping <style>/<link> so existing CSS is visible
│  ├─ page-screenshot.png   PNG of the visible viewport (refreshed post-run)
│  └─ assets/               the page's fetched external CSS/JS (+ manifest in page-context.md)
└─ logs/
   ├─ feedback.md           Claude appends friction notes here (missing context, etc.)
   └─ runs/<domain>/*.md    distilled per-pass log: prompt, transcript, result, cost, final script
```

- The per-site files are **overwritten each pass** — they always reflect the latest
  state, not history. Script/run history lives in `logs/runs/` instead.
- The DOM snapshots and assets are capped (≤24 assets, ≤512 KB each, ≤4 MB total; ~2 MB
  per DOM file). Tune in `src/background/utils/ai.js`. Claude reads short files whole and
  greps large ones; the screenshot costs vision tokens so it's only read on demand.
- **`logs/` is the only extra directory exposed to the `claude` process** (`--add-dir`),
  so it can append to `feedback.md` without reaching into other sites' working dirs.
  Run logs in `logs/runs/` are written by the bridge, not Claude.
- Both logs **accumulate unbounded** — prune them yourself if they grow large.

## Notes / limits

- Firefox-only for now: the live view uses `sidebar_action` (Chrome uses `sidePanel`).
- The page context and your prompt are sent only to your local Claude Code instance. The
  exceptions: Claude may run **`curl`** (the one allowed shell command) to fetch external
  resources it needs (docs, a CDN URL, a resource not already in `assets/`), so those
  requests go out to wherever Claude points them.
- One generation runs at a time; the per-site working dir + Claude session id give
  conversational refinement and survive background restarts.
- The verify loop reloads the **active tab** up to 3 times per request and installs the
  in-progress (possibly broken) script as it converges. Console-error capture is
  best-effort: uncaught errors and unhandled rejections from `@grant none` userscripts are
  caught via a `document_start` collector; the refreshed DOM snapshot is the primary signal
  Claude uses to confirm the change is actually present. Tune rounds via `MAX_VERIFY_ROUNDS`
  in `src/background/utils/ai.js`.

---

## Clawdify (this fork)

Clawdify is ClaudeMonkey on the `local` branch with: a Claude-style UI and the pixel-art
**Clawd** mascot, per-site chats, **approval-gated browser tools** (act in the tab, save
files, recurring watches), and **Live Clawd**, which animates Clawd on your localhost dev
pages while *any* Claude Code session works on that project. Only display names changed:
the gecko id is `claudemonkey@james.local`, the native host is still `claudemonkey.bridge`,
userscripts are still named `ClaudeMonkey - <domain>`.

### Windows Firefox + WSL

Firefox runs on Windows; the bridge, `node` (v24 via nvm) and `claude` run in WSL (Ubuntu).
`bridge/install.sh` only handles Linux/macOS, so the Windows side is a hand-made shim in
`C:\Users\James\claudemonkey\`:

- `host.bat`: `wsl.exe -d Ubuntu --exec /home/james/clawdify/bridge/host-launcher.sh %*`
- `claudemonkey.bridge.json`: the native-messaging manifest pointing at `host.bat`, allowing
  `claudemonkey@james.local` (and the old `claudemonkey@local`)
- registry key `HKCU\Software\Mozilla\NativeMessagingHosts\claudemonkey.bridge` → that JSON

Native messaging through `wsl.exe` was verified byte-exact (length-prefixed ping/pong).
The first request after WSL has been idle can hit the extension's 8s ping timeout while the
VM boots; retry.

### Building and installing

`update.sh` (local helper):

| | |
|---|---|
| `./update.sh --dev` | build and copy `dist/` to `C:\Users\James\claudemonkey\dist` — **current workflow**: load `dist\manifest.json` via `about:debugging` → *Load Temporary Add-on*, then press *Reload* after each build (re-load after a Firefox restart) |
| `./update.sh --no-pull` | build + AMO **unlisted** signing → `clawdify-<version>.xpi` (installs permanently in Release Firefox) |
| `./update.sh` | merge `origin/main` first, then as above |

Signing needs `~/.config/amo.env` (`AMO_JWT_ISSUER`/`AMO_JWT_SECRET`) and takes ~2–3 min,
almost all of it AMO validation + its signing queue (occasional 503s are retried). Each
signed build gets a 4th version component (minutes since epoch) because AMO refuses a
version twice. `web-ext` is pinned at **10.7.0** (devDependency, exact). The id had to
change from `claudemonkey@local` because AMO answered *Forbidden* (owned by another account).

### Sidebar, popup, look

- The sidebar follows the active tab and shows **only that site's chat** (`AIGetState({domain})`
  returns the site's thread); *New chat* drops its Claude session (`AINewChat`). Chats live
  in memory and are lost when Firefox restarts.
- Warm light/dark palette shared by popup and sidebar (`src/common/cm-theme.js`), Clawd
  icon, dashboard grays warmed. Popup: chat context, per-site script on/off switch, Live
  Clawd switch + *Mute here* on localhost pages, sound effects switch.
- Clawd's progress notes render apart from Claude's narration (`note` events).

### Clawdify tools (browser-initiated requests)

The bridge's `claude -p` gets an MCP server (`bridge/mcp-browser.js`, per-request socket in
`~/.claudemonkey/run/`, `--strict-mcp-config`). Requests no longer have to become userscripts:

- **Tab tools** — `page_info`, `page_snapshot`, `page_eval`, `click`, `type`, `navigate`,
  `reload`, `wait_for`, `screenshot` — and **`watch_create`** each run **only after the user
  presses Approve** on a sidebar card (what, which page, Claude's reason, any code). Denials
  and timeouts (240s) go back to Claude as "don't retry". This is a hard user requirement;
  an ungated version was refused by the Claude Code permission classifier ("Create Unsafe
  Agents") and then rejected by the user too.
- Ungated (no tab access): `save_output` (→ `~/Clawdify/outputs/<site>/`, downloadable from
  the sidebar), `notify`, `watch_list`, `watch_delete`.
- Watches re-run the exact approved code on an interval in a background tab and notify on
  change; listed with *Stop* in the sidebar; paused after 5 failures.
- Only a pass that edited the userscript installs it and reloads the tab — otherwise the
  verify loop's reload would undo one-off actions.

Tested with real `claude` and a fake extension: approved `page_info` + `save_output` (CSV
correct, userscript untouched), and a denied call (respected, not retried). Not yet
exercised end-to-end in Firefox.

### Clawd, the mascot

- `src/common/clawd-art.js` — sprite as data (rendered to markup or DOM, Trusted-Types
  safe), ~25 moods each with props: palette+beret (colour), spray can (gradients), sponge
  (shadows/radius), "Aa" sign (fonts), pencil (text), eraser, vacuum (removal), hard hat +
  hammer (layout), tape measure (sizes), block (add), wrench + sparks (events), laptop +
  Matrix (network/logic), binoculars (observers), headphones (animation), camera (images),
  chest (storage), magnifier, water break (drinks, then throws the bottle at your cursor),
  wave sign (needs you; shows the tmux window `#N`), sad (rain cloud + tears). Eyes follow a
  nearby cursor; click to tickle; click a waving Clawd to dismiss him.
- `src/clawd-overlay/` — injected into the page; a closed shadow root on a click-through
  layer (only Clawd's body takes clicks), attached to `<html>`; hidden before every DOM
  snapshot/screenshot so Claude never sees him. Clawds walk on from the nearer edge and off
  again (portals and the portal gun were tried and removed at the user's request).
- Clawd lives only on the page; the sidebar has no mascot (its status line and chat show
  progress). Clawdify jobs drive him there: guessed actions from the job's tool calls, and
  the job's own `clawd` tool (in `bridge/mcp-browser.js`, ungated; the job prompt in
  `host.js` says when to call it). Its steps queue in `job.choreo` and play once the script
  is installed and the page reloaded, after the DOM and screenshot for Claude are taken;
  the final "make sure it's installed" reload is skipped when the last verify pass already
  applied that script, so it can't cut his act short.

### Live Clawd (Claude Code sessions in WSL → localhost tabs)

Purely cosmetic and local. Install/uninstall everything with
`node bridge/install-clawd.mjs [--remove]` (backups: `*.bak-clawdify`):

1. **Hooks** (`bridge/live-hook.sh`, async, via `install-hooks.mjs`): `UserPromptSubmit`,
   `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`. They exit at once
   unless Firefox is listening (`~/.claudemonkey/live/alive` touched every 5s by the bridge),
   then spool the hook JSON wrapped with the tmux window/pane. Zero Claude usage.
2. **`clawd` MCP tool** (`bridge/clawd-mcp.js`, user scope, allowed via `mcp__clawd`) plus a
   marked block in `~/.claude/CLAUDE.md`: Claude calls it **in the same message as a UI edit,
   before it**, with steps `{target: {component|selector|text|testid, x, y}, action, say,
   color, ms}`. Returns `off: <why>` when Firefox isn't listening, or (from the
   bridge's ack) when no dev server for the project is running; Claude then skips it for
   ~10 UI edits and retries, rather than giving up for the session. A tab that just isn't
   visible still returns `ok`. It waits ≤1.2s for the browser's ack (235ms measured with a simulated browser) so Clawd
   starts before hot reload. Measured in a real run on a copy of microEDA: batched with
   the edit, sensible targets/actions, never mentioned in reply/code; costs ~500 tokens of
   cached context per request, ~100 output tokens per UI edit, and **one `ToolSearch` turn
   per session** (Claude Code defers MCP tools; disabling that globally was rejected as it
   would load every connector everywhere).
3. **Bridge live mode** (`host.js`, `{type:'live-subscribe'}`): drains the spool (fs.watch +
   250ms poll), maps the session's git root to dev-server ports (`ss -ltnp` +
   `/proc/<pid>/cwd`, or `~/.claudemonkey/live.json` `{"projects": {...}, "ignore": [...]}`),
   adds Claude's latest narration from the transcript, and for `PostToolUse` diffs changed
   source files against what it last saw (`git status` + `HEAD`) — so it sees changes made
   via Bash/python/git, not just the Edit tool. Clawdify's own runs set `CLAWDIFY_LIVE=0`.
4. **Extension** (`src/background/utils/live.js`): routes to the visible localhost tab with a
   matching port; one Clawd per session (keyed by tmux pane), colour fixed per tmux window.
   Claude's choreography outranks hook-based guesses while it plays.
5. **Overlay playback**: a step queue — every step plays its full time (backlogs speed up,
   nothing is dropped). Targets resolve via selector/test id/text, or React components by
   walking the fiber tree (`wrappedJSObject` in Firefox), most specific first; x/y gives a
   point inside an element (canvas). **"Before" covers:** visible targets are snapshotted
   (`captureVisibleTab` crop, with a margin for changes that can grow) before the edit lands,
   covering the element while hot reload happens underneath; Clawd's action reveals the new
   version (paint wipe, rub-out, vacuumed into the nozzle, crossfade). Covers never last
   over 8s; most-of-page targets aren't covered.

Known limits: a growing element can push content below it so a doubled line shows at the
cover's edge until the reveal; scrolling mid-animation briefly shows the old picture; a
change that names no component falls back to the file's component; canvas targets rely on
Claude's x/y estimate. Rejected: making the tool wait for the whole animation (slows
Claude), a cheap-model labeller (API cost).

**Sound effects** (`src/common/clawd-sound.js`, played by the background page via the public
`ClawdSound` command; popup switch): ~33 synthesised chiptune sounds — footsteps, glugs,
"ahh", whoosh, giggles, per-action loops (swish, bonk, zap, blips, sonar, …), happy/sad
jingles. All synthesise without error in Chrome; **not yet heard in Firefox** (the
background page's autoplay behaviour is unverified).

**Sad when the page breaks:** the overlay watches for a dev-server error overlay
(`vite-error-overlay`, Next/webpack/CRA equivalents), the app root going blank after having
content, or uncaught errors in the last 4s; live Clawds then mope (rain cloud, tears,
sniffles, "Oh no… the build broke"), pausing their queue, and say "Phew, fixed!" on recovery
before carrying on. Verified headless on microEDA with a real Vite error overlay.

**Long-running work** (hooks: also `PostToolUseFailure`, `SubagentStart/Stop`,
`PreCompact/PostCompact`; run `node bridge/install-hooks.mjs` after pulling). Each
PreToolUse action is *held* until the PostToolUse with the same `tool_use_id` (cap 10
min): its own animation, then sitting down with a book or knitting after 20s, a yawn and Zzz after 3 min (woken with a start when it ends).
Shell commands get their own moods: tests tick a clipboard, builds hammer away by a growing brick wall,
installs dig through a parcel, git push/pull flings paper planes, background commands
(`run_in_background`) wind a kitchen timer. Tests, lint, builds, installs and syncs end
in a fist pump or facepalm: the bridge counts `PostToolUseFailure`, or failure summaries
at the end of the output (`pnpm test | tail` exits 0), as failed. Thinking for 12s+ (after a
prompt, or between tools) moves him to a chalkboard, which stays put while he paces. Subagents: a baby Clawd labelled with
the agent type toddles out to a spot left of Clawd's resting place (bottom right) and
acts out its subagent's own tool calls there (wobbling, a lazy eye, the odd tumble),
then carries a parcel back to Clawd when it stops; the others close up. Clawd won't
walk off while babies are out (a silent one goes home after 15 min). Compaction runs a trash compactor. The overlay remembers ended tool ids for
30s, because an `end` (sent straight through) can beat its own paced `act`. During a
permission reminder a held action is set aside and resumes after it.

**Before-pictures without hiding him:** the screenshot can only show what's on screen,
so while one is taken (until the next paint has been captured) only the parts of the
sprite, caption or glow that overlap the photographed spots get a hole cut in them
(`clip-path`); covers are never touched. Usually nothing overlaps and nothing changes.

**Water bottle:** aimed at the cursor it flies cap-first; if the cursor is still there
(within 40px) when it arrives it dinks off and tumbles away spinning, and if you dodged
it sails on past and Clawd mopes for a moment ("Aw, you dodged it…"). With no cursor it
spins all the way.

**Priority animations:** forking a subagent's baby (a copy of him slides out and shrinks)
and taking its parcel when it comes back (arms out, then parcel overhead and hearts)
queue in `c.priority`; while one runs his current step is paused and nothing else moves
him (once he's on screen). **Placement:** he stands beside what he's changing (right,
else left, else below, else above), facing it, never on it unless nothing fits; no name
tag under the main Clawd; captions are a bit smaller than the 1.5x sprite and sit lower.
A broken page makes him walk on screen first, then mope. At the chalkboard he writes
with chalk. A bottle that hits the cursor sets off an impact ring and a star there. When he stands
below his target the caption goes under him. Tests are a lab half the time (goggles, a
flask brewing over a Bunsen burner, changing colour).

> **Gotcha:** the build transpiles `for…of` in loose mode (index loop over `.length`), so
> never iterate a Map/Set iterator directly: write `for (const c of [...clawds.values()])`.
> A bare `clawds.values()` loop silently runs zero times (this was the sad-caption bug;
> also, in the background bundle, Live Clawd's replay-on-tab-switch, and failing jobs or
> pending approvals when the bridge disconnects).

### Changes outside this repo

`~/.claude/settings.json` (hooks, `mcp__clawd` allow), `~/.claude.json` (user MCP `clawd`),
`~/.claude/CLAUDE.md` (marked Clawd block), the Windows shim + registry key above,
`~/.config/amo.env`.
