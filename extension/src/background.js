/**
 * Live Clawd's background: connects to the Claude Code plugin's bridge on
 * ws://127.0.0.1:47215 and, while a Claude Code session works on a project whose dev
 * server is open here (http://localhost:<port>), has Clawd act out what it's doing on
 * that page. Two sources, both relayed by the bridge:
 *  - choreography Claude itself sends with the `clawd` tool, in the same message as a
 *    UI edit: where the change shows up and how to act it out;
 *  - Claude Code hook events, as a fallback: guesses from the tool calls and the
 *    on-disk diff, used while no choreography is playing.
 *
 * Only the visible tab of each window is animated, one Clawd per Claude session, in the
 * colour of its tmux window.
 *
 * Firefox runs this as a persistent background page (MV2); Chrome as a service worker
 * (MV3), kept alive by the WebSocket's pings, with sounds played from an offscreen page.
 */
import { api, FIREFOX } from './api';
import { classifyChange, classifyTool, MOOD_LABEL } from './clawd-actions';
import { playSound } from './clawd-sound';

const BRIDGE = 'ws://127.0.0.1:47215/';
const KEY = 'liveClawd';
const MIN_DWELL_MS = 1800; // a guessed action shows at least this long
const COLORS = ['#d97757', '#5b8fd9', '#4fa36b', '#a777d6', '#d9a13b', '#d0607e', '#3fa8a8', '#8a8f3c'];
/** `clawd` tool actions -> overlay moods */
const ACTION_KIND = { vacuum: 'remove' };
const RECENT_MS = 90000; // re-show a session's Clawd on tab switch/reload within this
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;
const ALL_URLS = { origins: ['<all_urls>'] }; // optional: lets him take "before" pictures
const ICON = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
const ICON_ASLEEP = Object.fromEntries(Object.entries(ICON).map(([k, v]) => [k, v.replace('.png', '-asleep.png')]));

let settings = { enabled: true, muted: [], sound: true, volume: 0.35 };
let ws = null;
let retryMs = 1000;
let retryTimer = 0;
let pingTimer = 0;
/** @type {Map<string, {ports: number[], last: object, at: number, choreoUntil: number}>} session -> state */
const sessions = new Map();
/** @type {Map<string, {at: number, timer: *, pending: object[]}>} "tabId|session" -> pacing */
const lanes = new Map();
/** Dev-server ports the bridge has reported for a Claude session (this browser session). */
const knownPorts = new Set();
const ready = load();

async function load() {
  try {
    settings = { ...settings, ...(await api.storage.local.get(KEY))[KEY] };
  } catch { /* defaults */ }
}

const save = () => api.storage.local.set({ [KEY]: settings });

function originOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || !LOOPBACK.test(u.hostname)) return null;
    return { origin: u.origin, port: +u.port || (u.protocol === 'https:' ? 443 : 80) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------------------
function connect() {
  clearTimeout(retryTimer);
  if (ws || !settings.enabled) return;
  try {
    ws = new WebSocket(BRIDGE);
  } catch {
    ws = null;
    scheduleRetry();
    return;
  }
  ws.onopen = () => {
    retryMs = 1000;
    refreshIcons();
    // Pings keep Chrome's service worker alive while connected (and are harmless here).
    pingTimer = setInterval(() => send({ type: 'ping' }), 20000);
  };
  ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg && msg.type === 'live') onEvent(msg);
  };
  ws.onclose = () => {
    ws = null;
    clearInterval(pingTimer);
    refreshIcons();
    scheduleRetry();
  };
}

/** Nobody serves the bridge until a Claude Code session with the plugin starts: keep trying. */
function scheduleRetry() {
  if (!settings.enabled) return;
  retryTimer = setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, 5000);
}

