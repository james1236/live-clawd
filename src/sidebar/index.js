/**
 * Clawdify sidebar: the live "Claude is working" view.
 *
 * Clawd stands on a little stage above the composer the whole time, acting out what
 * Claude is doing (the same moods as the on-page overlay), taking water breaks while
 * he works, and hopping when clicked.
 *
 * Follows the active tab of its window and shows only that site's conversation:
 * your requests, tool-use chips and Claude's narration, then the resulting
 * userscript with an Apply button, and a composer to keep refining. Switching to a
 * site with no conversation shows an empty state instead of another site's chat.
 *
 * It re-pulls state via `AIGetState` whenever an `AIEvent` arrives or the active
 * tab changes, so reopening the sidebar mid-run replays everything so far.
 */
import '@/common/browser';
import { sendCmdDirectly } from '@/common';
import { clawdSvg, esc, injectTheme, siteOf } from '@/common/cm-theme';
import { CLAWD_CSS, clawdSpriteHtml, setMood } from '@/common/clawd-art';
import { MOOD_LABEL } from '@/common/clawd-actions';

injectTheme(`${CLAWD_CSS}
html, body { height: 100%; }
body { display: flex; flex-direction: column; user-select: text; }
.head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border); background: var(--surface); }
.head .who { min-width: 0; flex: 1; }
.head .site { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); min-height: 18px; }
.status.run { color: var(--accent); }
.status.ok { color: var(--ok); }
.status.bad { color: var(--err); }
.banner { display: none; align-items: center; gap: 8px; padding: 6px 12px; font-size: 12px; background: var(--accent-soft); color: var(--text); }
.log { flex: 1; overflow: auto; padding: 14px 12px 6px; }
.turn { margin-bottom: 18px; }
.user { margin: 0 0 10px auto; width: fit-content; max-width: 88%; padding: 8px 12px; border-radius: 14px 14px 4px 14px; background: var(--surface-2); white-space: pre-wrap; word-break: break-word; }
.say { margin: 0 0 8px; white-space: pre-wrap; word-break: break-word; font-family: ui-serif, Georgia, "Times New Roman", serif; font-size: 14px; line-height: 1.55; }
.note { margin: 0 0 6px; font-size: 12px; color: var(--faint); white-space: pre-wrap; word-break: break-word; }
.tools { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 8px; }
.tools .cm-chip { font-family: ui-monospace, Consolas, monospace; font-size: 11px; max-width: 100%; }
.fail { margin: 6px 0 8px; padding: 8px 10px; border-radius: 8px; background: var(--err-soft); color: var(--err); white-space: pre-wrap; word-break: break-word; font-size: 12px; }
.meta { font-size: 11px; color: var(--faint); }
.empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; padding: 24px; color: var(--muted); }
.empty .cm-clawd { opacity: .9; }
.empty b { color: var(--text); font-weight: 600; }
.script { border-top: 1px solid var(--border); background: var(--surface); }
.script summary { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; font-size: 12px; font-weight: 600; list-style: none; user-select: none; }
.script summary::-webkit-details-marker { display: none; }
.script summary::before { content: "›"; display: inline-block; transition: transform .15s; color: var(--muted); font-size: 14px; }
.script[open] summary::before { transform: rotate(90deg); }
.script summary .cm-btn { margin-left: auto; padding: 4px 12px; font-size: 12px; }
.script pre { margin: 0 12px 12px; max-height: 300px; overflow: auto; padding: 10px; border-radius: 8px; background: var(--code-bg); color: var(--code-fg); font: 12px/1.45 ui-monospace, Consolas, monospace; white-space: pre; tab-size: 2; -moz-tab-size: 2; }
.composer { padding: 10px 12px 12px; border-top: 1px solid var(--border); background: var(--bg); }
.box { display: flex; align-items: flex-end; gap: 6px; padding: 5px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); }
.box:focus-within { border-color: var(--accent); }
.box .cm-input { flex: 1; min-height: 30px; max-height: 200px; overflow: auto; padding: 6px 4px 6px 8px; border: 0; border-radius: 0; box-shadow: none; background: transparent; line-height: 18px; }
.send { flex: none; width: 30px; height: 30px; padding: 0; border-radius: 8px; display: grid; place-items: center; }
.stage { position: relative; display: flex; align-items: flex-end; gap: 10px; padding: 8px 12px 4px; border-top: 1px solid var(--border); background: linear-gradient(var(--bg), var(--surface-2)); }
.mascot { flex: none; width: 112px; cursor: pointer; user-select: none; }
.speech { position: relative; flex: 0 1 auto; min-width: 0; margin-bottom: 30px; padding: 7px 11px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); font-size: 12.5px; line-height: 1.4; overflow-wrap: anywhere; }
.speech::before { content: ""; position: absolute; left: -6px; bottom: 10px; width: 10px; height: 10px; background: var(--surface); border-left: 1px solid var(--border); border-bottom: 1px solid var(--border); transform: rotate(45deg); }
.waterc { position: absolute; right: 12px; top: 6px; font-size: 11px; color: #3a7bd5; }
.waterc:empty { display: none; }
.under { display: flex; align-items: center; margin-top: 6px; }
.under .cm-btn-ghost { margin-left: auto; }
`);

