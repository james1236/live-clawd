/**
 * Live Clawd: while a Claude Code session in WSL works on a project whose dev server is
 * open in Firefox (http://localhost:<port>), Clawd acts out what it's doing on that
 * page. Two sources, both relayed by the bridge's "live" mode:
 *  - choreography Claude itself sends with the `clawd` tool (bridge/clawd-mcp.js), in
 *    the same message as a UI edit: where the change shows up and how to act it out;
 *  - Claude Code hook events (bridge/live-hook.sh), as a fallback: guesses from the tool
 *    calls and the on-disk diff, used while no choreography is playing.
 *
 * Only the visible tab of each window is animated, one Clawd per Claude session, in the
 * colour of its tmux window.
 */
import { addOwnCommands } from './init';
import { busyTabIds, clawdNow, onClawdDismissed } from './ai';
import { cropVisible } from './tab-tools';
import { classifyChange, classifyTool, MOOD_LABEL } from '@/common/clawd-actions';

const HOST_NAME = 'claudemonkey.bridge';
const KEY = 'clawdifyLive';
const MIN_DWELL_MS = 1800; // a guessed action shows at least this long
const COLORS = ['#d97757', '#5b8fd9', '#4fa36b', '#a777d6', '#d9a13b', '#d0607e', '#3fa8a8', '#8a8f3c'];
/** `clawd` tool actions -> overlay moods */
const ACTION_KIND = { vacuum: 'remove' };
const RECENT_MS = 90000; // re-show a session's Clawd on tab switch/reload within this
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

let settings = { enabled: true, muted: [] };
let port = null;
let retryMs = 5000;
let retryTimer = 0;
/** @type {Map<string, {ports: number[], last: object, at: number, choreoUntil: number}>} session -> state */
const sessions = new Map();
/** @type {Map<string, {at: number, timer: *, pending: object[]}>} "tabId|session" -> pacing */
const lanes = new Map();

function originOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || !LOOPBACK.test(u.hostname)) return null;
    return { origin: u.origin, port: +u.port || (u.protocol === 'https:' ? 443 : 80) };
  } catch {
    return null;
  }
}

async function save() {
  await browser.storage.local.set({ [KEY]: settings });
}

function connect() {
  clearTimeout(retryTimer);
  if (port || !settings.enabled) return;
  try {
    port = browser.runtime.connectNative(HOST_NAME);
  } catch {
    port = null;
    scheduleRetry();
    return;
  }
  port.onMessage.addListener(msg => {
    if (msg && msg.type === 'live-ready') retryMs = 5000;
    else if (msg && msg.type === 'live') onEvent(msg);
  });
  port.onDisconnect.addListener(() => {
    port = null;
    scheduleRetry();
  });
  port.postMessage({ type: 'live-subscribe' });
}

function scheduleRetry() {
  if (!settings.enabled) return;
  retryTimer = setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, 30000); // the bridge may just be restarting
}

function disconnect() {
  clearTimeout(retryTimer);
  if (port) { try { port.disconnect(); } catch { /* gone */ } }
  port = null;
}

