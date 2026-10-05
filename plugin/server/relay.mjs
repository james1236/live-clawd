/**
 * What a Claude Code event means for Clawd: which project it's about, which localhost dev
 * server(s) that project has running (so the extension knows which tabs to animate), and
 * the details the overlay needs - the tool call, what really changed on disk, how a
 * command ended, subagents, compaction, the session's tmux window.
 *
 * Input is either a hook event `{tmux, pane, hook: <Claude Code hook JSON>}` (hook.mjs) or a
 * choreography `{clawd: true, cwd, tmux, pane, steps, ackId}` (the `clawd` tool).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
/** Optional: {"projects": {"~/app": ["http://localhost:3000"]}, "ignore": ["~/scratch"]} */
const CONFIG = path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'live-clawd', 'config.json');

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const expand = p => path.resolve(String(p).replace(/^~(?=$|\/)/, HOME));
    const projects = {};
    for (const [k, v] of Object.entries(c.projects || {})) projects[expand(k)] = v;
    return { projects, ignore: (c.ignore || []).map(expand) };
  } catch {
    return { projects: {}, ignore: [] };
  }
}

const BRIDGE_PORT = +process.env.CLAWD_PORT || 47215;

const run = (cmd, args, timeout = 1500) => execFileSync(cmd, args, {
  encoding: 'utf8', timeout, maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'ignore'],
});

const rootCache = new Map();
function projectRoot(cwd) {
  if (!rootCache.has(cwd)) {
    let root = cwd;
    try { root = run('git', ['-C', cwd, 'rev-parse', '--show-toplevel']).trim() || cwd; } catch { /* not a repo */ }
    rootCache.set(cwd, root);
  }
  return rootCache.get(cwd);
}