function disconnect() {
  clearTimeout(retryTimer);
  if (ws) { try { ws.close(); } catch { /* gone */ } }
  ws = null;
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

/** Tell a waiting `clawd` call what happened: '' (played) or 'no-tab'. */
function ack(ev, status = '') {
  if (ev.ackId) send({ type: 'ack', ackId: ev.ackId, status });
}

// ---------------------------------------------------------------------------------------
// Events -> Clawd
// ---------------------------------------------------------------------------------------
/** Same colour for the same tmux window everywhere; else stable per session. */
function colorFor(win, session) {
  if (/^\d+$/.test(win || '')) return COLORS[+win % COLORS.length];
  let h = 0;
  for (const ch of String(session)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

/** Turn a bridge event into overlay message(s). */
function toOverlay(ev) {
  // "3 claude" -> window 3, named "claude"
  const [win] = String(ev.tmux || '').trim().split(/\s+/);
  const base = {
    id: `live:${ev.session}`,
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
    // He forks a baby off himself to do it, and takes its results back.
    return { ...base, op: 'helper', on: ev.event === 'SubagentStart', agentId: ev.agentId, label: ev.agentType };
  case 'PreCompact':
    return { ...base, op: 'act', kind: 'compact', selectors: [], label: MOOD_LABEL.compact, hold: true, toolId: 'compact' };
  case 'PostCompact':
    return { ...base, op: 'end', toolId: 'compact', ok: true };
  case 'Notification':
    return {
      ...base, op: 'act', kind: 'wave', selectors: [],
      sign: win ? `#${win}` : '!?',
      label: ev.message || MOOD_LABEL.wave,
    };
  case 'Stop':
    return { ...base, op: 'done' };
  case 'SessionEnd':
    return { ...base, op: 'leave' };
  default:
    return null;
  }
}

/** The visible tabs (one per window) showing one of these dev-server ports. */
async function targetTabs(ports) {
  const tabs = await api.tabs.query({ active: true });
  return tabs.filter(t => {
    const o = originOf(t.url);
    return o && ports.includes(o.port) && !settings.muted.includes(o.origin);
  });
}

async function onEvent(ev) {
  await ready;
  if (ev.ports && ev.ports.some(p => !knownPorts.has(p))) {
    ev.ports.forEach(p => knownPorts.add(p));
    refreshIcons();
  }
  const out = toOverlay(ev);
  if (!out) { ack(ev); return; }
  for (const m of [].concat(out)) await onMessage(ev, m);
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

/**
 * Hand a choreography to the dev tab(s), take "before" pictures of what it's about to
 * change (so hot reload happens unseen under them until Clawd gets there), then release
 * the waiting `clawd` call - which lets Claude's edit go ahead.
 */
async function play(ev, msg) {
  let tabs = [];
  try {
    tabs = await targetTabs(ev.ports);
    const canCapture = await api.permissions.contains(ALL_URLS).catch(() => false);
    for (const t of tabs) {
      const res = await clawdNow(t.id, msg);
      if (!canCapture || !res || !res.ghosts || !res.ghosts.length) continue;
      try {
        // Keep the Clawds themselves out of the picture: whatever of them overlaps
        // these spots steps aside until the next paint has been shot.
        const rects = res.ghosts.map(g => g.rect);
        await clawdNow(t.id, { op: 'peek', on: true, rects });
        await api.scripting.executeScript({
          target: { tabId: t.id },
          func: () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))),
        }).catch(() => {});
        let imgs;
        try {
          imgs = await cropVisible(t.windowId, rects, res.dpr);
        } finally {
          clawdNow(t.id, { op: 'peek', on: false });
        }
        clawdNow(t.id, { op: 'ghosts', id: msg.id, ghosts: res.ghosts.map((g, i) => ({ ...g, src: imgs[i] })) });
      } catch { /* no picture: he vacuums an empty spot */ }
    }
  } finally {
    ack(ev, tabs.length ? '' : 'no-tab');
  }
}

/** Send `msg` to the tab's overlay (injecting it first); resolves with its answer, or null. */
async function clawdNow(tabId, msg) {
  try {
    const target = { tabId };
    // Chrome: React components can only be found from the page's own world.
    if (!FIREFOX) await api.scripting.executeScript({ target, files: ['probe.js'], world: 'MAIN' });
    await api.scripting.executeScript({ target, files: ['overlay.js'] });
    const [res] = await api.scripting.executeScript({
      target,
      func: m => (window.__cmClawd ? window.__cmClawd(m) || null : null),
      args: [msg],
    });
    return res ? res.result : null;
  } catch {
    return null; // a restricted page, a closed tab...
  }
}

/** Screenshot the visible tab and cut out `rects` (CSS px) as PNG data URLs. */
async function cropVisible(windowId, rects, dpr = 1) {
  const shot = await api.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(shot)).blob());
  return Promise.all(rects.map(async r => {
    try {
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext('2d').drawImage(bmp, Math.round(r.left * dpr), Math.round(r.top * dpr), w, h, 0, 0, w, h);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:image/png;base64,${btoa(bin)}`;
    } catch {
      return '';
    }
  }));
}

/** Bring a session's Clawd back when its page is reloaded or switched to. */
async function replay(tab) {
  await ready;
  if (!settings.enabled || !tab || !tab.active) return;
  const o = originOf(tab.url);
  if (!o || settings.muted.includes(o.origin)) return;
  for (const s of [...sessions.values()]) {
    if (s.last && Date.now() - s.at < RECENT_MS && s.ports.includes(o.port)) deliver(tab.id, s.last);
  }
}

api.tabs.onActivated.addListener(async ({ tabId }) => {
  try { replay(await api.tabs.get(tabId)); } catch { /* closed */ }
});
api.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') replay(tab);
  if (info.url || info.status === 'complete') setIcon(tab);
});

// ---------------------------------------------------------------------------------------
// The toolbar icon: awake only on a tab Clawd acts on (a localhost dev server of one of your
// Claude sessions, with Live Clawd on, connected, and not muted there); asleep elsewhere.
// ---------------------------------------------------------------------------------------
const action = api.action || api.browserAction;

/** Why Clawd is asleep on this tab, or '' if he acts here. */
function inactiveReason(url) {
  const o = originOf(url);
  if (!settings.enabled) return 'Turned off';
  if (!o) return 'Not a localhost dev page';
  if (!ws || ws.readyState !== 1) return 'Waiting for Claude Code';
  if (settings.muted.includes(o.origin)) return 'Muted on this site';
  if (!knownPorts.has(o.port)) return 'No Claude session is working on this dev server';
  return '';
}

function setIcon(tab) {
  if (!tab || tab.id == null) return;
  const why = inactiveReason(tab.url);
  action.setIcon({ tabId: tab.id, path: why ? ICON_ASLEEP : ICON }).catch(() => {});
  action.setTitle({ tabId: tab.id, title: why ? `Live Clawd: ${why.toLowerCase()}` : 'Live Clawd: on this page' }).catch(() => {});
}

async function refreshIcons() {
  await ready;
  for (const t of await api.tabs.query({}).catch(() => [])) setIcon(t);
}
api.tabs.onRemoved.addListener(tabId => {
  for (const key of [...lanes.keys()]) if (key.startsWith(`${tabId}|`)) lanes.delete(key);
});

// ---------------------------------------------------------------------------------------
// Sounds: played here (Firefox) or from an offscreen page (Chrome's service worker has
// no audio), never by the web page, so its autoplay rules don't apply.
// ---------------------------------------------------------------------------------------
const lastPlayed = new Map();
let offscreen = null;

async function sound(name) {
  const now = Date.now();
  if (now - (lastPlayed.get(name) || 0) < 45) return; // several Clawds shouldn't stack into a din
  lastPlayed.set(name, now);
  if (FIREFOX) { playSound(name, settings.volume); return; }
  offscreen = offscreen || api.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Clawd\'s sound effects',
  }).catch(() => {}); // already open
  await offscreen;
  api.runtime.sendMessage({ cmd: 'OffscreenSound', data: { name, volume: settings.volume } }).catch(() => {});
}

// ---------------------------------------------------------------------------------------
// Settings, the popup, and messages from the overlay
// ---------------------------------------------------------------------------------------
async function setEnabled(enabled) {
  settings.enabled = !!enabled;
  await save();
  refreshIcons();
  if (settings.enabled) { retryMs = 1000; connect(); } else {
    disconnect();
    for (const t of await api.tabs.query({})) if (originOf(t.url)) clawdNow(t.id, { op: 'hide', final: true });
  }
}

const commands = {
  /** From the overlay: one of Clawd's sounds (only for the tab you're looking at). */
  ClawdSound({ name } = {}, src) {
    if (!settings.sound || (src && src.tab && !src.tab.active)) return;
    sound(String(name));
  },
  /** From the overlay: a Clawd left the page (dismissed = clicked away while waving). */
  ClawdGone({ id, dismissed } = {}, src) {
    if (!dismissed || !String(id).startsWith('live:')) return;
    // Don't bring him back until Claude has something new.
    const s = sessions.get(String(id).slice(5));
    if (s && s.last && s.last.kind === 'wave') s.last = null;
    const lane = lanes.get(`${src && src.tab && src.tab.id}|${id}`);
    if (lane) lane.pending = [];
  },
  /** For the popup: settings, the connection, and whether `url` is a muted dev page. */
  async LiveGet({ url } = {}) {
    await ready;
    const o = originOf(url);
    return {
      enabled: settings.enabled, sound: settings.sound, connected: !!ws && ws.readyState === 1,
      local: !!o, muted: !!o && settings.muted.includes(o.origin),
      capture: await api.permissions.contains(ALL_URLS).catch(() => false),
    };
  },
  async LiveSet({ enabled, sound: soundOn, url, muted } = {}) {
    await ready;
    if (enabled != null) await setEnabled(enabled);
    if (soundOn != null) {
      settings.sound = !!soundOn;
      await save();
      if (soundOn) sound('boop');
    }
    const o = originOf(url);
    if (o && muted != null) {
      settings.muted = settings.muted.filter(x => x !== o.origin);
      if (muted) settings.muted.push(o.origin);
      await save();
      refreshIcons();
    }
  },
};

api.runtime.onMessage.addListener((msg, sender, respond) => {
  const fn = msg && commands[msg.cmd];
  if (!fn) return undefined;
  Promise.resolve(fn(msg.data, sender)).then(respond, () => respond(null));
  return true; // answering asynchronously
});

api.commands?.onCommand.addListener(cmd => {
  if (cmd === 'toggle-live') setEnabled(!settings.enabled);
});

ready.then(() => { connect(); refreshIcons(); });
