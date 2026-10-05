# Live Clawd

A pixel mascot who connects to the Claude Code you already have running and acts out what
it's doing, right on the web app you're building.

![Clawd painting a navbar, restyling a page, running tests and forking a helper](docs/demo.gif)

<sub>Demo page: Bootstrap's 2017 [Album example](https://getbootstrap.com/docs/4.0/examples/album/) (MIT).</sub>

## Install

1. In Claude Code:

   ```
   /plugin marketplace add james1236/live-clawd
   /plugin install clawd@live-clawd
   ```

2. Install the browser extension: the signed `.xpi` for Firefox, or the `chrome` folder for
   Chrome (`chrome://extensions` → Developer mode → Load unpacked).

Needs Node.js and git. Works on Linux, macOS and WSL.

## Use

Start your dev server from your project's folder, open its `localhost` page, and run Claude
Code in that project. Clawd shows up while Claude works.

The toolbar icon is awake on pages Clawd is working on and asleep elsewhere. Its popup turns
him off, mutes a site, toggles sounds, and (optionally) lets him hide each change until he
reveals it.

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