document.body.innerHTML = `
  <div class="head">
    ${clawdSvg(24)}
    <div class="who">
      <div class="site" id="site">Clawdify</div>
      <div class="status" id="status"></div>
    </div>
  </div>
  <div class="banner" id="banner"></div>
  <div class="log" id="log"></div>
  <div class="stage">
    <div class="mascot" id="mascot" title="Hi, I'm Clawd!">${clawdSpriteHtml(112)}</div>
    <div class="speech" id="speech">Hi!</div>
    <div class="waterc" id="waterc" title="Water guzzled so far (it's a joke)"></div>
  </div>
  <div id="result"></div>
  <div class="composer">
    <div class="box">
      <textarea id="input" class="cm-input" rows="1"></textarea>
      <button id="send" class="cm-btn send" title="Send (Ctrl+Enter)" aria-label="Send">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <div class="under">
      <span class="cm-kbd">Ctrl+Enter to send</span>
      <button id="new" class="cm-btn-ghost" title="Forget this site's conversation; the next request starts a fresh Claude session">New chat</button>
    </div>
  </div>`;

const $ = id => document.getElementById(id);
const logEl = $('log');
const inputEl = $('input');
let windowId;
let domain = null;
let tabUrl = '';
let state = null;
let codeOpen = false;

// ---------------------------------------------------------------------------
// Clawd on the stage
// ---------------------------------------------------------------------------

const mascotEl = $('mascot');
const spriteEl = mascotEl.querySelector('svg');
const LITRES_KEY = 'clawdify-litres';
let stageMood = 'idle';
let stageText = '';
let busy = false;
let waterUntil = 0;
let nextWater = 0;
let litres = 0;
try { litres = +localStorage.getItem(LITRES_KEY) || 0; } catch { /* storage blocked */ }
let poked = false;
const HELLOS = ['Hi! I’m Clawd 👋', 'That tickles!', 'Ready to remodel the web!', '*happy pixel noises*', 'Need anything changed?'];

function showWater() {
  $('waterc').textContent = litres ? `💧 ${litres.toFixed(1)} L guzzled` : '';
}
showWater();

function paintStage() {
  const drinking = waterUntil > Date.now();
  setMood(spriteEl, drinking ? 'water' : stageMood, poked ? 'cw-poke' : '');
  $('speech').textContent = drinking ? MOOD_LABEL.water : stageText;
}

function setStage(mood, text, color) {
  stageMood = mood;
  stageText = text;
  if (color) mascotEl.style.setProperty('--paint', color);
  paintStage();
}

mascotEl.addEventListener('click', () => {
  poked = true;
  const before = stageText;
  if (!busy) stageText = HELLOS[Math.floor(Math.random() * HELLOS.length)];
  paintStage();
  setTimeout(() => {
    poked = false;
    if (!busy && stageText !== before) stageText = before;
    paintStage();
  }, 1400);
});

