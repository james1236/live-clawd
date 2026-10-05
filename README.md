# Live Clawd

A pixel mascot who connects to the Claude Code you already have running and acts out what
it's doing, right on the web app you're building. He works best when your project's
changes show up on the page live (a dev server with hot reload, like Vite or Next.js), so
you see each edit land as he acts it out.

![Clawd painting a navbar, restyling a page, running tests and forking a helper](docs/demo.gif)

## Install

1. In Claude Code:

   ```
   /plugin marketplace add james1236/live-clawd
   ```

   ```
   /plugin install clawd@live-clawd
   ```

2. Install the browser extension:
   - **Firefox:** open [live-clawd.xpi](https://github.com/james1236/live-clawd/raw/main/release/live-clawd.xpi) (signed) and confirm.
   - **Chrome** (and Edge, Brave, Arc): [add it from the Chrome Web Store](https://chromewebstore.google.com/detail/fkhlfeneiikmcfhnmanfnfechbdjeabp).
     If that link doesn't work yet, download [live-clawd-chrome.zip](https://github.com/james1236/live-clawd/raw/main/release/live-clawd-chrome.zip),
     unzip it, and in `chrome://extensions` turn on Developer mode, click Load unpacked and
     pick the `live-clawd-chrome` folder.

Needs Node.js and git. Works on Linux, macOS and WSL.

## Use

Start your dev server from your project's folder, open its `localhost` page, and run Claude
Code in that project. Clawd shows up while Claude works.

The toolbar icon is awake on pages Clawd is working on and asleep elsewhere. Its popup turns
him off, mutes a site, toggles sounds, and (optionally) lets him hide each change until he
reveals it.

## How it works

The plugin adds two things to Claude Code. **Hooks** tell Clawd what Claude is doing (which
tool, how it ended, subagents) and cost no tokens. A **`clawd` tool** lets Claude itself say
where a UI change shows up and how Clawd should act it out: Claude adds one short call next
to each visible edit, which costs roughly a hundred output tokens each time, plus a few
hundred tokens of instructions in the system prompt.

Both go to a small local server that your Claude Code session starts on `127.0.0.1`; the
extension connects to it, finds the dev page for that project among your localhost tabs, and
plays the animation there.

## If he doesn't show up

- **Popup says "Waiting for Claude Code":** start a Claude Code session with the plugin
  enabled (`/plugin`), and check `node --version` works.
- **Icon stays asleep on your page:** start the dev server from inside the project folder,
  or list it in `~/.config/live-clawd/config.json`:

  ```json
  { "projects": { "~/code/my-app": ["http://localhost:3000"] } }
  ```

Everything stays on your machine: the plugin and the extension talk over `127.0.0.1`, and
websites can't connect.

---

Unofficial fan project; Clawd is Anthropic's mascot.
