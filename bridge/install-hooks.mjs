#!/usr/bin/env node
/**
 * Adds (or with --remove, removes) the Live Clawd hooks in ~/.claude/settings.json.
 *
 * Each hook runs bridge/live-hook.sh asynchronously, so it never delays or affects
 * Claude Code. Other hooks are left untouched; a backup is written before any change.
 *
 *   node bridge/install-hooks.mjs            # install / update
 *   node bridge/install-hooks.mjs --remove   # uninstall
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'SessionEnd',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact'];
const MARK = 'live-hook.sh';
const hookPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'live-hook.sh');
const settingsPath = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
const remove = process.argv.includes('--remove');

let text = '{}';
try { text = fs.readFileSync(settingsPath, 'utf8'); } catch { /* new file */ }
const settings = JSON.parse(text);
const hooks = settings.hooks || (settings.hooks = {});

const isOurs = group => (group.hooks || []).some(h => String(h.command || '').includes(MARK));
for (const ev of EVENTS) {
  const groups = (hooks[ev] || []).filter(g => !isOurs(g));
  if (!remove) {
    const group = { hooks: [{ type: 'command', command: hookPath, async: true, timeout: 5 }] };
    if (/ToolUse/.test(ev)) group.matcher = '*';
    groups.push(group);
  }
  if (groups.length) hooks[ev] = groups;
  else delete hooks[ev];
}
if (!Object.keys(hooks).length) delete settings.hooks;

const next = `${JSON.stringify(settings, null, 2)}\n`;
if (next === text) {
  console.log(`No change: ${settingsPath}`);
} else {
  if (text !== '{}') fs.writeFileSync(`${settingsPath}.bak-clawdify`, text);
  fs.writeFileSync(settingsPath, next);
  fs.chmodSync(hookPath, 0o755);
  console.log(`${remove ? 'Removed' : 'Installed'} Live Clawd hooks in ${settingsPath}`
    + `${text !== '{}' ? ` (backup: ${settingsPath}.bak-clawdify)` : ''}`);
}