// Water breaks while working: AI is thirsty work.
setInterval(() => {
  const now = Date.now();
  if (waterUntil && now > waterUntil) {
    waterUntil = 0;
    paintStage();
  }
  if (!busy) { nextWater = 0; return; }
  if (!nextWater) nextWater = now + 8000 + Math.random() * 8000;
  if (!waterUntil && now > nextWater) {
    waterUntil = now + 3000;
    nextWater = now + 25000 + Math.random() * 20000;
    litres += 0.5;
    try { localStorage.setItem(LITRES_KEY, String(litres)); } catch { /* ignore */ }
    showWater();
    paintStage();
  }
}, 500);

/** Decide what Clawd is doing from the site's state. */
function stageFor(thread, running, busyHere) {
  const last = thread[thread.length - 1];
  if (!domain) return ['idle', 'Open a web page and I’ll remodel it for you!'];
  if (busyHere && last) {
    for (let i = last.events.length - 1; i >= 0; i--) {
      const ev = last.events[i];
      if (ev.type === 'tool' && ev.kind) return [ev.kind === 'paint' ? 'canvas' : ev.kind, ev.label || ev.summary, ev.color];
      if (ev.type === 'note') return ['think', ev.text];
      if (ev.type === 'narration') return ['think', 'Thinking it over…'];
    }
    return ['think', 'Getting started…'];
  }
  if (running) return ['walk', `Busy over on ${running.domain}…`];
  const ago = last && last.endedAt ? Date.now() - last.endedAt : Infinity;
  if (last && last.status === 'error' && ago < 9000) return ['error', MOOD_LABEL.error];
  if (last && last.status === 'done' && ago < 7000) return ['done', `${MOOD_LABEL.done} ✨`];
  if (thread.length) return ['idle', `Anything else for ${domain}?`];
  if (state && state.script) return ['idle', `I’ve already tuned ${domain}. Want more changes?`];
  return ['idle', `Hi! Tell me how to change ${domain}.`];
}

/** Group consecutive tool events so a run of Read/Grep calls renders as one chip row. */
function renderEvents(events) {
  let html = '';
  let tools = [];
  const flush = () => {
    if (tools.length) html += `<div class="tools">${tools.join('')}</div>`;
    tools = [];
  };
  for (const ev of events || []) {
    if (ev.type === 'tool') {
      tools.push(`<span class="cm-chip" title="${esc(ev.summary || ev.name)}">${esc(ev.summary || ev.name)}</span>`);
      continue;
    }
    flush();
    if (ev.type === 'user') html += `<div class="user">${esc(ev.text)}</div>`;
    else if (ev.type === 'narration') html += `<div class="say">${esc(ev.text)}</div>`;
    else if (ev.type === 'note') html += `<div class="note">${esc(ev.text)}</div>`;
  }
  flush();
  return html;
}

function renderTurn(job) {
  let html = `<div class="turn">${renderEvents(job.events)}`;
  if (job.error) html += `<div class="fail">${esc(job.error)}</div>`;
  if (job.status !== 'running') {
    html += `<div class="meta">${job.status === 'error' ? 'Failed' : 'Done'}${job.cost ? ` · $${job.cost.toFixed(3)}` : ''}</div>`;
  }
  return `${html}</div>`;
}

function setStatus(cls, html) {
  $('status').className = `status ${cls}`;
  $('status').innerHTML = html;
}

