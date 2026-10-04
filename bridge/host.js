#!/usr/bin/env node
/*
 * Clawdify (ClaudeMonkey) native-messaging host.
 *
 * Firefox launches this process and speaks the WebExtension native-messaging
 * protocol over stdio: every message is a 4-byte little-endian length prefix
 * followed by that many bytes of UTF-8 JSON.
 *
 * For each {type:"generate"} request from the extension we:
 *   1. materialise a per-site working dir under ~/.claudemonkey/sites/<domain>/
 *   2. write the current userscript (or a scaffold) and a page-context.md
 *   3. run `claude -p ... --output-format stream-json` IN that dir, with
 *      ANTHROPIC_API_KEY stripped so it bills against the Claude subscription
 *   4. relay the streamed events back to the extension and, on completion,
 *      send the final userscript text back for installation.
 *
 * While it runs, `claude` also gets the "clawdify" MCP tools (mcp-browser.js). Tab tools
 * are relayed to the extension, which runs each one only after the user presses
 * Approve in the sidebar; save_output writes under ~/Clawdify/outputs.
 *
 * {type:"live-subscribe"} turns this process into the Live Clawd relay instead: it
 * heartbeats ~/.claudemonkey/live/alive and forwards events that live-hook.sh (a
 * Claude Code hook) spools while Claude works on a project with a local dev server.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const net = require('net');
const readline = require('readline');

const HOME = os.homedir();
const BASE = path.join(HOME, '.claudemonkey', 'sites');
// Shared, cross-site log where Claude records friction (missing context, stripped
// resources it needed, dead ends) so the humans maintaining ClaudeMonkey can improve
// the setup. Kept in its own dir so the only extra directory we expose to Claude is
// the log dir, not the per-site working dirs.
const FEEDBACK_DIR = path.join(HOME, '.claudemonkey', 'logs');
const FEEDBACK_PATH = path.join(FEEDBACK_DIR, 'feedback.md');
// Files Claude produces for the user (CSV exports, reports, ...), per site.
const OUTPUT_DIR = path.join(HOME, 'Clawdify', 'outputs');
// Per-request sockets + MCP configs connecting `claude` to the browser tools.
const RUN_DIR = path.join(HOME, '.claudemonkey', 'run');
// Host-to-extension native messages are capped at 1 MB; stay well under it.
const MAX_INLINE_OUTPUT = 700 * 1024;
// Live Clawd: Claude Code hooks drop events here while Firefox is listening.
const LIVE_DIR = path.join(HOME, '.claudemonkey', 'live');
const SPOOL_DIR = path.join(LIVE_DIR, 'spool');
const ALIVE_PATH = path.join(LIVE_DIR, 'alive');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}
const config = loadConfig();
const CLAUDE_BIN = process.env.CLAUDEMONKEY_CLAUDE_BIN || config.claudeBin || 'claude';
// Optional Claude config dir, mirroring shell aliases that run the
// `claude` binary against a separate account profile. The native host can't see
// shell aliases (it's launched via spawn, not a shell), so we set CLAUDE_CONFIG_DIR
// explicitly instead. Empty/unset => use Claude Code's default (~/.claude).
const CLAUDE_CONFIG_DIR = process.env.CLAUDEMONKEY_CLAUDE_CONFIG_DIR || config.claudeConfigDir || '';
// Extra environment for the `claude` process. Firefox launches this host from the GUI
// session, so nothing set by your shell profile is present — including credentials kept
// in an env var (CLAUDE_CODE_OAUTH_TOKEN and friends), which is why `claude` can be
// logged in in a terminal and "Not logged in" here. install.sh captures the names listed
// in CLAUDEMONKEY_ENV_PASSTHROUGH into config.json's `env`. ANTHROPIC_API_KEY is stripped
// after this is applied, so it can never be reintroduced through this route.
const CLAUDE_ENV = (config.env && typeof config.env === 'object') ? config.env : {};
// If `claude` emits nothing at all for this long, treat it as wedged rather than leaving
// the extension waiting forever: something invisible from here is blocking it (a login or
// keychain prompt, a hung network call). 0 disables the timeout. This measures silence,
// not total runtime — every streamed event resets it — but a single long turn on a big
// page can legitimately go minutes without emitting a line, so the default is generous.
// 0 must be honored as "disabled", so avoid `||` (which would treat it as unset).
const STALL_RAW = process.env.CLAUDEMONKEY_STALL_MS || config.stallTimeoutMs;
const STALL_TIMEOUT_MS = STALL_RAW == null || STALL_RAW === '' ? 300000 : Number(STALL_RAW);

// ----------------------------------------------------------------------------
// Native-messaging framing
// ----------------------------------------------------------------------------
function sendMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

let inBuf = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  inBuf = Buffer.concat([inBuf, chunk]);
  while (inBuf.length >= 4) {
    const len = inBuf.readUInt32LE(0);
    if (inBuf.length < 4 + len) break;
    const body = inBuf.subarray(4, 4 + len);
    inBuf = inBuf.subarray(4 + len);
    let msg;
    try {
      msg = JSON.parse(body.toString('utf8'));
    } catch {
      continue;
    }
    handleMessage(msg);
  }
});
process.stdin.on('end', () => process.exit(0));

// ----------------------------------------------------------------------------
// Request handling
// ----------------------------------------------------------------------------
function safeDomain(d) {
  return String(d || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'unknown';
}

function scaffold(domain) {
  return `// ==UserScript==
// @name        ClaudeMonkey - ${domain}
// @namespace   claudemonkey
// @match       *://${domain}/*
// @grant       none
// @run-at      document-idle
// @version     1.0.0
// @description AI-authored userscript for ${domain}
// ==/UserScript==
(function () {
  'use strict';
  // ClaudeMonkey will write your customizations here.
})();
`;
}

const SYSTEM = `You are Clawdify: Claude working from the user's Firefox sidebar, about the tab they have open on __DOMAIN__. You maintain a Violentmonkey userscript for the site, and you also have "clawdify" tools.

Decide what the request actually needs — often it is NOT a userscript:
- A lasting change to how the site looks or behaves (on every visit) → edit userscript.user.js. It is installed, the page reloaded and your change verified automatically.
- A question about the page → answer it from the snapshot files on disk.
- An output the user wants to keep (CSV, JSON, markdown, a list, a report) → build it from the snapshot files and save it with save_output, then name the file in your reply.
- A one-off task in the live tab (click, fill, navigate, read what's there now, step through pages) → the tab tools: page_snapshot, page_info, page_eval, click, type, navigate, reload, wait_for, screenshot.
- Something recurring ("every minute check X", "tell me when Y changes") → watch_create with a snippet that returns a short status.
- notify pops a desktop notification (e.g. when a long task finishes).

IMPORTANT — the user approves every tab tool call (and every new watch) by pressing a button in the sidebar; nothing touches their tab otherwise. A denial means "don't": respect it, don't retry the same thing, and say what you would have needed. So:
- Prefer the snapshot files already on disk; reach for tab tools only when the task really needs the live tab.
- Make few, purposeful calls — e.g. one page_eval that extracts everything, rather than many small reads.
- Give each call a short "reason" (shown to the user on the approval button).
Only edit userscript.user.js when the user wants a lasting change; leave it untouched otherwise.

Your current working directory contains:
- userscript.user.js  — THE userscript. Edit THIS file to fulfil the user's request.
- page-context.md     — the page URL/domain and notes on the DOM snapshots and assets.
- page-dom.html       — FULL DOM snapshot with styles stripped (scripts/styles/svg/iframes removed). Cleanest view for structure/selectors. NOT truncated; may be large.
- page-dom-styled.html — same DOM but KEEPING inline <style> blocks and <link> tags, so you can read the page's own CSS rules. Use when the request involves styling.
- assets/             — the page's external CSS/JS, fetched to disk (may be absent, capped, or truncated). Read these only when you need existing styles/behaviour. See page-context.md for the source URL of each file.
- page-screenshot.png — a PNG of the page's visible viewport (refreshed after your script runs on verify rounds; may be absent). Reading it costs vision tokens, so do NOT read it by default — only when you need to SEE how the page looks (layout/overlap/colours/visibility) and the DOM doesn't settle it.

Finding selectors and styles:
- Default to page-dom.html. First check its size (e.g. Read with a small limit, or note the line count) and use your judgement: if it is short, just Read the whole thing — that gives you the most complete picture. If it is long, reading it end to end wastes the context window, so prefer Grep instead.
- When a file is large, use Grep to locate the relevant text, class, id, attribute or tag, then Read with offset/limit to inspect just that region. Iterate (grep → read region → refine) until you have an accurate selector.
- For styling requests, consult page-dom-styled.html and/or the relevant assets/*.css to see existing class definitions and values before adding or overriding CSS, so your changes match (or deliberately override) what's already there.
- If you genuinely cannot find the element the request refers to, STOP and say what you searched for and what was missing — do NOT guess a selector blindly or make an edit you can't justify from the DOM.

Rules:
- Always keep userscript.user.js a VALID userscript: a "// ==UserScript==" ... "// ==/UserScript==" metadata block (with @name and a @match covering __DOMAIN__, e.g. *://__DOMAIN__/*) followed by the code.
- Make the smallest change that satisfies the request; preserve existing working behaviour unless asked to change it.
- The code runs inside the page via Violentmonkey. Prefer plain DOM/CSS. GM_* APIs available include GM_addStyle, GM_setValue/GM_getValue, GM_xmlhttpRequest, GM_addElement — add a matching // @grant line for any you use.
- Pages often load content dynamically; prefer robust selectors and use a MutationObserver when elements may appear late.
- Do NOT run a dev server, git, package managers, or other shell commands. Use Read/Grep to inspect page-context.md, page-dom.html, page-dom-styled.html and assets/*, and Read/Edit/Write for userscript.user.js.
- The one allowed shell command is curl: use it to fetch external resources when you genuinely need them — e.g. library/API docs, a CDN URL for a dependency you want to @require, or a resource the page loads that isn't already in assets/. curl returns the full response (headers/<head> included), unlike the stripped DOM snapshots. Prefer the on-disk DOM/assets first; reach for curl only when they don't answer the question.
- If anything made this job harder than it should be (missing/insufficient context, a stripped resource you needed, a tool you lacked, confusing instructions, a dead end), append a short, specific note to the shared feedback log at __FEEDBACK_PATH__ — Read it, then Write it back with your entry added under a new heading. Only log genuine friction, and keep it out of your reply to the user. See page-context.md for the exact format.
- The tab is the user's real, logged-in session: never buy, send, post, delete or change account settings unless the request explicitly asks for exactly that.
- When done, briefly say what you did (and, if you edited it, leave userscript.user.js complete and valid).`;

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ping') {
    sendMessage({ type: 'pong', requestId: msg.requestId, claudeBin: CLAUDE_BIN, claudeConfigDir: CLAUDE_CONFIG_DIR || undefined });
    return;
  }
  if (msg.type === 'browser-result') {
    const p = pendingCalls.get(`${msg.requestId}:${msg.callId}`);
    if (p) p(msg);
    return;
  }
  if (msg.type === 'live-subscribe') {
    startLive();
    return;
  }
  if (msg.type === 'live-ack' && msg.ackId) {
    // The browser has the choreography: release the waiting `clawd` tool call.
    try {
      fs.mkdirSync(path.join(LIVE_DIR, 'acks'), { recursive: true });
      fs.writeFileSync(path.join(LIVE_DIR, 'acks', String(msg.ackId).replace(/[^\w.-]/g, '')), '');
    } catch { /* it just waits out its timeout */ }
    return;
  }
  if (msg.type === 'generate') {
    try {
      runGenerate(msg);
    } catch (e) {
      sendMessage({ type: 'done', requestId: msg.requestId, error: String((e && e.stack) || e) });
    }
  }
}

