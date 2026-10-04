/**
 * Clawdify toolbar popup: a compact textbox where you describe how you want
 * the current site changed. Submitting opens the sidebar (the live working view)
 * and kicks off a background job; the popup then closes.
 *
 * Each site has its own conversation; the popup says whether a request continues
 * it and offers to start fresh, and toggles the site's script on/off.
 */
import '@/common/browser';
import { sendCmdDirectly } from '@/common';
import { esc, injectTheme, siteOf } from '@/common/cm-theme';
import { CLAWD_CSS, clawdSpriteHtml } from '@/common/clawd-art';

injectTheme(`${CLAWD_CSS}
body { width: 360px; }
.top .cw-svg { margin: -10px -6px -6px -8px; }
.top { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
.title { font-weight: 650; font-size: 14px; letter-spacing: -.01em; }
.top .cm-chip { margin-left: auto; max-width: 190px; }
.main { padding: 0 16px 14px; }
.ctx { display: flex; align-items: center; gap: 8px; min-height: 20px; margin-bottom: 8px; font-size: 12px; }
.ctx a { margin-left: auto; }
.cm-input { min-height: 92px; }
.err { color: var(--err); background: var(--err-soft); border-radius: 8px; padding: 6px 10px; margin-top: 8px; font-size: 12px; display: none; white-space: pre-wrap; }
.row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.row .cm-btn { margin-left: auto; }
.foot { display: flex; align-items: center; gap: 14px; padding: 9px 16px; border-top: 1px solid var(--border); background: var(--surface-2); font-size: 12px; }
.foot .sp { flex: 1; }
`);

document.body.innerHTML = `
  <div class="top">
    ${clawdSpriteHtml(48)}
    <div class="title">Clawdify</div>
    <span class="cm-chip" id="site">…</span>
  </div>
  <div class="main">
    <div class="ctx cm-muted" id="ctx"></div>
    <textarea id="prompt" class="cm-input" rows="4"
      placeholder="Describe how you want this site changed&#10;e.g. hide the sidebar and widen the article"></textarea>
    <div class="err" id="err"></div>
    <div class="row">
      <span class="cm-kbd">Ctrl+Enter to send</span>
      <button id="go" class="cm-btn">Ask Claude</button>
    </div>
  </div>
  <div class="foot">
    <span id="toggle-slot"></span>
    <span class="sp"></span>
    <a id="sidebar">Open sidebar</a>
    <a id="dash">Manage scripts</a>
  </div>`;

const $ = id => document.getElementById(id);
const promptEl = $('prompt');
let domain = null;

function showError(msg) {
  $('err').textContent = msg;
  $('err').style.display = 'block';
}

async function loadSite() {
  const tab = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  domain = siteOf(tab && tab.url);
  $('site').textContent = domain || 'no site';
  $('site').title = domain || '';
  if (!domain) {
    $('ctx').textContent = 'Open an http(s) page to use Clawdify.';
    $('go').disabled = true;
    promptEl.disabled = true;
    return;
  }
  const state = await sendCmdDirectly('AIGetState', { domain });
  const turns = state.thread.length;
  if (state.running && state.running.domain !== domain) {
    $('ctx').innerHTML = `<span class="cm-dot live" style="color:var(--accent)"></span>`
      + `Claude is busy on ${esc(state.running.domain)}`;
  } else if (turns) {
    $('ctx').innerHTML = `Continuing this site's chat (${turns} request${turns > 1 ? 's' : ''})`
      + '<a id="fresh">Start fresh</a>';
    $('fresh').addEventListener('click', async () => {
      try {
        await sendCmdDirectly('AINewChat', { domain });
        $('ctx').textContent = 'Fresh chat. Claude still edits the existing script.';
      } catch (e) {
        showError(String((e && e.message) || e));
      }
    });
  } else {
    $('ctx').textContent = state.script ? 'Claude will edit this site\'s existing script.' : 'New chat for this site.';
  }
  if (state.script) renderToggle(state.script, tab);
}

function renderToggle(script, tab) {
  $('toggle-slot').innerHTML = `<label class="cm-switch" title="Turn this site's Clawdify script on or off">
    <input type="checkbox" id="enabled" ${script.enabled ? 'checked' : ''}><span class="track"></span>
    <span id="enabled-label">Script ${script.enabled ? 'on' : 'off'}</span></label>`;
  $('enabled').addEventListener('change', async e => {
    const on = e.target.checked;
    await sendCmdDirectly('UpdateScriptInfo', { id: script.id, config: { enabled: on ? 1 : 0 } });
    $('enabled-label').innerHTML = `Script ${on ? 'on' : 'off'} · <a id="reload">reload</a>`;
    $('reload').addEventListener('click', e2 => {
      e2.preventDefault();
      browser.tabs.reload(tab.id);
      window.close();
    });
  });
}

loadSite().catch(e => showError(String((e && e.message) || e)));

$('dash').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});
$('sidebar').addEventListener('click', () => {
  browser.sidebarAction.open();
  window.close();
});

async function submit() {
  const prompt = promptEl.value.trim();
  if (!prompt) { promptEl.focus(); return; }
  const btn = $('go');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  // Open the sidebar first, while we still have the user gesture.
  try { await browser.sidebarAction.open(); } catch { /* not fatal */ }
  // Wait for the job to be registered before closing. AIGenerate returns as soon as the
  // job exists (capture and generation continue in the background), and until it does
  // this popup is the only place a startup failure can be shown — closing first would
  // hand the error to a window that no longer exists.
  try {
    await sendCmdDirectly('AIGenerate', { prompt });
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Ask Claude';
    showError(String((err && err.message) || err));
    return;
  }
  window.close();
}

$('go').addEventListener('click', submit);
promptEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
});
promptEl.focus();
