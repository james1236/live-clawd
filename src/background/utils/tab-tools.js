/**
 * What Clawdify's tab tools actually do in a tab. Callers (ai.js, watches.js) only get
 * here after the user approved the call in the sidebar.
 */

export const delay = ms => new Promise(r => setTimeout(r, ms));

export async function waitTabLoaded(tabId, timeout = 15000) {
  await delay(300); // let a navigation/reload begin
  for (const end = Date.now() + timeout; Date.now() < end; await delay(200)) {
    try {
      if ((await browser.tabs.get(tabId)).status === 'complete') return;
    } catch {
      return;
    }
  }
}

/**
 * Run `body` (the body of an async function) in the tab's content-script context and
 * resolve with its JSON-safe return value, or throw its error.
 */
export async function runInTab(tabId, body, args = {}) {
  const code = `(async (args) => { ${body}\n})(${JSON.stringify(args)})`
    + '.then(v => JSON.stringify({ ok: true, v: v === undefined ? null : v }),'
    + ' e => JSON.stringify({ ok: false, e: String((e && e.message) || e) }))';
  const [raw] = await browser.tabs.executeScript(tabId, { code });
  const res = JSON.parse(raw || '{"ok":false,"e":"no result"}');
  if (!res.ok) throw new Error(res.e);
  return res.v;
}

const SNAPSHOT = `
  const root = args.selector ? document.querySelector(args.selector) : document.documentElement;
  if (!root) throw new Error('No element matches ' + args.selector);
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script,style,svg,iframe,noscript,template,clawdify-overlay').forEach(n => n.remove());
  return { url: location.href, title: document.title, html: clone.outerHTML.slice(0, 3000000), text: (root.innerText || '').slice(0, 200000) };`;

const INFO = `
  return { url: location.href, title: document.title, viewport: [innerWidth, innerHeight],
    selection: String(getSelection() || '').slice(0, 5000) };`;

const CLICK = `
  const list = document.querySelectorAll(args.selector);
  const el = list[args.index || 0];
  if (!el) throw new Error('No element #' + (args.index || 0) + ' for ' + args.selector + ' (' + list.length + ' matches)');
  el.scrollIntoView({ block: 'center' });
  el.click();
  return 'Clicked ' + el.tagName.toLowerCase() + (el.innerText ? ' "' + el.innerText.trim().slice(0, 60) + '"' : '');`;

const TYPE = `
  const el = document.querySelector(args.selector);
  if (!el) throw new Error('No element matches ' + args.selector);
  el.focus();
  if (el.isContentEditable) el.textContent = args.text;
  else el.value = args.text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  if (args.submit) {
    if (el.form && el.form.requestSubmit) el.form.requestSubmit();
    else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  return 'Typed ' + args.text.length + ' characters into ' + args.selector + (args.submit ? ' and submitted' : '');`;

const WAIT = `
  const end = Date.now() + Math.min(args.timeoutMs || 10000, 60000);
  const hit = () => (args.selector && document.querySelector(args.selector))
    || (args.text && document.body && document.body.innerText.includes(args.text));
  while (!hit()) {
    if (Date.now() > end) throw new Error('Timed out waiting for ' + (args.selector || JSON.stringify(args.text)));
    await new Promise(r => setTimeout(r, 250));
  }
  return 'Found ' + (args.selector || JSON.stringify(args.text));`;

/** Execute an (approved) tab tool. */
export async function runTabTool(tabId, windowId, tool, args) {
  switch (tool) {
  case 'page_info': return runInTab(tabId, INFO);
  case 'page_snapshot': return runInTab(tabId, SNAPSHOT, { selector: args.selector || '' });
  case 'page_eval': return runInTab(tabId, String(args.code || ''));
  case 'click': return runInTab(tabId, CLICK, { selector: String(args.selector), index: args.index | 0 });
  case 'type': return runInTab(tabId, TYPE, { selector: String(args.selector), text: String(args.text || ''), submit: !!args.submit });
  case 'wait_for': return runInTab(tabId, WAIT, { selector: args.selector || '', text: args.text || '', timeoutMs: args.timeoutMs | 0 });
  case 'navigate': {
    const url = new URL(String(args.url)); // throws on garbage
    if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) URLs');
    await browser.tabs.update(tabId, { url: url.href });
    await waitTabLoaded(tabId);
    const t = await browser.tabs.get(tabId);
    return { url: t.url, title: t.title };
  }
  case 'reload': {
    await browser.tabs.reload(tabId);
    await waitTabLoaded(tabId);
    const t = await browser.tabs.get(tabId);
    return { url: t.url, title: t.title };
  }
  case 'screenshot': {
    const t = await browser.tabs.get(tabId);
    if (!t.active) throw new Error('The tab is not the active one, so it cannot be captured');
    const url = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
    return { png: url.slice(url.indexOf(',') + 1) };
  }
  default:
    throw new Error(`Unknown tool ${tool}`);
  }
}

/**
 * Snapshot the visible tab and cut out `rects` (CSS px) — images of elements about to be
 * removed, so Clawd can still be seen vacuuming them up after hot reload deletes them.
 * @return {Promise<string[]>} data: URLs ('' where it failed)
 */
export async function cropVisible(windowId, rects, dpr = 1) {
  const shot = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(shot)).blob());
  return Promise.all(rects.map(async r => {
    try {
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext('2d').drawImage(bmp, Math.round(r.left * dpr), Math.round(r.top * dpr), w, h, 0, 0, w, h);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return await new Promise(res => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res('');
        fr.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  }));
}
