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
import { CLAWD_CSS, clawdSpriteHtml, eyeOffset, lookAt, setMood, tossBottle } from '@/common/clawd-art';
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
.ask { margin: 4px 0 12px; padding: 10px 12px; border-radius: 12px; border: 1.5px solid var(--accent); background: var(--surface); box-shadow: var(--shadow); }
.ask.done { border-color: var(--border); box-shadow: none; opacity: .8; }
.ask-h { font-size: 11px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
.ask.done .ask-h { color: var(--muted); }
.ask-what { font-weight: 600; overflow-wrap: anywhere; }
.ask-on { font-size: 11px; color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }
.ask-why { font-size: 12px; color: var(--muted); font-style: italic; margin-top: 4px; }
.ask-code { margin: 8px 0 0; max-height: 220px; overflow: auto; padding: 8px; border-radius: 6px; background: var(--code-bg); color: var(--code-fg); font: 11px/1.45 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
.ask-btns { display: flex; gap: 8px; margin-top: 10px; }
.ask-btns .cm-btn { flex: 1; }
.ask-state { margin-top: 6px; font-size: 12px; font-weight: 600; }
.ask-state.ok { color: var(--ok); } .ask-state.no { color: var(--err); }
.out { display: flex; align-items: center; gap: 8px; margin: 4px 0 10px; padding: 8px 10px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); }
.out .nm { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.out .sz { font-size: 11px; color: var(--faint); }
.watches { display: none; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface); font-size: 12px; }
.watches.on { display: block; }
.watches .wt { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); margin-bottom: 4px; }
.w { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; }
.w .wi { flex: 1; min-width: 0; }
.w .wn { font-weight: 600; }
.w .ws { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w .we { color: var(--err); }
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
  <div class="watches" id="watches"></div>
  <div class="log" id="log"></div>
  <div class="stage">
    <div class="mascot" id="mascot" title="Click to tickle">${clawdSpriteHtml(112)}</div>
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
let tickleUntil = 0;
let tickles = 0;
let lastTickle = 0;
let throwUntil = 0;
let tickleText = '';
let mouse = null;
const TICKLES = ['Hehe! 😆', 'Hahaha, stop it!', 'I’m trying to work here! 😂', 'OK OK, you win! 🏳️'];
const MASCOT_W = 112;
const EYES = eyeOffset(MASCOT_W);

function showWater() {
  $('waterc').textContent = litres ? `💧 ${litres.toFixed(1)} L guzzled` : '';
}
showWater();

function paintStage() {
  const now = Date.now();
  const drinking = waterUntil > now;
  const mood = drinking ? 'water' : throwUntil > now ? 'throw' : stageMood;
  setMood(spriteEl, mood, tickleUntil > now ? 'cw-tickle' : '');
  $('speech').textContent = tickleUntil > now ? tickleText : drinking ? MOOD_LABEL.water : stageText;
}

function setStage(mood, text, color) {
  stageMood = mood;
  stageText = text;
  if (color) mascotEl.style.setProperty('--paint', color);
  paintStage();
}

// Click to tickle him.
mascotEl.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastTickle > 3000) tickles = 0;
  lastTickle = now;
  tickleText = TICKLES[Math.min(tickles++, TICKLES.length - 1)];
  tickleUntil = now + 1300;
  paintStage();
  setTimeout(paintStage, 1350);
});

// His eyes follow the cursor when it's near.
let near = false;
document.addEventListener('mousemove', e => {
  mouse = { x: e.clientX, y: e.clientY };
  const r = spriteEl.getBoundingClientRect();
  const dx = e.clientX - (r.left + EYES.x);
  const dy = e.clientY - (r.top + EYES.y);
  const isNear = Math.hypot(dx, dy) < 220;
  if (isNear) lookAt(spriteEl, dx, dy);
  else if (near) lookAt(spriteEl, null);
  near = isNear;
}, { passive: true });
document.addEventListener('mouseleave', () => {
  mouse = null;
  if (near) { near = false; lookAt(spriteEl, null); }
});

// Water breaks while working (AI is thirsty work), then the empty bottle gets chucked at you.
setInterval(() => {
  const now = Date.now();
  if (waterUntil && now > waterUntil) {
    waterUntil = 0;
    throwUntil = now + 450;
    paintStage();
    setTimeout(() => {
      const r = spriteEl.getBoundingClientRect();
      const hx = r.left + r.width * 0.78;
      const hy = r.top + r.height * 0.45;
      const aim = mouse || { x: hx + 140, y: hy - 160 };
      tossBottle(document, document.body, hx, hy, aim.x, aim.y);
      paintStage();
    }, 450);
  }
  if (!busy) { nextWater = 0; return; }
  if (!nextWater) nextWater = now + 8000 + Math.random() * 8000;
  if (!waterUntil && !throwUntil && now > nextWater) {
    waterUntil = now + 3000;
    nextWater = now + 25000 + Math.random() * 20000;
    litres += 0.5;
    try { localStorage.setItem(LITRES_KEY, String(litres)); } catch { /* ignore */ }
    showWater();
    paintStage();
  }
  if (throwUntil && now > throwUntil) throwUntil = 0;
}, 250);