/** Turn a hook event into an overlay message. */
/** Same colour for the same tmux window everywhere; else stable per session. */
function colorFor(win, session) {
  if (/^\d+$/.test(win || '')) return COLORS[+win % COLORS.length];
  let h = 0;
  for (const ch of String(session)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function toOverlay(ev) {
  // "3 claude" -> window 3, named "claude"
  const [win] = String(ev.tmux || '').trim().split(/\s+/);
  const base = {
    id: `live:${ev.session}`,
    tag: win ? `${ev.project} · tmux ${win}` : ev.project,
    color: colorFor(win, ev.session),
    live: true,
  };
  if (ev.sub) {
    // A subagent's tool call: its baby Clawd acts it out (and goes back to idling after).
    const a = ev.event === 'PreToolUse' ? classifyTool(ev.tool, ev.detail, ev.file || '') : { kind: 'idle' };
    return { ...base, op: 'helper', agentId: ev.agentId, kind: a.kind };
  }
  switch (ev.event) {
  case 'Clawd':
    return {
      ...base,
      op: 'play',
      steps: (ev.steps || []).map(st => ({
        target: st.target || {},
        kind: ACTION_KIND[st.action] || st.action || 'tinker',
        say: String(st.say || '').slice(0, 80),
        color: st.color,
        ms: Math.max(1000, Math.min(6000, st.ms | 0 || 2600)),
      })),
    };
  case 'PostToolUse':
    // The tool finished: end what's been showing since it started (with a reaction if
    // it was something like the tests), then act out what really changed on disk.
    return [
      { ...base, op: 'end', toolId: ev.toolId, ok: !!ev.ok, interrupted: !!ev.interrupted },
      ev.changes && ev.changes.length && { ...base, op: 'act', ...classifyChange(ev.changes[0]) },
    ].filter(Boolean);
  case 'UserPromptSubmit':
    // Thinking until the first tool call (a long think turns into the chalkboard).
    return {
      ...base, op: 'act', kind: 'think', selectors: [], hold: true, toolId: 'prompt',
      label: ev.message ? `On it: “${ev.message}”` : 'New request!',
    };
  case 'PreToolUse': {
    if (ev.bg) return { ...base, op: 'act', kind: 'timer', selectors: [], label: MOOD_LABEL.background };
    const a = classifyTool(ev.tool, ev.detail, ev.file || '');
    // Claude's own narration is the best caption when the action itself is generic.
    if (ev.say && ['think', 'read', 'tinker', 'hack'].includes(a.kind)) a.label = ev.say;
    // Shown until the tool ends, however long that takes.
    return { ...base, op: 'act', ...a, toolId: ev.toolId, hold: !!ev.toolId };
  }
  case 'SubagentStart':
  case 'SubagentStop':
    // A mini Clawd heads off to do it, and comes back with the results.
    return { ...base, op: 'helper', on: ev.event === 'SubagentStart', agentId: ev.agentId, label: ev.agentType };
  case 'PreCompact':
    return { ...base, op: 'act', kind: 'compact', selectors: [], label: MOOD_LABEL.compact, hold: true, toolId: 'compact' };
  case 'PostCompact':
    return { ...base, op: 'end', toolId: 'compact', ok: true };
  case 'Notification':
    return {
      ...base,
      op: 'act',
      kind: 'wave',
      selectors: [],
      sign: win ? `#${win}` : '!?',
      label: ev.message || MOOD_LABEL.wave, // the window is already on his sign and name tag
    };
  case 'Stop':
    return { ...base, op: 'done' };
  case 'SessionEnd':
    return { ...base, op: 'leave' };
  default:
    return null;
  }
}

async function targetTabs(ports) {
  const busy = busyTabIds();
  const tabs = await browser.tabs.query({ active: true });
  return tabs.filter(t => {
    const o = originOf(t.url);
    return o && ports.includes(o.port) && !settings.muted.includes(o.origin) && !busy.has(t.id);
  });
}

/** Deliver to one tab, at most one action per MIN_DWELL_MS per Clawd. */
function deliver(tabId, msg) {
  const key = `${tabId}|${msg.id}`;
  let lane = lanes.get(key);
  if (!lane) lanes.set(key, lane = { at: 0, timer: 0, pending: [] });
  // Only the newest 'act' matters; done/leave/wave always go through, in order.
  if (msg.op === 'act' && msg.kind !== 'wave') lane.pending = lane.pending.filter(m => m.op !== 'act' || m.kind === 'wave');
  lane.pending.push(msg);
  const pump = () => {
    lane.timer = 0;
    const next = lane.pending.shift();
    if (!next) return;
    lane.at = Date.now();
    clawdNow(tabId, next);
    if (lane.pending.length) lane.timer = setTimeout(pump, MIN_DWELL_MS);
  };
  if (!lane.timer) {
    const wait = lane.at + MIN_DWELL_MS - Date.now();
    if (wait > 0) lane.timer = setTimeout(pump, wait);
    else pump();
  }
}

async function onEvent(ev) {
  const out = toOverlay(ev);
  if (!out) { ack(ev); return; }
  if (Array.isArray(out)) {
    for (const m of out) await onMessage(ev, m);
    return;
  }
  await onMessage(ev, out);
}

async function onMessage(ev, msg) {
  const st = sessions.get(ev.session);
  if (msg.op === 'end' || msg.op === 'helper') {
    // Straight through, not paced: an end must never wait behind the next action.
    if (msg.op === 'end' && st && st.last && st.last.toolId === msg.toolId) st.last = { ...st.last, hold: false };
    for (const t of await targetTabs(ev.ports)) clawdNow(t.id, msg);
    return;
  }
  if (msg.op === 'play') {
    const total = msg.steps.reduce((t, x) => t + x.ms, 0);
    // Claude's own choreography outranks the guesses from hooks while it plays.
    if (st) st.choreoUntil = Date.now() + total + 4000;
    else sessions.set(ev.session, { ports: ev.ports, last: null, at: Date.now(), choreoUntil: Date.now() + total + 4000 });
    await play(ev, msg);
    return;
  }
  if (msg.op === 'act' && msg.kind !== 'wave' && st && st.choreoUntil > Date.now()) return;
  // Remember the latest action so the Clawd can reappear after a reload or tab switch.
  if (msg.op === 'leave') sessions.delete(ev.session);
  else sessions.set(ev.session, { ...st, ports: ev.ports, last: msg.op === 'act' ? msg : null, at: Date.now() });
  for (const t of await targetTabs(ev.ports)) deliver(t.id, msg);
}

function ack(ev, status = '') {
  if (ev.ackId && port) {
    try { port.postMessage({ type: 'live-ack', ackId: ev.ackId, status }); } catch { /* gone */ }
  }
}

/**
 * Hand a choreography to the dev tab(s), snapshot anything it's about to remove (so the
 * vacuuming is still visible after hot reload deletes it), then release the waiting
 * `clawd` tool call — which lets Claude's edit go ahead.
 */
async function play(ev, msg) {
  let tabs = [];
  try {
    tabs = await targetTabs(ev.ports);
    for (const t of tabs) {
      const res = await clawdNow(t.id, msg);
      if (res && res.ghosts && res.ghosts.length) {
        try {
          // Keep the Clawds themselves out of the "before" picture: whatever of them
          // overlaps these spots steps aside until the next paint has been shot.
          const rects = res.ghosts.map(g => g.rect);
          await clawdNow(t.id, { op: 'peek', on: true, rects });
          await browser.tabs.executeScript(t.id, {
            code: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))',
          }).catch(() => {});
          let imgs;
          try {
            imgs = await cropVisible(t.windowId, rects, res.dpr);
          } finally {
            clawdNow(t.id, { op: 'peek', on: false });
          }
          clawdNow(t.id, { op: 'ghosts', id: msg.id, ghosts: res.ghosts.map((g, i) => ({ ...g, src: imgs[i] })) });
        } catch { /* no snapshot: he vacuums an empty spot */ }
      }
    }
  } finally {
    ack(ev, tabs.length ? '' : 'no-tab');
  }
}

