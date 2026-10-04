/**
 * Clawdify watches: recurring checks the user approved in the sidebar ("every minute,
 * reload this page and tell me when the status changes"). Each one stores the exact
 * code, URL and interval that were approved; nothing else runs. Stopped from the
 * sidebar (or by Claude via watch_delete).
 */
import { sendCmd } from '@/common';
import { delay, runInTab, waitTabLoaded } from './tab-tools';

const KEY = 'clawdifyWatches';
const MAX_ERRORS = 5;
/** @type {object[]} */
let watches = [];
const timers = new Map();
let loaded;

function load() {
  if (!loaded) {
    loaded = browser.storage.local.get(KEY).then(r => {
      watches = (r[KEY] || []).map(w => ({ ...w, running: false }));
      watches.forEach(schedule);
    }).catch(() => {});
  }
  return loaded;
}

function save() {
  // `running` is runtime-only state.
  return browser.storage.local.set({ [KEY]: watches.map(w => ({ ...w, running: undefined })) });
}

const publicView = w => ({
  id: w.id, name: w.name, domain: w.domain, url: w.url, intervalSec: w.intervalSec,
  tab: w.tab, notifyWhen: w.notifyWhen, last: w.last, lastRun: w.lastRun, error: w.error, paused: !!w.paused,
});

function refreshUi(w) {
  sendCmd('AIEvent', { domain: w.domain, watch: w.id });
}

function notify(w, message) {
  browser.notifications.create(`clawdify-watch-${w.id}-${Date.now()}`, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/public/images/icon128.png'),
    title: `Clawdify · ${w.name}`,
    message: String(message).slice(0, 300),
  });
}

function schedule(w) {
  clearInterval(timers.get(w.id));
  timers.delete(w.id);
  if (w.paused) return;
  timers.set(w.id, setInterval(() => run(w), w.intervalSec * 1000));
}

/** The tab a watch runs in: its own background tab, or the tab it was created from. */
async function tabFor(w) {
  const origin = new URL(w.url).origin;
  if (w.tabId != null) {
    try {
      const t = await browser.tabs.get(w.tabId);
      if (t.url && new URL(t.url).origin === origin) return t;
      // The user navigated that tab elsewhere: never hijack it.
      if (w.tab === 'current') return null;
    } catch { /* closed */ }
  }
  const t = await browser.tabs.create({ url: w.url, active: false });
  w.tabId = t.id;
  await waitTabLoaded(t.id);
  return t;
}

async function run(w) {
  if (w.running || w.paused) return;
  w.running = true;
  try {
    const tab = await tabFor(w);
    if (!tab) { w.error = 'Skipped: the tab is on another site now'; return; }
    await browser.tabs.reload(tab.id);
    await waitTabLoaded(tab.id);
    await delay(1500); // let late content render
    const v = await runInTab(tab.id, w.code);
    const status = typeof v === 'string' ? v : JSON.stringify(v);
    const first = w.lastRun == null;
    const changed = !first && status !== w.last;
    const truthy = !!v && !['false', 'null', '0', '""', '[]', '{}'].includes(status);
    if (w.notifyWhen === 'always' || (w.notifyWhen === 'truthy' && truthy) || (!w.notifyWhen || w.notifyWhen === 'change') && changed) {
      notify(w, changed ? `${w.last} → ${status}` : status);
    }
    w.last = status.slice(0, 2000);
    w.error = null;
    w.errors = 0;
  } catch (e) {
    w.error = String((e && e.message) || e);
    w.errors = (w.errors || 0) + 1;
    if (w.errors >= MAX_ERRORS) {
      w.paused = true;
      schedule(w);
      notify(w, `Paused after ${MAX_ERRORS} failed runs: ${w.error}`);
    }
  } finally {
    w.lastRun = Date.now();
    w.running = false;
    save();
    refreshUi(w);
  }
}

/** Create an approved watch and run it once right away. */
export async function createWatch(job, args) {
  await load();
  const interval = Math.max(30, Math.min(24 * 3600, args.intervalSeconds | 0 || 60));
  const url = new URL(String(args.url || job.url));
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) URLs');
  const w = {
    id: Math.random().toString(36).slice(2, 10),
    name: String(args.name || 'Watch').slice(0, 80),
    domain: job.domain,
    url: url.href,
    intervalSec: interval,
    code: String(args.code || ''),
    tab: args.tab === 'current' ? 'current' : 'background',
    tabId: args.tab === 'current' ? job.tabId : null,
    notifyWhen: ['change', 'truthy', 'always'].includes(args.notifyWhen) ? args.notifyWhen : 'change',
    created: Date.now(),
  };
  watches.push(w);
  await save();
  schedule(w);
  run(w);
  return `Watch "${w.name}" (id ${w.id}) created: every ${interval}s on ${w.url}. The user can stop it from the sidebar.`;
}

export async function listWatches(domain) {
  await load();
  return watches.filter(w => !domain || w.domain === domain).map(publicView);
}

export async function deleteWatch(id) {
  await load();
  const w = watches.find(x => x.id === id);
  if (!w) throw new Error(`No watch ${id}`);
  clearInterval(timers.get(id));
  timers.delete(id);
  watches = watches.filter(x => x !== w);
  await save();
  // Close the background tab it opened for itself.
  if (w.tab !== 'current' && w.tabId != null) browser.tabs.remove(w.tabId).catch(() => {});
  refreshUi(w);
  return `Watch "${w.name}" stopped.`;
}

load();
