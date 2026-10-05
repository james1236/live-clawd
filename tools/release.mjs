#!/usr/bin/env node
/*
 * Cut a release:  node tools/release.mjs <version>      e.g. node tools/release.mjs 0.1.1
 *
 *  1. sets <version> in extension/package.json and plugin/.claude-plugin/plugin.json
 *  2. builds both extensions (extension/build.mjs)
 *  3. signs the Firefox build on AMO as an unlisted add-on (needs AMO_JWT_ISSUER and
 *     AMO_JWT_SECRET, from the environment or ~/.config/amo.env) and puts it in release/ as
 *     live-clawd-<version>.xpi and live-clawd.xpi (the README's link)
 *  4. adds it to release/updates.json, which signed Firefox installs check for updates
 *  5. zips the Chrome build twice: live-clawd-chrome.zip (a folder, for Load unpacked) and
 *     live-clawd-chrome-webstore.zip (manifest at the top, for the Chrome Web Store)
 *
 * Then commit and push (the update and download links point at GitHub), and upload the
 * Web Store zip in the developer dashboard. AMO never signs the same version twice.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REL = path.join(ROOT, 'release');
const RAW = 'https://raw.githubusercontent.com/james1236/live-clawd/main/release';
const ID = 'live-clawd@popup-games';
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: node tools/release.mjs <x.y.z>');
  process.exit(2);
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });

// AMO credentials
const env = { ...process.env };
if (!env.AMO_JWT_ISSUER) {
  try {
    for (const line of fs.readFileSync(path.join(os.homedir(), '.config', 'amo.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?(AMO_JWT_\w+)=["']?([^"'\n]*)/);
      if (m) env[m[1]] = m[2];
    }
  } catch { /* none */ }
}
if (!env.AMO_JWT_ISSUER || !env.AMO_JWT_SECRET) {
  console.error('Needs AMO_JWT_ISSUER and AMO_JWT_SECRET (environment or ~/.config/amo.env)');
  process.exit(2);
}

// 1. Versions
for (const f of ['extension/package.json', 'plugin/.claude-plugin/plugin.json']) {
  const p = path.join(ROOT, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.version = version;
  fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`);
}

// 2. Build
if (!fs.existsSync(path.join(ROOT, 'extension', 'node_modules'))) run('npm', ['install', '--no-audit', '--no-fund'], { cwd: path.join(ROOT, 'extension') });
run('node', ['extension/build.mjs']);

// 3. Sign
const signed = fs.mkdtempSync(path.join(os.tmpdir(), 'live-clawd-signed-'));
run('npx', ['--yes', 'web-ext@10.7.0', 'sign', '--channel=unlisted', '--source-dir', 'extension/dist/firefox',
  '--artifacts-dir', signed, '--api-key', env.AMO_JWT_ISSUER, '--api-secret', env.AMO_JWT_SECRET,
  '--approval-timeout', '900000'], { env });
const xpi = fs.readdirSync(signed).find(f => f.endsWith('.xpi'));
if (!xpi) throw new Error('AMO returned no signed .xpi');
fs.mkdirSync(REL, { recursive: true });
fs.copyFileSync(path.join(signed, xpi), path.join(REL, `live-clawd-${version}.xpi`));
fs.copyFileSync(path.join(signed, xpi), path.join(REL, 'live-clawd.xpi'));

// 4. updates.json
const updatesPath = path.join(REL, 'updates.json');
let updates = { addons: { [ID]: { updates: [] } } };
try { updates = JSON.parse(fs.readFileSync(updatesPath, 'utf8')); } catch { /* first */ }
const list = updates.addons[ID].updates.filter(u => u.version !== version);
list.push({ version, update_link: `${RAW}/live-clawd-${version}.xpi` });
updates.addons[ID].updates = list;
fs.writeFileSync(updatesPath, `${JSON.stringify(updates, null, 2)}\n`);

// 5. Chrome zips
const zip = (base, rootDir, baseDir) => run('python3', ['-c',
  'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2], sys.argv[3])', base, rootDir, baseDir]);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'live-clawd-chrome-'));
fs.cpSync(path.join(ROOT, 'extension', 'dist', 'chrome'), path.join(staging, 'live-clawd-chrome'), { recursive: true });
for (const f of ['live-clawd-chrome.zip', 'live-clawd-chrome-webstore.zip']) fs.rmSync(path.join(REL, f), { force: true });
zip(path.join(REL, 'live-clawd-chrome'), staging, 'live-clawd-chrome');
zip(path.join(REL, 'live-clawd-chrome-webstore'), path.join(ROOT, 'extension', 'dist', 'chrome'), '.');

console.log(`\nReleased ${version}: release/live-clawd-${version}.xpi, updates.json and both Chrome zips.`);
console.log('Next: commit and push, then upload release/live-clawd-chrome-webstore.zip to the Chrome Web Store.');