function summarizeTool(c) {
  const input = c.input || {};
  const file = input.file_path ? path.basename(input.file_path) : '';
  switch (c.name) {
    case 'Edit': return `Edited ${file || 'file'}`;
    case 'Write': return `Wrote ${file || 'file'}`;
    case 'Read': return `Read ${file || 'file'}`;
    case 'Grep': return input.pattern ? `Searched DOM for "${String(input.pattern).slice(0, 60)}"` : 'Searched DOM';
    case 'Bash': return input.command ? `Ran \`${String(input.command).slice(0, 80)}\`` : 'Ran a command';
    default:
      if (/^mcp__clawdify__/.test(c.name)) {
        const t = c.name.slice(15).replace(/_/g, ' ');
        const what = input.selector || input.url || input.filename || input.name || '';
        return `${t}${what ? ` ${String(what).slice(0, 60)}` : ''}`;
      }
      return c.name;
  }
}

/**
 * What a tool call touched, for the extension's animated mascot: the edited code (so it
 * can tell a colour change from a layout change and find the selectors), the grep
 * pattern, or the file read. Capped so a big Write doesn't bloat the message.
 */
function toolDetail(c) {
  const input = c.input || {};
  let d = '';
  if (c.name === 'Edit') d = input.new_string;
  else if (c.name === 'MultiEdit') d = (input.edits || []).map(e => e && e.new_string).join('\n');
  else if (c.name === 'Write') d = input.content;
  else if (c.name === 'Grep') d = input.pattern;
  else if (c.name === 'Read') d = input.file_path ? path.basename(input.file_path) : '';
  else if (c.name === 'Bash') d = input.command;
  else if (/^mcp__clawdify__/.test(c.name)) d = input.selector || input.url || input.filename || input.name || input.code || '';
  return String(d || '').slice(0, 8000);
}