/** Decide what Clawd is doing from the site's state. */
function stageFor(thread, running, busyHere) {
  const last = thread[thread.length - 1];
  if (!domain) return ['idle', 'Open a web page and I’ll remodel it for you!'];
  if (busyHere && last && last.events.some(ev => ev.type === 'approval' && ev.state === 'pending')) {
    return ['wave', 'I need your OK below 👇'];
  }
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
const SIZE = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const hostPath = u => { try { const x = new URL(u); return x.host + x.pathname; } catch { return u || ''; } };

function renderApproval(ev, job) {
  const pending = ev.state === 'pending';
  const result = { approved: ['ok', 'Approved ✓'], denied: ['no', 'Denied'], expired: ['no', 'No answer — skipped'] }[ev.state];
  return `<div class="ask${pending ? '' : ' done'}">
    <div class="ask-h">${pending ? '🔐 Claude asks to' : 'Claude asked to'}</div>
    <div class="ask-what">${esc(ev.what)}</div>
    ${ev.url ? `<div class="ask-on">on ${esc(hostPath(ev.url))}</div>` : ''}
    ${ev.reason ? `<div class="ask-why">“${esc(ev.reason)}”</div>` : ''}
    ${ev.code ? `<pre class="ask-code">${esc(ev.code)}</pre>` : ''}
    ${pending
    ? `<div class="ask-btns"><button class="cm-btn" data-ok="1" data-req="${esc(job.requestId)}" data-call="${esc(ev.callId)}">Approve</button>
       <button class="cm-btn-ghost" data-ok="0" data-req="${esc(job.requestId)}" data-call="${esc(ev.callId)}">Deny</button></div>`
    : `<div class="ask-state ${result[0]}">${result[1]}</div>`}
  </div>`;
}

function renderOutput(ev, job) {
  return `<div class="out">📄<span class="nm" title="${esc(ev.path)}">${esc(ev.name)}</span><span class="sz">${SIZE(ev.size)}</span>
    ${ev.inline ? `<button class="cm-btn-ghost" data-dl="${ev.ix}" data-req="${esc(job.requestId)}" data-name="${esc(ev.name)}">Download</button>` : ''}
    <button class="cm-btn-ghost" data-copy="${esc(ev.winPath)}" title="${esc(ev.winPath)}">Copy path</button></div>`;
}

function renderEvents(events, job) {
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
    else if (ev.type === 'approval') html += renderApproval(ev, job);
    else if (ev.type === 'output') html += renderOutput(ev, job);
  }
  flush();
  return html;
}

function renderTurn(job) {
  let html = `<div class="turn">${renderEvents(job.events, job)}`;
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
  const pendingAsk = !!last && last.events.some(ev => ev.type === 'approval' && ev.state === 'pending');
  renderWatches((state && state.watches) || []);

  // Status line for this site.
  if (!domain) setStatus('', 'No site in this tab');
  else if (busyHere && pendingAsk) setStatus('run', '<span class="cm-dot live"></span>Waiting for your approval');
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
    if (atBottom || busyHere || pendingAsk) logEl.scrollTop = logEl.scrollHeight;
  }

  // Resulting script of the latest finished turn.
  const resultEl = $('result');
  if (last && last.script && last.edited && last.status !== 'running') {
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

function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

function renderWatches(list) {
  const box = $('watches');
  box.classList.toggle('on', list.length > 0);
  box.innerHTML = list.length ? `<div class="wt">⏱ Watches on this site</div>${list.map(w => `
    <div class="w"><div class="wi">
      <div class="wn">${esc(w.name)}${w.paused ? ' (paused)' : ''}</div>
      <div class="ws" title="${esc(w.url)}">every ${w.intervalSec}s · ${w.lastRun ? `checked ${timeAgo(w.lastRun)}` : 'not run yet'}${w.last != null ? ` · ${esc(w.last)}` : ''}</div>
      ${w.error ? `<div class="we">${esc(w.error)}</div>` : ''}
    </div><button class="cm-btn-ghost" data-stop="${esc(w.id)}">Stop</button></div>`).join('')}` : '';
}

$('watches').addEventListener('click', async e => {
  const b = e.target.closest('[data-stop]');
  if (!b) return;
  b.disabled = true;
  try { await sendCmdDirectly('AIWatchDelete', { id: b.dataset.stop }); } catch (err) { setStatus('bad', esc(err)); }
  refresh();
});

logEl.addEventListener('click', async e => {
  const ok = e.target.closest('[data-ok]');
  if (ok) {
    ok.parentNode.querySelectorAll('button').forEach(b => { b.disabled = true; });
    await sendCmdDirectly('AIApprove', { requestId: ok.dataset.req, callId: ok.dataset.call, ok: ok.dataset.ok === '1' });
    refresh();
    return;
  }
  const dl = e.target.closest('[data-dl]');
  if (dl) {
    const content = await sendCmdDirectly('AIGetOutput', { requestId: dl.dataset.req, ix: +dl.dataset.dl });
    if (content == null) { setStatus('bad', 'That file is no longer in memory; use Copy path.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }));
    a.download = dl.dataset.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    return;
  }
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    try {
      await navigator.clipboard.writeText(cp.dataset.copy);
      cp.textContent = 'Copied ✓';
      setTimeout(() => { cp.textContent = 'Copy path'; }, 1500);
    } catch { /* clipboard blocked */ }
  }
});

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
