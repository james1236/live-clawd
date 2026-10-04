/**
 * Live Clawd: while a Claude Code session in WSL works on a project whose dev server is
 * open in Firefox (http://localhost:<port>), Clawd acts out what it's doing on that
 * page. Purely cosmetic — it reads Claude Code hook events relayed by the bridge
 * (bridge/live-hook.sh -> host.js "live" mode) and never talks to Claude.
 *
 * Only the visible tab of each window is animated, one Clawd per Claude session.
 */
import { addOwnCommands } from './init';
import { busyTabIds, clawdNow } from './ai';
import { classifyChange, classifyTool, MOOD_LABEL } from '@/common/clawd-actions';

const HOST_NAME = 'claudemonkey.bridge';
const KEY = 'clawdifyLive';
const MIN_DWELL_MS = 1100; // show each action at least this long, so bursts don't jitter
const RECENT_MS = 90000; // re-show a session's Clawd on tab switch/reload within this
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

let settings = { enabled: true, muted: [] };
let port = null;
let retryMs = 5000;
let retryTimer = 0;
/** @type {Map<string, {ports: number[], last: object, at: number}>} session -> state */
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
  retryMs = Math.min(retryMs * 2, 300000);
}

function disconnect() {
  clearTimeout(retryTimer);
  if (port) { try { port.disconnect(); } catch { /* gone */ } }
  port = null;
}

/** Turn a hook event into an overlay message. */
function toOverlay(ev) {
  // "3 claude" -> window 3, named "claude"
  const [win, ...name] = String(ev.tmux || '').split(' ');
  const where = win ? `tmux window ${win}${name.length ? ` (${name.join(' ')})` : ''}` : '';
  const base = { id: `live:${ev.session}`, tag: win ? `${ev.project} · tmux ${win}` : ev.project, live: true };
  switch (ev.event) {
  case 'PostToolUse':
    // What really changed on disk, however Claude edited it.
    return { ...base, op: 'act', ...classifyChange(ev.changes[0]) };
  case 'UserPromptSubmit':
    return { ...base, op: 'act', kind: 'think', selectors: [], label: ev.message ? `On it: “${ev.message}”` : 'New request!' };
  case 'PreToolUse': {
    const a = classifyTool(ev.tool, ev.detail, ev.file || '');
    // Claude's own narration is the best caption when the action itself is generic.
    if (ev.say && ['think', 'read', 'tinker', 'hack'].includes(a.kind)) a.label = ev.say;
    return { ...base, op: 'act', ...a };
  }
  case 'Notification':
    return {
      ...base,
      op: 'act',
      kind: 'wave',
      selectors: [],
      sign: win ? `#${win}` : '!?',
      label: `${ev.message || MOOD_LABEL.wave}${where ? ` — ${where}` : ''}`,
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
  const msg = toOverlay(ev);
  if (!msg) return;
  // Remember the latest action so the Clawd can reappear after a reload or tab switch.
  if (msg.op === 'leave') sessions.delete(ev.session);
  else sessions.set(ev.session, { ports: ev.ports, last: msg.op === 'act' ? msg : null, at: Date.now() });
  for (const t of await targetTabs(ev.ports)) deliver(t.id, msg);
}

/** Bring a session's Clawd back when its page is reloaded or switched to. */
async function replay(tab) {
  if (!settings.enabled || !tab || !tab.active) return;
  const o = originOf(tab.url);
  if (!o || settings.muted.includes(o.origin) || busyTabIds().has(tab.id)) return;
  for (const s of sessions.values()) {
    if (s.last && Date.now() - s.at < RECENT_MS && s.ports.includes(o.port)) deliver(tab.id, s.last);
  }
}

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try { replay(await browser.tabs.get(tabId)); } catch { /* closed */ }
});
browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') replay(tab);
});
browser.tabs.onRemoved.addListener(tabId => {
  for (const key of lanes.keys()) if (key.startsWith(`${tabId}|`)) lanes.delete(key);
});

async function setEnabled(enabled) {
  settings.enabled = !!enabled;
  await save();
  if (settings.enabled) { retryMs = 5000; connect(); } else {
    disconnect();
    for (const t of await browser.tabs.query({})) if (originOf(t.url)) clawdNow(t.id, { op: 'hide' });
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
