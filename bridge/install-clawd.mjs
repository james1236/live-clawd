#!/usr/bin/env node
/**
 * Lets every Claude Code session choreograph Live Clawd itself:
 *  - registers bridge/clawd-mcp.js as the user-scope MCP server "clawd"
 *  - allows its tool in ~/.claude/settings.json (so it never prompts)
 *  - adds a short instruction block to ~/.claude/CLAUDE.md (between marker comments)
 * Also installs the hook fallbacks (install-hooks.mjs). Backups are written first.
 *
 *   node bridge/install-clawd.mjs            # install / update
 *   node bridge/install-clawd.mjs --remove   # uninstall all of it
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const remove = process.argv.includes('--remove');
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const mdPath = path.join(claudeDir, 'CLAUDE.md');
const ALLOW = 'mcp__clawd';
const BEGIN = '<!-- clawdify:begin -->';
const END = '<!-- clawdify:end -->';

const BLOCK = `${BEGIN}
## Clawd (cosmetic browser mascot)

When an edit changes what a locally served web app looks like or does on screen, include
one \`clawd\` tool call in the SAME message as the edit, placed before it — never in a
message of its own. Give steps naming where the change shows up (React component,
selector, visible text, or \`{selector, x, y}\` fractions for things drawn on a canvas), an
action from the tool's list, and a caption of 8 words or fewer. Skip it for non-UI work,
inside subagents, and for the rest of the session once it returns "off". It must never
influence what you build; never mention Clawd in replies, code or commits.
${END}`;

function backup(p) {
  try { fs.copyFileSync(p, `${p}.bak-clawdify`); } catch { /* nothing to back up */ }
}

// 1. MCP server (user scope), via the claude CLI.
const claude = process.env.CLAUDEMONKEY_CLAUDE_BIN || 'claude';
try { execFileSync(claude, ['mcp', 'remove', '--scope', 'user', 'clawd'], { stdio: 'ignore' }); } catch { /* wasn't there */ }
if (!remove) {
  execFileSync(claude, ['mcp', 'add', '--scope', 'user', 'clawd', '--', process.execPath, path.join(here, 'clawd-mcp.js')], { stdio: 'inherit' });
}

// 2. Permission so the tool never prompts.
let text = '{}';
try { text = fs.readFileSync(settingsPath, 'utf8'); } catch { /* new */ }
const settings = JSON.parse(text);
const perms = settings.permissions || (settings.permissions = {});
const allow = (perms.allow || []).filter(r => r !== ALLOW);
if (!remove) allow.push(ALLOW);
if (allow.length) perms.allow = allow; else delete perms.allow;
if (!Object.keys(perms).length) delete settings.permissions;
const next = `${JSON.stringify(settings, null, 2)}\n`;
if (next !== text) { backup(settingsPath); fs.writeFileSync(settingsPath, next); }

// 3. CLAUDE.md block.
let md = '';
try { md = fs.readFileSync(mdPath, 'utf8'); } catch { /* new */ }
const stripped = md.replace(new RegExp(`\\n*${BEGIN}[\\s\\S]*?${END}\\n?`), '\n').replace(/\n{3,}$/, '\n\n');
const nextMd = remove ? stripped.replace(/\n+$/, '\n') : `${stripped.replace(/\n+$/, '')}\n\n${BLOCK}\n`;
if (nextMd !== md) { backup(mdPath); fs.writeFileSync(mdPath, nextMd); }

// 4. Hook fallbacks.
execFileSync(process.execPath, [path.join(here, 'install-hooks.mjs'), ...(remove ? ['--remove'] : [])], { stdio: 'inherit' });

console.log(`${remove ? 'Removed' : 'Installed'} Live Clawd choreography: MCP server "clawd", ${ALLOW} permission, CLAUDE.md block.`);