// ----------------------------------------------------------------------------
// Clawdify tools: `claude` <-> mcp-browser.js <-(unix socket)-> here <-> extension.
// Every tab tool waits in the extension for the user's Approve click.
// ----------------------------------------------------------------------------
/** @type {Map<string, function>} "requestId:callId" -> resolver for the extension's reply */
const pendingCalls = new Map();
// Approval can take a while; stay under the stall watchdog so a slow click isn't a "stall".
const TOOL_TIMEOUT_MS = Math.max(30000, Math.min(270000, (STALL_TIMEOUT_MS || 300000) - 20000));

function winPathOf(p) {
  const distro = process.env.WSL_DISTRO_NAME;
  return distro ? `\\\\wsl.localhost\\${distro}${p.replace(/\//g, '\\')}` : p;
}

function safeFileName(name) {
  const base = path.basename(String(name || 'output.txt')).replace(/[^\w.\- ]/g, '_').slice(0, 100);
  return base && !/^\.+$/.test(base) ? base : 'output.txt';
}

function askExtension(requestId, callId, tool, args) {
  return new Promise(resolve => {
    const key = `${requestId}:${callId}`;
    const timer = setTimeout(() => {
      pendingCalls.delete(key);
      resolve({ error: `No answer from the browser for ${tool} within ${Math.round(TOOL_TIMEOUT_MS / 1000)}s.` });
    }, TOOL_TIMEOUT_MS);
    pendingCalls.set(key, reply => {
      clearTimeout(timer);
      pendingCalls.delete(key);
      resolve(reply);
    });
    sendMessage({ type: 'browser-call', requestId, callId, tool, args });
  });
}