const inside = (p, root) => p === root || p.startsWith(`${root}/`);
const LOOPBACK = /^(127\.|\[::1\]|\*|0\.0\.0\.0|\[::\]|\[::ffff:127|localhost)/;

/** Linux: `ss`, with each listener's cwd and command line from /proc. */
function linuxListeners() {
  const list = [];
  for (const line of run('ss', ['-ltnpH']).split('\n')) {
    const local = line.trim().split(/\s+/)[3] || '';
    const host = local.slice(0, local.lastIndexOf(':'));
    const port = +local.slice(local.lastIndexOf(':') + 1);
    if (!port || !LOOPBACK.test(host)) continue;
    for (const m of line.matchAll(/pid=(\d+)/g)) {
      let cwd = '';
      let cmd = '';
      try { cwd = fs.readlinkSync(`/proc/${m[1]}/cwd`); } catch { /* gone */ }
      try { cmd = fs.readFileSync(`/proc/${m[1]}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { /* gone */ }
      list.push({ port, cwd, cmd });
    }
  }
  return list;
}

/** macOS: `lsof` for listeners, their cwd and command. */
function macListeners() {
  const list = [];
  let pid = 0;
  const seen = new Map();
  for (const line of run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']).split('\n')) {
    if (line[0] === 'p') pid = +line.slice(1);
    else if (line[0] === 'n' && pid) {
      const addr = line.slice(1);
      const host = addr.slice(0, addr.lastIndexOf(':'));
      const port = +addr.slice(addr.lastIndexOf(':') + 1);
      if (!port || !LOOPBACK.test(host)) continue;
      if (!seen.has(pid)) {
        let cwd = '';
        let cmd = '';
        try { cwd = (run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find(l => l[0] === 'n') || '').slice(1); } catch { /* gone */ }
        try { cmd = run('ps', ['-o', 'command=', '-p', String(pid)]).trim(); } catch { /* gone */ }
        seen.set(pid, { cwd, cmd });
      }
      list.push({ port, ...seen.get(pid) });
    }
  }
  return list;
}

/** Loopback/wildcard TCP listeners with the cwd and command line of their process. */
let portsCache = { at: 0, list: [] };
function listeners() {
  if (Date.now() - portsCache.at < 4000) return portsCache.list;
  let list = [];
  try { list = process.platform === 'darwin' ? macListeners() : linuxListeners(); } catch { /* no ss/lsof */ }
  portsCache = { at: Date.now(), list };
  return list;
}

/** Dev-server ports for a project: config entries plus listeners running from it. */
function devPorts(root, cfg) {
  const ports = new Set();
  for (const [proj, urls] of Object.entries(cfg.projects)) {
    if (!inside(root, proj) && !inside(proj, root)) continue;
    for (const u of [].concat(urls)) {
      try { ports.add(+new URL(u).port || 80); } catch { /* bad url */ }
    }
  }
  // A session started in your home folder (or /) isn't "a project": it would claim every
  // dev server you run. Those only get what the config lists.
  if (![HOME, path.dirname(HOME), '/'].includes(root)) {
    for (const l of listeners()) {
      if ((l.cwd && inside(l.cwd, root)) || l.cmd.includes(`${root}/`)) ports.add(l.port);
    }
  }
  ports.delete(BRIDGE_PORT); // the bridge itself is no dev server
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

/**
 * What a tool call touched: the edited code (so the overlay can tell a colour change from
 * a layout change and find the selectors), the grep pattern, the command, the file read.
 */
function toolDetail(name, input = {}) {
  let d = '';
  if (name === 'Edit') d = input.new_string;
  else if (name === 'MultiEdit') d = (input.edits || []).map(e => e && e.new_string).join('\n');
  else if (name === 'Write') d = input.content;
  else if (name === 'Grep') d = input.pattern;
  else if (name === 'Read') d = input.file_path ? path.basename(input.file_path) : '';
  else if (name === 'Bash') d = input.command;
  return String(d || '').slice(0, 8000);
}

/**
 * Did a command that exited 0 still fail? (`pnpm test 2>&1 | tail` exits with tail's
 * status.) Looks at the end of its output for the usual failure summaries.
 */
function looksFailed(res) {
  if (!res || typeof res !== 'object') return false;
  const tail = `${String(res.stdout || '').slice(-3000)}\n${String(res.stderr || '').slice(-1500)}`;
  return /\b[1-9]\d* (failed|failing|errors?)\b|\bTests?:.*\b[1-9]\d* failed|\bFAIL(ED)?\b|npm ERR!|ERR_PNPM|error TS\d+|Build failed|Command failed with exit code [1-9]|✖ [1-9]\d* problems?/.test(tail);
}

// --- What actually changed on disk (however Claude edited: Edit, sed, python, git…) ---
const SOURCE_FILE = /\.(tsx?|jsx?|vue|svelte|astro|html?|css|scss|sass|less|styl|mdx?)$/i;
/** @type {Map<string, {seen: Map<string, string>, dirty: Set<string>}>} per project root */
const projects = new Map();

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
  if (!st) projects.set(root, st = { seen: new Map(), dirty: new Set() });
  let status;
  try { status = run('git', ['-C', root, 'status', '--porcelain', '-uall'], 2000); } catch { return []; }
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
      try { before = run('git', ['-C', root, 'show', `HEAD:${f}`], 2000); } catch { before = ''; }
    }
    st.seen.set(f, now);
    if (before === now) continue;
    changes.push({ file: f, added: lineDiff(before, now).join('\n').slice(0, 6000), removed: lineDiff(now, before).join('\n').slice(0, 6000) });
  }
  return changes.slice(0, 3);
}

/**
 * Outside tmux, the `clawd` tool can't tell which session it belongs to (Claude Code gives
 * hooks a session id, but not MCP servers): it goes to whichever session most recently
 * sent a hook for the same project.
 */
const lastSession = new Map(); // project root -> session id

/**
 * An event, as the extension takes it (`{session, project, event, ports, tmux, ...}`), or
 * `{status: 'no-server'}` when the project has no dev server running, or null to ignore.
 */
export function relay(ev) {
  let tmux = '';
  let pane = '';
  if (ev && (ev.hook || ev.clawd)) {
    tmux = String(ev.tmux || '');
    pane = String(ev.pane || '');
  }
  const choreo = ev && ev.clawd ? ev : null;
  if (ev && ev.hook && typeof ev.hook === 'object') ev = ev.hook;
  if (!ev || !ev.cwd) return null;
  const root = projectRoot(ev.cwd);
  const cfg = loadConfig();
  if (cfg.ignore.some(p => inside(root, p))) return null;
  const ports = devPorts(root, cfg);
  if (!ports.length) return { status: 'no-server' };
  if (!choreo && ev.session_id) lastSession.set(root, String(ev.session_id));
  const out = {
    // One Clawd per Claude session: its tmux pane when there is one (the `clawd` tool and
    // the hooks both know it), else the session id.
    session: pane || String(choreo ? lastSession.get(root) || root : ev.session_id || root),
    project: path.basename(root),
    event: choreo ? 'Clawd' : ev.hook_event_name,
    ports,
    tmux,
  };
  if (choreo) {
    out.steps = choreo.steps;
    out.ackId = choreo.ackId;
    return out;
  }
  const hookName = ev.hook_event_name || '';
  // A subagent's own tool calls: its baby Clawd acts them out; the main one stays put.
  if (ev.agent_id && /ToolUse/.test(hookName)) {
    out.agentId = String(ev.agent_id);
    out.sub = true;
    if (hookName === 'PreToolUse') {
      const input = ev.tool_input || {};
      out.tool = ev.tool_name;
      out.detail = toolDetail(ev.tool_name, input);
      if (input.file_path) out.file = path.relative(root, String(input.file_path));
    } else {
      out.event = 'PostToolUse';
    }
    return out;
  }
  if (hookName === 'PostToolUse' || hookName === 'PostToolUseFailure') {
    // Ends the action that's been showing since PreToolUse (and says how it went).
    out.event = 'PostToolUse';
    out.tool = ev.tool_name;
    out.toolId = ev.tool_use_id || '';
    out.ok = hookName === 'PostToolUse' && !looksFailed(ev.tool_response);
    out.interrupted = !!ev.is_interrupt || !!(ev.tool_response && ev.tool_response.interrupted);
    // Tools that can touch files: report what really changed on disk.
    out.changes = /^(Bash|Edit|Write|MultiEdit|NotebookEdit)$/.test(ev.tool_name || '') ? scanChanges(root) : [];
    return out;
  }
  if (hookName === 'SubagentStart' || hookName === 'SubagentStop') {
    out.agentId = String(ev.agent_id || '');
    out.agentType = String(ev.agent_type || '').slice(0, 30);
  } else if (hookName === 'PreCompact') {
    out.trigger = String(ev.trigger || '');
  } else if (hookName === 'PreToolUse') {
    const input = ev.tool_input || {};
    out.tool = ev.tool_name;
    out.toolId = ev.tool_use_id || '';
    out.bg = !!input.run_in_background;
    out.detail = toolDetail(ev.tool_name, input);
    if (input.file_path) out.file = path.relative(root, String(input.file_path));
    out.say = lastNarration(ev.transcript_path);
  } else if (hookName === 'Notification') {
    out.message = String(ev.message || '').slice(0, 120);
  } else if (hookName === 'UserPromptSubmit') {
    out.message = String(ev.prompt || '').replace(/\s+/g, ' ').slice(0, 80);
  }
  return out;
}