function render() {
  $('site').textContent = domain || 'Clawdify';
  $('site').title = tabUrl;
  const thread = (state && state.thread) || [];
  const last = thread[thread.length - 1];
  const running = state && state.running;
  const busyHere = running && running.domain === domain;

  // Status line for this site.
  if (!domain) setStatus('', 'No site in this tab');
  else if (busyHere) setStatus('run', '<span class="cm-dot live"></span>Claude is working…');
  else if (last && last.status === 'error') setStatus('bad', '<span class="cm-dot"></span>Last request failed');
  else if (state && state.script) setStatus(state.script.enabled ? 'ok' : '', `<span class="cm-dot"></span>Script ${state.script.enabled ? 'active' : 'disabled'}`);
  else setStatus('', 'No script yet');

  // Work happening on another site.
  const banner = $('banner');
  if (running && !busyHere) {
    banner.style.display = 'flex';
    banner.innerHTML = `<span class="cm-dot live" style="color:var(--accent)"></span>Claude is working on <b>${esc(running.domain)}</b>`;
  } else {
    banner.style.display = 'none';
  }

  // Clawd.
  busy = !!busyHere;
  const [mood, text, color] = stageFor(thread, running, busyHere);
  setStage(mood, text, color);
  if (mood === 'done' || mood === 'error') setTimeout(refresh, mood === 'done' ? 7200 : 9200);

  // Conversation.
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  if (!domain) {
    logEl.innerHTML = `<div class="empty"><div>Open a web page to change it with Claude.</div></div>`;
  } else if (!thread.length) {
    logEl.innerHTML = `<div class="empty">
      <div><b>${esc(domain)}</b></div>
      <div>${state && state.script
        ? 'This site already has a Clawdify script. Describe a change and Claude will edit it.'
        : 'Describe how you want this site to look or behave, and Claude will write a userscript for it.'}</div></div>`;
  } else {
    logEl.innerHTML = thread.map(renderTurn).join('');
    if (atBottom || busyHere) logEl.scrollTop = logEl.scrollHeight;
  }

  // Resulting script of the latest finished turn.
  const resultEl = $('result');
  if (last && last.script && last.status !== 'running') {
    resultEl.innerHTML = `<details class="script" id="code" ${codeOpen ? 'open' : ''}>
      <summary>Userscript<button id="apply" class="cm-btn">Apply &amp; reload</button></summary>
      <pre>${esc(last.script)}</pre></details>`;
    $('code').addEventListener('toggle', e => { codeOpen = e.target.open; });
    $('apply').addEventListener('click', async e => {
      e.preventDefault();
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Applying…';
      try {
        await sendCmdDirectly('ParseScript', { code: last.script, url: last.url, reloadTab: true });
        btn.textContent = 'Applied ✓';
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Apply & reload';
        setStatus('bad', `Apply failed: ${esc(err)}`);
      }
    });
  } else {
    resultEl.innerHTML = '';
  }

  // Composer.
  inputEl.disabled = !domain;
  $('send').disabled = !domain || !!running;
  $('new').disabled = !thread.length || !!busyHere;
  inputEl.placeholder = !domain ? 'Open a web page first'
    : thread.length ? `Refine ${domain}…` : `Describe a change to ${domain}…`;
}

let pending = false;
function refresh() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(async () => {
    pending = false;
    try {
      state = domain ? await sendCmdDirectly('AIGetState', { domain }) : null;
    } catch (e) {
      state = null;
      setStatus('bad', esc(e));
    }
    render();
  });
}

async function followTab() {
  const tab = (await browser.tabs.query({ active: true, windowId }))[0];
  const next = siteOf(tab && tab.url);
  tabUrl = (tab && tab.url) || '';
  if (next !== domain) {
    domain = next;
    codeOpen = false;
    logEl.scrollTop = 0;
  }
  refresh();
}

browser.runtime.onMessage.addListener(msg => {
  if (msg && msg.cmd === 'AIEvent') refresh();
});
browser.tabs.onActivated.addListener(info => {
  if (info.windowId === windowId) followTab();
});
browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (tab.windowId === windowId && tab.active && info.url) followTab();
});

function autosize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 200)}px`;
}
inputEl.addEventListener('input', autosize);

async function send() {
  const prompt = inputEl.value.trim();
  if (!prompt || $('send').disabled) return;
  inputEl.value = '';
  autosize();
  try {
    await sendCmdDirectly('AIGenerate', { prompt });
  } catch (e) {
    inputEl.value = prompt;
    autosize();
    setStatus('bad', esc(e));
  }
  refresh();
}
$('send').addEventListener('click', send);
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
});
$('new').addEventListener('click', async () => {
  try {
    await sendCmdDirectly('AINewChat', { domain });
  } catch (e) {
    setStatus('bad', esc(e));
  }
  refresh();
  inputEl.focus();
});

(async () => {
  windowId = (await browser.windows.getCurrent()).id;
  await followTab();
})();