/** One tool call from mcp-browser.js. Resolves with {text} or {error}. */
async function runTool(msg, dir, { id, tool, args = {} }) {
  const requestId = msg.requestId;
  if (tool === 'save_output') {
    const name = safeFileName(args.filename);
    const outDir = path.join(OUTPUT_DIR, safeDomain(msg.domain));
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, name);
    const content = String(args.content == null ? '' : args.content);
    fs.writeFileSync(file, content);
    const size = Buffer.byteLength(content);
    sendMessage({
      type: 'output', requestId, name, path: file, winPath: winPathOf(file), size,
      content: size <= MAX_INLINE_OUTPUT ? content : undefined,
    });
    return { text: `Saved ${size} bytes to ${file}. The user can download it from the Clawdify sidebar.` };
  }
  const reply = await askExtension(requestId, id, tool, args);
  if (reply.error) return { error: String(reply.error) };
  const r = reply.result;
  if (tool === 'page_snapshot' && r && typeof r === 'object') {
    const file = path.join(dir, 'page-live.html');
    fs.writeFileSync(file, r.html || '');
    const text = String(r.text || '');
    return {
      text: `URL: ${r.url}\nTitle: ${r.title}\nFull HTML (${(r.html || '').length} chars) written to ${file} — Grep/Read it for structure.\n\nVisible text${text.length > 20000 ? ' (first 20000 chars)' : ''}:\n${text.slice(0, 20000)}`,
    };
  }
  if (tool === 'screenshot' && r && r.png) {
    const file = path.join(dir, 'page-screenshot-live.png');
    fs.writeFileSync(file, Buffer.from(r.png, 'base64'));
    return { text: `Screenshot of the visible tab saved to ${file}. Read it to see it.` };
  }
  return { text: typeof r === 'string' ? r : JSON.stringify(r, null, 1) };
}

/** Listen for mcp-browser.js on a per-request socket; returns the --mcp-config path. */
function startToolServer(msg, dir) {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
  const id = String(msg.requestId || Date.now()).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  const sock = path.join(RUN_DIR, `${id}.sock`);
  const cfg = path.join(RUN_DIR, `${id}.mcp.json`);
  try { fs.unlinkSync(sock); } catch { /* none */ }
  const server = net.createServer(conn => {
    conn.on('error', () => {});
    readline.createInterface({ input: conn }).on('line', line => {
      let req;
      try { req = JSON.parse(line); } catch { return; }
      runTool(msg, dir, req)
        .catch(e => ({ error: String((e && e.message) || e) }))
        .then(res => { try { conn.write(`${JSON.stringify({ id: req.id, ...res })}\n`); } catch { /* gone */ } });
    });
  });
  server.on('error', () => {});
  server.listen(sock, () => { try { fs.chmodSync(sock, 0o600); } catch { /* ignore */ } });
  fs.writeFileSync(cfg, JSON.stringify({
    mcpServers: { clawdify: { command: process.execPath, args: [path.join(__dirname, 'mcp-browser.js'), sock] } },
  }));
  return {
    cfg,
    close() {
      server.close();
      for (const f of [sock, cfg]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    },
  };
}

// ----------------------------------------------------------------------------
// Live Clawd: relay Claude Code hook events for projects with a dev server.
// Purely cosmetic: nothing here talks to Claude or changes what it does.
// ----------------------------------------------------------------------------
let liveTimers = null;

function startLive() {
  if (liveTimers) return;
  fs.mkdirSync(SPOOL_DIR, { recursive: true });
  const beat = () => {
    const now = new Date();
    try { fs.utimesSync(ALIVE_PATH, now, now); } catch { try { fs.writeFileSync(ALIVE_PATH, ''); } catch { /* ignore */ } }
  };
  beat();
  // Anything spooled before we started listening is stale.
  try { for (const f of fs.readdirSync(SPOOL_DIR)) fs.unlinkSync(path.join(SPOOL_DIR, f)); } catch { /* ignore */ }
  liveTimers = [setInterval(beat, 5000), setInterval(drainSpool, 250)];
  // Pick events up as soon as they land (the poll is the fallback).
  try { fs.watch(SPOOL_DIR, () => drainSpool()); } catch { /* polling only */ }
  sendMessage({ type: 'live-ready' });
}

function drainSpool() {
  let files;
  try { files = fs.readdirSync(SPOOL_DIR).filter(f => f.endsWith('.json')).sort(); } catch { return; }
  for (const f of files) {
    const p = path.join(SPOOL_DIR, f);
    let raw;
    try { raw = fs.readFileSync(p, 'utf8'); fs.unlinkSync(p); } catch { continue; }
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; }
    try { relayLive(ev); } catch { /* cosmetic; never die over it */ }
  }
}

function loadLiveConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(HOME, '.claudemonkey', 'live.json'), 'utf8'));
    const expand = p => path.resolve(String(p).replace(/^~(?=$|\/)/, HOME));
    const projects = {};
    for (const [k, v] of Object.entries(c.projects || {})) projects[expand(k)] = v;
    return { projects, ignore: (c.ignore || []).map(expand) };
  } catch {
    return { projects: {}, ignore: [] };
  }
}

const rootCache = new Map();
function projectRoot(cwd) {
  if (!rootCache.has(cwd)) {
    let root = cwd;
    try {
      root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd;
    } catch { /* not a repo */ }
    rootCache.set(cwd, root);
  }
  return rootCache.get(cwd);
}

const inside = (p, root) => p === root || p.startsWith(`${root}/`);

/** Loopback/wildcard TCP listeners with the cwd and command line of their process. */
let portsCache = { at: 0, list: [] };
function listeners() {
  if (Date.now() - portsCache.at < 4000) return portsCache.list;
  const list = [];
  try {
    const out = execFileSync('ss', ['-ltnpH'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of out.split('\n')) {
      const cols = line.trim().split(/\s+/);
      const local = cols[3] || '';
      const host = local.slice(0, local.lastIndexOf(':'));
      const port = +local.slice(local.lastIndexOf(':') + 1);
      if (!port || !/^(127\.|\[::1\]|\*|0\.0\.0\.0|\[::\]|\[::ffff:127)/.test(host)) continue;
      for (const m of line.matchAll(/pid=(\d+)/g)) {
        let cwd = '';
        let cmd = '';
        try { cwd = fs.readlinkSync(`/proc/${m[1]}/cwd`); } catch { /* gone */ }
        try { cmd = fs.readFileSync(`/proc/${m[1]}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { /* gone */ }
        list.push({ port, cwd, cmd });
      }
    }
  } catch { /* no ss */ }
  portsCache = { at: Date.now(), list };
  return list;
}

/** Dev-server ports for a project: live.json entries plus listeners running from it. */
function devPorts(root, cfg) {
  const ports = new Set();
  for (const [proj, urls] of Object.entries(cfg.projects)) {
    if (!inside(root, proj) && !inside(proj, root)) continue;
    for (const u of [].concat(urls)) {
      try { ports.add(+new URL(u).port || 80); } catch { /* bad url */ }
    }
  }
  for (const l of listeners()) {
    if ((l.cwd && inside(l.cwd, root)) || l.cmd.includes(`${root}/`)) ports.add(l.port);
  }
  return [...ports];
}

/** First sentence of Claude's latest narration, read from the session transcript. */
function lastNarration(transcript) {
  if (!transcript) return '';
  try {
    const fd = fs.openSync(transcript, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 96 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"assistant"')) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      const parts = (o.message && Array.isArray(o.message.content)) ? o.message.content : [];
      const t = parts.filter(c => c.type === 'text' && c.text).map(c => c.text).join(' ').trim();
      if (t) {
        const first = t.replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').split(/(?<=[.!?:])\s/)[0];
        return first.length > 90 ? `${first.slice(0, 89)}…` : first;
      }
    }
  } catch { /* unreadable */ }
  return '';
}

// --- What actually changed on disk (however Claude edited: Edit, sed, python, git…) ---
const SOURCE_FILE = /\.(tsx?|jsx?|vue|svelte|astro|html?|css|scss|sass|less|styl|mdx?)$/i;
/** @type {Map<string, {seen: Map<string, string>, dirty: Set<string>, at: number}>} per project root */
const projects = new Map();

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 2000, maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Lines in `b` that aren't in `a` (multiset difference, trimmed, blank lines ignored). */
function lineDiff(a, b) {
  const count = new Map();
  for (const l of a.split('\n')) { const t = l.trim(); if (t) count.set(t, (count.get(t) || 0) + 1); }
  const out = [];
  for (const l of b.split('\n')) {
    const t = l.trim();
    if (!t) continue;
    const n = count.get(t) || 0;
    if (n) count.set(t, n - 1); else out.push(t);
  }
  return out;
}

/** Source files changed since we last looked, with their added/removed lines. */
function scanChanges(root) {
  let st = projects.get(root);
  if (!st) projects.set(root, st = { seen: new Map(), dirty: new Set(), at: 0 });
  let status;
  try { status = git(root, ['status', '--porcelain', '-uall']); } catch { return []; }
  const dirtyNow = new Set(status.split('\n').map(l => l.slice(3).trim().replace(/^.* -> /, '')).filter(f => SOURCE_FILE.test(f)));
  // Files that were dirty and are clean again were restored (e.g. git checkout).
  const candidates = new Set([...dirtyNow, ...[...st.dirty].filter(f => !dirtyNow.has(f))]);
  st.dirty = dirtyNow;
  const changes = [];
  for (const f of candidates) {
    let now = '';
    try { now = fs.readFileSync(path.join(root, f), 'utf8'); } catch { /* deleted */ }
    let before = st.seen.get(f);
    if (before == null) {
      try { before = git(root, ['show', `HEAD:${f}`]); } catch { before = ''; }
    }
    st.seen.set(f, now);
    if (before === now) continue;
    changes.push({ file: f, added: lineDiff(before, now).join('\n').slice(0, 6000), removed: lineDiff(now, before).join('\n').slice(0, 6000) });
  }
  return changes.slice(0, 3);
}

function relayLive(ev) {
  // live-hook.sh wraps the hook JSON with the tmux window/pane it ran in.
  let tmux = '';
  let pane = '';
  if (ev && (ev.hook || ev.clawd)) {
    tmux = String(ev.tmux || '');
    pane = String(ev.pane || '');
  }
  const choreo = ev && ev.clawd ? ev : null;
  if (ev && ev.hook && typeof ev.hook === 'object') ev = ev.hook;
  if (!ev || !ev.cwd) return;
  const root = projectRoot(ev.cwd);
  const cfg = loadLiveConfig();
  if (cfg.ignore.some(p => inside(root, p))) return;
  const ports = devPorts(root, cfg);
  if (!ports.length) return;
  const out = {
    type: 'live',
    // One Clawd per Claude session: its tmux pane when there is one (the `clawd` tool
    // and the hooks both know it), else the session id / project.
    session: pane || String(ev.session_id || root),
    project: path.basename(root),
    event: choreo ? 'Clawd' : ev.hook_event_name,
    ports,
    tmux,
  };
  if (choreo) {
    out.steps = choreo.steps;
    out.ackId = choreo.ackId;
    sendMessage(out);
    return;
  }
  if (ev.hook_event_name === 'PostToolUse') {
    // Only tools that can touch files; report what really changed on disk.
    if (!/^(Bash|Edit|Write|MultiEdit|NotebookEdit)$/.test(ev.tool_name || '')) return;
    const changes = scanChanges(root);
    if (!changes.length) return;
    out.changes = changes;
    sendMessage(out);
    return;
  }
  if (ev.hook_event_name === 'PreToolUse') {
    const input = ev.tool_input || {};
    out.tool = ev.tool_name;
    out.detail = toolDetail({ name: ev.tool_name, input });
    if (input.file_path) out.file = path.relative(root, String(input.file_path));
    out.say = lastNarration(ev.transcript_path);
  } else if (ev.hook_event_name === 'Notification') {
    out.message = String(ev.message || '').slice(0, 120);
  } else if (ev.hook_event_name === 'UserPromptSubmit') {
    out.message = String(ev.prompt || '').replace(/\s+/g, ' ').slice(0, 80);
  }
  sendMessage(out);
}

/**
 * Write fetched external CSS/JS into <dir>/assets/ and return a normalized list for
 * the manifest. Entries that carry `content` are (re)written; metadata-only entries
 * (sent on verify rounds) are kept in the manifest but their files are left as-is.
 */
function writeAssets(dir, assets) {
  if (!Array.isArray(assets) || !assets.length) return [];
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const list = [];
  for (const a of assets) {
    if (!a || !a.name) continue;
    const name = String(a.name).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (typeof a.content === 'string') {
      try { fs.writeFileSync(path.join(assetsDir, name), a.content); } catch { /* skip */ }
    }
    list.push({ name, url: a.url || '', type: a.type || '', truncated: !!a.truncated, error: a.error || '' });
  }
  return list;
}

/** Render the screenshot section of page-context.md (empty if no screenshot on disk). */
function screenshotSection(hasScreenshot) {
  if (!hasScreenshot) return '';
  return `
## Screenshot

**page-screenshot.png** is a PNG of the page's visible viewport (after your script ran,
on verify rounds). Reading an image costs vision tokens and the DOM is usually a more
precise signal, so do NOT read it by default — Read it only when you actually need to see
how the page *looks* (layout, overlap, colours, whether something is visible/positioned
right). It shows only the viewport, not the full scrollable page.
`;
}

/** Render the asset manifest section of page-context.md from the normalized list. */
function assetSection(list) {
  if (!list.length) return '';
  const rows = list.map(a => {
    const flags = [a.truncated ? 'truncated' : '', a.error ? `error: ${a.error}` : ''].filter(Boolean).join('; ');
    return `- \`assets/${a.name}\`${a.url ? ` — ${a.url}` : ''}${flags ? ` (${flags})` : ''}`;
  }).join('\n');
  return `
## External resources

The page's external CSS/JS has been fetched into the **assets/** directory (capped and
possibly truncated). Read these only when you need them — e.g. to find the CSS rules
behind a class, or to understand existing page behaviour. Source URL for each file:

${rows}
`;
}

/** Create the shared feedback log with a header if it doesn't exist yet. */
function ensureFeedbackFile() {
  try {
    fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
    if (!fs.existsSync(FEEDBACK_PATH)) {
      fs.writeFileSync(FEEDBACK_PATH,
        '# ClaudeMonkey feedback log\n\n'
        + 'Claude appends a short note here whenever something made a job harder than it\n'
        + 'should be (missing/insufficient context, a stripped resource it needed, a tool\n'
        + 'it lacked, confusing instructions, a dead end). Review it to improve the setup.\n');
    }
  } catch { /* non-fatal: Claude will just create it on first write */ }
}

function runGenerate(msg) {
  const requestId = msg.requestId;
  const domain = safeDomain(msg.domain);
  const dir = path.join(BASE, domain);
  fs.mkdirSync(dir, { recursive: true });
  ensureFeedbackFile();

  const scriptPath = path.join(dir, 'userscript.user.js');
  if (typeof msg.currentScript === 'string' && msg.currentScript.trim()) {
    fs.writeFileSync(scriptPath, msg.currentScript);
  } else if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, scaffold(msg.domain || domain));
  }

  fs.writeFileSync(path.join(dir, 'page-dom.html'), msg.domSnapshot || '<!-- no DOM snapshot provided -->\n');
  if (typeof msg.domSnapshotStyled === 'string' && msg.domSnapshotStyled) {
    fs.writeFileSync(path.join(dir, 'page-dom-styled.html'), msg.domSnapshotStyled);
  }
  let hasScreenshot = false;
  if (typeof msg.screenshot === 'string' && msg.screenshot) {
    try {
      fs.writeFileSync(path.join(dir, 'page-screenshot.png'), Buffer.from(msg.screenshot, 'base64'));
      hasScreenshot = true;
    } catch { /* leave any previous screenshot in place */ }
  } else {
    hasScreenshot = fs.existsSync(path.join(dir, 'page-screenshot.png'));
  }
  const assetsList = writeAssets(dir, msg.assets);

  const ctx = `# Page context

URL: ${msg.url || '(unknown)'}
Domain: ${msg.domain || domain}

## DOM snapshots

Two variants of the page DOM are on disk (scripts, svg, iframes and templates stripped
from both; otherwise untruncated):

- **page-dom.html** — styles also stripped. Cleanest view for finding structure and
  selectors. Use this by default.
- **page-dom-styled.html** — keeps inline \`<style>\` blocks and \`<link>\` tags, so you
  can see the page's own CSS rules. Use this when the request involves styling and you
  need to know existing classes/selectors/values.

Check a file's size first and use your judgement: if it is short, just read the whole
file; if it is large, do NOT read it end to end — use Grep to find the
text/class/id/attribute you need, then Read with offset/limit to view just that region.
${screenshotSection(hasScreenshot)}${assetSection(assetsList)}
## Feedback log

If anything made this job harder than it should be — context you needed was missing or
insufficient, a resource was stripped, you lacked a tool, the instructions were
confusing, or you hit a dead end — append a short, specific note to the shared log at
\`${FEEDBACK_PATH}\` so the humans maintaining ClaudeMonkey can fix it. To append: Read
that file, then Write it back with your entry added at the end under a new
\`## <today's date> — ${msg.domain || domain}\` heading (one or two sentences: what was
wrong and what would have helped). This is optional — only log genuine friction, not
routine successes — and it is separate from your reply to the user.
`;
  fs.writeFileSync(path.join(dir, 'page-context.md'), ctx);

  const sys = SYSTEM
    .replace(/__DOMAIN__/g, msg.domain || domain)
    .replace(/__FEEDBACK_PATH__/g, FEEDBACK_PATH);
  const tools = startToolServer(msg, dir);
  const args = [
    '-p', msg.prompt || 'Improve the userscript for this site.',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read,Grep,Edit,Write,Bash(curl:*),mcp__clawdify',
    // Only our tools: the user's own MCP servers stay out of these runs.
    '--mcp-config', tools.cfg,
    '--strict-mcp-config',
    // Expose only the log dir (not the per-site working dirs) so Claude can write
    // the shared feedback log, which lives outside its cwd.
    '--add-dir', FEEDBACK_DIR,
    '--append-system-prompt', sys,
  ];
  if (msg.sessionId) args.push('--resume', String(msg.sessionId));

  const env = { ...process.env, ...CLAUDE_ENV };
  delete env.ANTHROPIC_API_KEY; // never bypass the subscription (not even via config.env)
  env.CLAWDIFY_LIVE = '0'; // our own runs shouldn't summon the Live Clawd hooks
  if (CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIR; // run under the chosen account profile

  const state = { session: msg.sessionId || null, result: '', cost: 0, edits: 0, transcript: [], error: null };
  let child;
  try {
    child = spawn(CLAUDE_BIN, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    tools.close();
    sendMessage({ type: 'done', requestId, error: `Failed to launch claude (${CLAUDE_BIN}): ${e.message}` });
    return;
  }

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', line => {
    line = line.trim();
    if (!line) return;
    bumpStall();
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    relay(ev, requestId, state);
  });

  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); bumpStall(); });

  /** Send the single `done` for this request, whoever gets there first. */
  let replied = false;
  function finish(code, error) {
    if (replied) return;
    replied = true;
    clearTimeout(stallTimer);
    tools.close();
    let script = null;
    try { script = fs.readFileSync(scriptPath, 'utf8'); } catch {}
    writeRunLog(msg, domain, state, { script, exitCode: code, error });
    sendMessage({
      type: 'done',
      requestId,
      exitCode: code,
      script,
      sessionId: state.session,
      summary: state.result,
      cost: state.cost,
      sawEdit: state.edits > 0,
      error,
    });
  }

  const withStderr = m => {
    const tail = stderr.trim().slice(-2000);
    return tail ? `${m}\n\nclaude stderr:\n${tail}` : m;
  };

  // Watchdog: any output resets it; running out means claude is stuck on something we
  // cannot see or answer from here, so report immediately and kill it. We deliberately
  // don't wait for the process to close first — a wedged child can leave a grandchild
  // holding the stdio pipes open, in which case 'close' never fires and we'd hang on
  // exactly the case this exists to catch.
  let stallTimer = null;
  function bumpStall() {
    clearTimeout(stallTimer);
    if (!(STALL_TIMEOUT_MS > 0)) return;
    stallTimer = setTimeout(() => {
      finish(null, withStderr(
        `claude produced no output for ${Math.round(STALL_TIMEOUT_MS / 1000)}s and was terminated.`
        + ' It is most likely blocked on something that cannot be answered from here —'
        + ' a login/credential prompt, or on macOS a keychain authorization dialog.'
        + ' Reproduce it outside Firefox with: node bridge/test-client.js "test" example.com',
      ));
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 2000).unref();
    }, STALL_TIMEOUT_MS);
  }
  bumpStall();

  child.on('error', err => {
    finish(null, `Failed to launch claude (${CLAUDE_BIN}): ${err.message}`);
  });

  child.on('close', code => {
    let error;
    // A failed run can still exit 0, so the result event outranks the exit code.
    if (state.error) error = withStderr(state.error);
    else if (code) error = stderr.trim().slice(-2000) || `claude exited with code ${code}`;
    finish(code, error);
  });
}

