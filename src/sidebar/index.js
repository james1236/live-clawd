/**
 * ClaudeMonkey sidebar: the live "Claude is working" view.
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

injectTheme(`
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
.box { position: relative; }
.box .cm-input { padding-right: 46px; max-height: 200px; overflow: auto; }
.send { position: absolute; right: 8px; bottom: 8px; width: 30px; height: 30px; padding: 0; border-radius: 8px; display: grid; place-items: center; }
.under { display: flex; align-items: center; margin-top: 6px; }
.under .cm-btn-ghost { margin-left: auto; }
`);

document.body.innerHTML = `
  <div class="head">
    ${clawdSvg(24)}
    <div class="who">
      <div class="site" id="site">ClaudeMonkey</div>
      <div class="status" id="status"></div>
    </div>
  </div>
  <div class="banner" id="banner"></div>
  <div class="log" id="log"></div>
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
  $('site').textContent = domain || 'ClaudeMonkey';
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

  // Conversation.
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  if (!domain) {
    logEl.innerHTML = `<div class="empty">${clawdSvg(48)}<div>Open a web page to change it with Claude.</div></div>`;
  } else if (!thread.length) {
    logEl.innerHTML = `<div class="empty">${clawdSvg(48)}
      <div><b>${esc(domain)}</b></div>
      <div>${state && state.script
        ? 'This site already has a ClaudeMonkey script. Describe a change and Claude will edit it.'
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
  inputEl.style.height = `${Math.min(inputEl.scrollHeight + 2, 200)}px`;
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
