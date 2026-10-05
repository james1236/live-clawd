/**
 * Builds the extension for both browsers from one source:
 *   dist/firefox  Manifest V2, persistent background page (WebSocket + sounds live there)
 *   dist/chrome   Manifest V3, service worker + offscreen page for sounds
 *
 *   node build.mjs [--watch]
 */
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const here = path.dirname(new URL(import.meta.url).pathname);
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const watch = process.argv.includes('--watch');

const NAME = 'Live Clawd';
const AUTHOR = 'popup-games'; // (Chrome's manifest only takes an author email; the Web Store shows the publisher)
const DESCRIPTION = 'A pixel mascot acts out what Claude Code is doing, right on your localhost dev page.';
const LOCAL = ['http://localhost/*', 'http://127.0.0.1/*', 'http://[::1]/*', 'https://localhost/*', 'https://127.0.0.1/*'];
const ICONS = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
// The toolbar icon is a sleeping Clawd by default; the background wakes him on the tabs he acts on.
const ASLEEP = Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v.replace('.png', '-asleep.png')]));
const COMMANDS = { 'toggle-live': { description: 'Turn Live Clawd on or off' } };

const manifests = {
  firefox: {
    manifest_version: 2,
    name: NAME,
    version: pkg.version,
    description: DESCRIPTION,
    icons: ICONS,
    author: AUTHOR,
    developer: { name: AUTHOR },
    browser_specific_settings: {
      gecko: {
        id: 'live-clawd@popup-games',
        strict_min_version: '115.0',
        // Signed builds update themselves from the repo (tools/release.mjs keeps this file).
        update_url: 'https://raw.githubusercontent.com/james1236/live-clawd/main/release/updates.json',
      },
    },
    background: { scripts: ['background.js'], persistent: true },
    browser_action: { default_popup: 'popup.html', default_icon: ASLEEP, default_title: NAME },
    permissions: ['storage', 'scripting', ...LOCAL],
    optional_permissions: ['<all_urls>'],
    commands: COMMANDS,
  },
  chrome: {
    manifest_version: 3,
    name: NAME,
    version: pkg.version,
    description: DESCRIPTION,
    icons: ICONS,
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html', default_icon: ASLEEP, default_title: NAME },
    permissions: ['storage', 'scripting', 'offscreen'],
    host_permissions: LOCAL,
    optional_host_permissions: ['<all_urls>'],
    commands: COMMANDS,
  },
};

const ENTRIES = {
  firefox: ['background', 'overlay', 'popup', 'welcome'],
  chrome: ['background', 'overlay', 'popup', 'welcome', 'probe', 'offscreen'],
};

for (const [browser, manifest] of Object.entries(manifests)) {
  const out = path.join(here, 'dist', browser);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const f of ['popup.html', 'welcome.html', ...(browser === 'chrome' ? ['offscreen.html'] : [])]) {
    fs.copyFileSync(path.join(here, 'static', f), path.join(out, f));
  }
  for (const f of [...Object.values(ICONS), ...Object.values(ASLEEP)]) fs.copyFileSync(path.join(here, f), path.join(out, f));
  const opts = {
    entryPoints: Object.fromEntries(ENTRIES[browser].map(e => [e, path.join(here, 'src', `${e}.js`)])),
    outdir: out,
    bundle: true,
    format: 'iife',
    target: browser === 'firefox' ? 'firefox115' : 'chrome116',
    logLevel: 'warning',
  };
  if (watch) await (await esbuild.context(opts)).watch();
  else await esbuild.build(opts);
}
if (!watch) console.log(`built dist/firefox and dist/chrome (v${pkg.version})`);