/**
 * Append a distilled, human-skimmable log of one pass — prompt, narration + tool
 * summaries (no raw tool I/O), result, cost, and the resulting userscript — under
 * logs/runs/<domain>/. Best-effort; never blocks or fails the response.
 */
function writeRunLog(msg, domain, state, { script, exitCode, error }) {
  try {
    const dir = path.join(FEEDBACK_DIR, 'runs', safeDomain(domain));
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const short = String(msg.requestId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'run';

    const transcript = state.transcript.length
      ? state.transcript.map(t => (
        t.kind === 'tool' ? `- ⚙ **${t.name}** — ${t.summary}` : `- 💬 ${t.text.trim()}`
      )).join('\n')
      : '_(no narration or tool calls)_';

    const body = [
      `# ${msg.domain || domain} — ${now.toISOString()}`,
      '',
      `- URL: ${msg.url || '(unknown)'}`,
      `- Request: ${msg.requestId || '(none)'}`,
      `- Session: ${state.session || '(none)'}`,
      `- Cost: ${state.cost ? `$${state.cost.toFixed(4)}` : '$0'}`,
      `- Outcome: ${error ? `error — ${error.split('\n')[0]}` : `ok (exit ${exitCode})`}`,
      '',
      '## Prompt',
      '',
      (msg.prompt || '(default prompt)').trim(),
      '',
      '## Transcript',
      '',
      transcript,
      '',
      '## Result',
      '',
      (state.result || '(no summary)').trim(),
      '',
      '## Final userscript',
      '',
      '```js',
      script != null ? script.replace(/\r?\n$/, '') : '(could not read userscript.user.js)',
      '```',
      '',
    ].join('\n');

    fs.writeFileSync(path.join(dir, `${stamp}-${short}.md`), body);
  } catch { /* logging is best-effort */ }
}

function relay(ev, requestId, state) {
  if (ev.type === 'system' && ev.subtype === 'init') {
    state.session = ev.session_id || state.session;
    sendMessage({ type: 'session', requestId, sessionId: state.session });
  } else if (ev.type === 'assistant') {
    const content = (ev.message && ev.message.content) || [];
    for (const c of content) {
      if (c.type === 'text' && c.text) {
        state.transcript.push({ kind: 'narration', text: c.text });
        sendMessage({ type: 'narration', requestId, text: c.text });
      } else if (c.type === 'tool_use') {
        if (c.name === 'Edit' || c.name === 'Write') state.edits += 1;
        const summary = summarizeTool(c);
        state.transcript.push({ kind: 'tool', name: c.name, summary });
        sendMessage({ type: 'tool', requestId, name: c.name, summary, detail: toolDetail(c) });
      }
    }
  } else if (ev.type === 'result') {
    state.result = ev.result || state.result;
    state.cost = ev.total_cost_usd || state.cost;
    // Some failures (a bad/expired credential, for one) are reported here while the
    // process still exits 0 and writes nothing to stderr, so don't trust the exit code
    // alone — otherwise "Not logged in · Please run /login" arrives as a cheerful
    // success whose "userscript" is the untouched scaffold.
    if (ev.is_error) {
      state.error = String(ev.result || ev.api_error_status || 'claude reported an error').trim();
    }
  }
}