/** Bring a session's Clawd back when its page is reloaded or switched to. */
async function replay(tab) {
  if (!settings.enabled || !tab || !tab.active) return;
  const o = originOf(tab.url);
  if (!o || settings.muted.includes(o.origin) || busyTabIds().has(tab.id)) return;
  for (const s of [...sessions.values()]) {
    if (s.last && Date.now() - s.at < RECENT_MS && s.ports.includes(o.port)) deliver(tab.id, s.last);
  }
}

// Clicked away while waving: don't bring him back until Claude has something new.
onClawdDismissed((tabId, id) => {
  if (!id.startsWith('live:')) return;
  const s = sessions.get(id.slice(5));
  if (s && s.last && s.last.kind === 'wave') s.last = null;
  const lane = lanes.get(`${tabId}|${id}`);
  if (lane) lane.pending = [];
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try { replay(await browser.tabs.get(tabId)); } catch { /* closed */ }
});
browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') replay(tab);
});
browser.tabs.onRemoved.addListener(tabId => {
  for (const key of [...lanes.keys()]) if (key.startsWith(`${tabId}|`)) lanes.delete(key);
});

async function setEnabled(enabled) {
  settings.enabled = !!enabled;
  await save();
  if (settings.enabled) { retryMs = 5000; connect(); } else {
    disconnect();
    for (const t of await browser.tabs.query({})) if (originOf(t.url)) clawdNow(t.id, { op: 'hide', final: true });
  }
}

browser.commands?.onCommand.addListener(cmd => {
  if (cmd === 'toggleClawdLive') setEnabled(!settings.enabled);
});

addOwnCommands({
  /** Live Clawd settings plus whether `url` (the popup's tab) is a muted local dev page. */
  ClawdLiveGet({ url } = {}) {
    const o = originOf(url);
    return { enabled: settings.enabled, connected: !!port, local: !!o, muted: !!o && settings.muted.includes(o.origin) };
  },
  async ClawdLiveSet({ enabled, url, muted } = {}) {
    if (enabled != null) await setEnabled(enabled);
    const o = originOf(url);
    if (o && muted != null) {
      settings.muted = settings.muted.filter(x => x !== o.origin);
      if (muted) settings.muted.push(o.origin);
      await save();
    }
  },
});

(async () => {
  try {
    settings = { ...settings, ...(await browser.storage.local.get(KEY))[KEY] };
  } catch { /* defaults */ }
  connect();
})();
