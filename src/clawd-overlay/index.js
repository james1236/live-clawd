/**
 * Clawd on the page: injected (tabs.executeScript) into the tab a Clawdify job is
 * editing, and — Live Clawd — into localhost tabs of a project a Claude Code session in
 * WSL is working on. The background calls `window.__cmClawd(msg)` with:
 *   {op: 'play', id, steps: [{target, kind, say, ms, color}], tag, color, live}
 *       queue a choreography (from Claude's `clawd` tool). Returns {ghosts, dpr}: the
 *       on-screen boxes of the elements it's about to change, which the background
 *       snapshots *before* the edit lands and sends back
 *   {op: 'ghosts', id, ghosts: [{step, rect, src}]}  those "before" pictures: each one
 *       covers its element (hot reload happens unseen underneath) until Clawd gets
 *       there and his action reveals the new version — a paint wipe, a rub-out, being
 *       vacuumed up, a crossfade
 *   {op: 'act', id, kind, selectors, components, pattern, label, …}  a guessed action
 *       (Clawdify jobs, hook fallbacks): shown only while no choreography is playing
 *       (`hold` + `toolId`: keep at it until the matching 'end'; a long wait becomes
 *       sitting with a book or knitting, then dozing off)
 *   {op: 'end', id, toolId, ok, interrupted}  that tool finished: stop, and cheer or
 *       facepalm if it was a task like the tests
 *   {op: 'helper', id, on, agentId, label}  a subagent: a mini Clawd walks off to do it
 *       (on) and comes back with the results (off)
 *   {op: 'done' | 'error', id}  celebrate / droop after the queue, then walk off
 *   {op: 'leave', id}     walk off once the queue is done
 *   {op: 'hide'}          remove every Clawd at once (before DOM snapshots/screenshots)
 *   {op: 'peek', on, rects}  while "before" pictures of `rects` are taken, cut holes in
 *       whatever of the Clawds overlaps them (never the covers); off again after
 * One Clawd per `id`, in its own colour with a name tag. Live Clawds never scroll.
 *
 * Everything lives in a closed shadow root on a fixed, click-through layer (only
 * Clawd's body takes clicks: tickle him, or dismiss him while he waves a sign), built
 * with DOM APIs (no innerHTML) so it works on pages enforcing Trusted Types.
 */
import { CLAWD_CSS, VIEWBOX, clawdSpriteNode, eyeOffset, lookAt, setMood, tossBottle } from '@/common/clawd-art';
import { DODGED, MOOD_LABEL, TASK_RESULT, plainSay } from '@/common/clawd-actions';
import { ACTION_SOUNDS } from '@/common/clawd-sound';

function install() {
  const SPRITE_W = 96; // px
  const UNIT = SPRITE_W / VIEWBOX.w; // px per Clawd pixel
  const SPRITE_H = Math.round(UNIT * VIEWBOX.h);
  const FOOT_X = (8 - VIEWBOX.x) * UNIT; // Clawd's centre, from sprite's left
  const FOOT_Y = (10 - VIEWBOX.y) * UNIT; // Clawd's feet, from sprite's top
  const HAND = { x: 6 * UNIT, y: 5 * UNIT }; // his working hand, relative to his feet
  const SPEED = 420; // px/s walking
  const RUN = 900; // px/s on long trips
  const BELOW = 22; // room under his feet for the name tag
  const NEAR = 190; // px: eyes follow the cursor within this
  const GUESS_MS = 2200; // how long a guessed action shows
  const HOLD_MS = 10 * 60000; // a held action (tool still running) gives up after this
  const SIT_AFTER = 20000; // ...sits down with a book or some knitting after this
  const DOZE_AFTER = 180000; // ...and nods off after this
  const PONDER_AFTER = 12000; // thinking this long (or idle between tools): the chalkboard
  const REACT_MS = 1800; // cheering or facepalming at a task's result
  const MINI_W = 46; // px: a helper Clawd
  const MINI_SPEED = 260; // px/s
  const EYES = eyeOffset(SPRITE_W);
  const TICKLES = ['Hehe!', 'Hahaha, stop it!', 'I’m trying to work here!', 'OK OK, you win!'];

  const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; font: 12px/1.3 system-ui, sans-serif;
  --clawd: #d97757; --clawd-eye: #1f1e1d; --accent: #d97757; }
/* the thing he's working on: a soft glow that glides between targets */
.glow { position: absolute; left: 0; top: 0; border-radius: 12px; opacity: 0; transition: opacity .35s;
  border: 2px solid color-mix(in srgb, var(--accent) 65%, transparent);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  box-shadow: 0 0 22px 3px color-mix(in srgb, var(--accent) 35%, transparent); will-change: transform, width, height; }
.glow.on { opacity: 1; }
.glow.ok { border-color: rgba(79, 154, 69, .8); box-shadow: 0 0 22px 3px rgba(79, 154, 69, .4); }
.fxbox { position: absolute; left: 0; top: 0; overflow: hidden; border-radius: 10px; opacity: 0; transition: opacity .3s; }
.fxbox.on { opacity: 1; }
.fx { position: absolute; inset: 0; }
.cover { position: absolute; left: 0; top: 0; transform-origin: 0 0; clip-path: inset(0 0 0 0); }
.sprite { position: absolute; left: 0; top: 0; width: ${SPRITE_W}px; height: ${SPRITE_H}px; will-change: transform;
  filter: drop-shadow(0 2px 2px rgba(0,0,0,.25)); }
.turn { position: absolute; inset: 0; transition: transform .15s; }
.turn.flip { transform: scaleX(-1); }
.turn.flip .cw-sign-text { transform: scaleX(-1); transform-origin: 16.7px 0; } /* keep signs readable */
.hit { position: absolute; left: ${(3 - VIEWBOX.x) * UNIT}px; top: ${(0 - VIEWBOX.y) * UNIT}px;
  width: ${10 * UNIT}px; height: ${10 * UNIT}px; pointer-events: auto; cursor: pointer; }
.label { position: absolute; left: 50%; bottom: calc(100% + 2px); transform: translateX(-50%); white-space: nowrap;
  max-width: 280px; overflow: hidden; text-overflow: ellipsis; padding: 3px 9px; border-radius: 10px;
  background: #1f1e1d; color: #faf9f5; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
.label:empty { display: none; }
.tag { position: absolute; left: 50%; top: calc(100% + 1px); transform: translateX(-50%); white-space: nowrap;
  font-size: 10px; font-weight: 600; color: #faf9f5; background: var(--clawd); border-radius: 7px; padding: 0 6px; opacity: .92; }
.tag:empty { display: none; }
.mini { position: absolute; left: 0; top: 0; width: ${MINI_W}px; height: ${Math.round(MINI_W * VIEWBOX.h / VIEWBOX.w)}px;
  transition-property: transform, opacity; transition-timing-function: linear; will-change: transform;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.25)); }
.mini.gone { opacity: 0; transition-duration: .4s !important; }
/* babies: toddle, wobble, a lazy eye, and the odd tumble */
@keyframes toddle { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg) translateY(-1px); } }
@keyframes plop { 0% { transform: none; } 25% { transform: rotate(-75deg) translate(-4px, 6px); }
  70% { transform: rotate(-75deg) translate(-4px, 6px); } 100% { transform: none; } }
.derp { position: absolute; inset: 0; transform-origin: 50% 85%; animation: toddle 1.3s ease-in-out infinite; }
.derp.plop { animation: plop 1.4s cubic-bezier(.3, 1.4, .5, 1) 1; }
.mini .cw-eyes rect:first-child { transform: translate(-.3px, .7px); }
.mini .cw-eyes rect:last-child { transform: scale(1.3); transform-origin: 10.5px 3px; }
.minitag { position: absolute; left: 50%; top: calc(100% + 1px); transform: translateX(-50%); white-space: nowrap;
  font-size: 9px; font-weight: 600; color: #faf9f5; background: var(--clawd); border-radius: 6px; padding: 0 5px; opacity: .9; }
.minitag:empty { display: none; }

/* effects inside the highlight box */
.fx { position: absolute; inset: 0; }
@keyframes sweep { 0% { transform: scaleX(0); opacity: .35; } 70% { transform: scaleX(1); opacity: .3; } 100% { transform: scaleX(1); opacity: 0; } }
.wash { position: absolute; inset: 0; transform-origin: left; animation: sweep 1.8s ease-in-out infinite; }
@keyframes drip { 0% { transform: translateY(-10px); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(40px); opacity: 0; } }
.drop { position: absolute; top: 0; width: 6px; height: 9px; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; animation: drip 1.4s ease-in infinite; }
@keyframes mist { 0% { transform: scale(.2); opacity: .8; } 100% { transform: scale(1.4); opacity: 0; } }
.puff { position: absolute; width: 22px; height: 22px; border-radius: 50%; filter: blur(3px); animation: mist 1.1s ease-out infinite; }
@keyframes fade { 0%, 100% { opacity: 0; } 50% { opacity: .45; } }
.stripes { position: absolute; inset: 0; background: repeating-linear-gradient(-45deg, rgba(250,249,245,.8) 0 8px, transparent 8px 16px); animation: fade 1.2s infinite; }
@keyframes fall { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(30px); opacity: 0; } }
.dust { position: absolute; bottom: 4px; width: 4px; height: 4px; background: #b9b5aa; animation: fall .9s ease-in infinite; }
@keyframes suck { 0% { transform: translate(0, 0) scale(1); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(.2); opacity: 0; } }
.bit { position: absolute; width: 8px; height: 8px; background: var(--accent); border-radius: 2px; animation: suck 1s ease-in infinite; }
@keyframes blink { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
.caret { position: absolute; left: 8px; top: 8px; width: 2px; height: 18px; background: #1f1e1d; animation: blink .8s steps(1) infinite; }
@keyframes pop { 0% { transform: translateY(6px) scale(.5); opacity: 0; } 30% { transform: none; opacity: 1; } 100% { transform: translateY(-14px); opacity: 0; } }
.glyph { position: absolute; font: 700 16px Georgia, serif; color: #1f1e1d; animation: pop 1.6s ease-out infinite; }
@keyframes wobble { 0%, 100% { transform: scale(1); } 30% { transform: scale(1.02, .98); } 60% { transform: scale(.99, 1.01); } }
.fxbox.wobble { animation: wobble .7s infinite; }
.star { position: absolute; font-size: 16px; color: #f2c94c; animation: blink .7s steps(2) infinite; text-shadow: 0 0 4px #fff; }
.ruler { position: absolute; left: 0; right: 0; top: 50%; height: 0; border-top: 2px solid #3a7bd5; }
.ruler::before, .ruler::after { content: ""; position: absolute; top: -7px; width: 2px; height: 12px; background: #3a7bd5; }
.ruler::before { left: 0; } .ruler::after { right: 0; }
.measure { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -130%); background: #3a7bd5; color: #fff; padding: 2px 7px; border-radius: 6px; font: 600 11px ui-monospace, Consolas, monospace; }
.plus { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font: 700 28px system-ui; color: var(--accent); animation: blink 1s infinite; }
@keyframes rain { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
.matrix { position: absolute; inset: 0; background: rgba(0, 20, 6, .55); }
.col { position: absolute; top: 0; font: 12px/1 ui-monospace, Consolas, monospace; color: #36d15e; text-shadow: 0 0 4px #36d15e; writing-mode: vertical-rl; animation: rain 2.2s linear infinite; }
@keyframes ping { 0% { transform: translate(-50%, -50%) scale(0); opacity: .8; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 0; } }
.radar { position: absolute; left: 50%; top: 50%; width: 160%; aspect-ratio: 1; border: 2px solid #4f9a45; border-radius: 50%; animation: ping 1.8s ease-out infinite; }
@keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.fxbox.bounce { animation: bounce .5s ease-in-out infinite; }
.note { position: absolute; font-size: 18px; color: var(--accent); animation: pop 1.4s ease-out infinite; }
@keyframes flash { 0%, 80%, 100% { opacity: 0; } 84% { opacity: .9; } }
.flash { position: absolute; inset: 0; background: #fff; animation: flash 1.6s infinite; }
@keyframes scanline { 0% { top: 0; } 100% { top: 100%; } }
.scan { position: absolute; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, transparent, var(--accent), transparent); box-shadow: 0 0 8px var(--accent); animation: scanline 1.3s ease-in-out infinite alternate; }
.spark { position: absolute; font-size: 15px; animation: blink .35s steps(2) infinite; }
.gear { position: absolute; right: 6px; top: 6px; font-size: 18px; color: #6b7078; animation: spin 2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.ok-tick { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font: 700 30px system-ui; color: #4f9a45; }
${CLAWD_CSS}`;

  const COLORS = ['#d97757', '#5b8fd9', '#4fa36b', '#a777d6', '#d9a13b', '#d0607e'];
  let host, layer;
  let raf = 0;
  let lastT = 0;
  /** @type {Map<string, object>} */
  const clawds = new Map();
  let colorIx = 0;
  let stepSeq = 0;
  let mouse = null;
  window.addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; }, { passive: true, capture: true });

  // --- Sounds: played by the extension's background page ---------------------------
  const sfxAt = new Map();
  function sfx(name) {
    const now = performance.now();
    if (document.visibilityState !== 'visible' || now - (sfxAt.get(name) || 0) < 60) return;
    sfxAt.set(name, now);
    try {
      if (typeof browser !== 'undefined') browser.runtime.sendMessage({ cmd: 'ClawdSound', data: { name } }).catch(() => {});
    } catch { /* not in an extension (tests) */ }
  }

  // --- Is the dev page broken right now? (Live Clawds get sad until it's fixed) -------
  const BROKEN_SAY = {
    build: 'Oh no… the build broke',
    blank: 'Oh no… the page went blank',
    error: 'Oh no… something threw an error',
  };
  let lastPageError = 0;
  let rootSeen = false;
  let broken = '';
  let brokenCheckAt = 0;
  window.addEventListener('error', e => { if (e && (e.error || e.message)) lastPageError = performance.now(); }, true);
  window.addEventListener('unhandledrejection', () => { lastPageError = performance.now(); }, true);
  function brokenReason(now) {
    if (document.querySelector('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay, react-error-overlay')) return 'build';
    const root = document.getElementById('root') || document.getElementById('app') || document.getElementById('__next');
    if (root) {
      if (root.childElementCount) rootSeen = true;
      else if (rootSeen) return 'blank';
    }
    return now - lastPageError < 4000 ? 'error' : '';
  }
  function checkBroken(now) {
    if (now < brokenCheckAt) return;
    brokenCheckAt = now + 400;
    const next = brokenReason(now);
    if (next === broken) return;
    const was = broken;
    broken = next;
    for (const c of [...clawds.values()]) {
      if (!c.live) continue;
      if (next && !was) { sfx('sad'); c.nextSfx = now + 2600; }
      else if (!next) { sfx('phew'); setLabel(c, 'Phew, fixed!'); c.phewUntil = now + 1500; }
    }
  }
  document.addEventListener('mouseleave', () => { mouse = null; }, { passive: true });

  const el = (tag, cls, parent, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  };
  const vp = () => ({ w: window.innerWidth, h: window.innerHeight });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function ensureLayer() {
    if (!host) {
      host = document.createElement('clawdify-overlay');
      const st = host.style;
      st.setProperty('all', 'initial', 'important');
      st.setProperty('position', 'fixed', 'important');
      st.setProperty('inset', '0', 'important');
      st.setProperty('z-index', '2147483647', 'important');
      st.setProperty('pointer-events', 'none', 'important');
      st.setProperty('display', 'block', 'important');
      const root = host.attachShadow({ mode: 'closed' });
      el('style', null, root, STYLE);
      layer = el('div', 'layer', root);
    }
    // On <html>, not <body>: stays out of the app's own tree and body-level queries.
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
  }

  function hideAll() {
    cancelAnimationFrame(raf);
    raf = 0;
    for (const c of [...clawds.values()]) dropDom(c);
    clawds.clear();
    if (host) host.remove();
  }

  function dropDom(c) {
    for (const n of [c.root, c.glow, c.box, ...c.ghosts, ...[...c.helpers.values()].map(h => h.node)]) n.remove();
  }

  /** Tell the extension a Clawd has left this page (so the sidebar can have him back). */
  function reportGone(c) {
    try {
      if (typeof browser !== 'undefined') {
        browser.runtime.sendMessage({ cmd: 'ClawdGone', data: { id: c.id, dismissed: !!c.dismissed } }).catch(() => {});
      }
    } catch { /* not in an extension (tests) */ }
  }

  function removeClawd(c) {
    dropDom(c);
    clawds.delete(c.id);
    reportGone(c);
    if (!clawds.size) hideAll();
  }

  function setColor(c, color) {
    if (!color || color === c.color) return;
    c.color = color;
    c.root.style.setProperty('--clawd', color);
    c.glow.style.setProperty('--accent', color);
    c.box.style.setProperty('--accent', color);
  }

  function getClawd(id, msg) {
    let c = clawds.get(id);
    if (!c) {
      const glow = el('div', 'glow', layer);
      const box = el('div', 'fxbox', layer);
      const root = el('div', 'sprite', layer);
      const turn = el('div', 'turn', root);
      const svg = clawdSpriteNode(document, SPRITE_W);
      turn.appendChild(svg);
      const hit = el('div', 'hit', root);
      c = {
        id, glow, box, root, turn, svg,
        fx: el('div', 'fx', box),
        hl: box, // effects() animates this one
        label: el('div', 'label', root),
        tagEl: el('div', 'tag', root),
        queue: [], cur: null, ghosts: [], helpers: new Map(),
        pos: null, mood: 'idle', extra: '', idleMood: 'idle', glowRect: null, boxRect: null,
        leaving: false, endAfterQueue: null, lastWork: 0,
        waterUntil: 0, nextWater: 0, throwUntil: 0,
        tickleUntil: 0, tickles: 0, lastTickle: 0, noticeUntil: 0, near: false,
        offset: (clawds.size % 3) * 44, // later Clawds stand a little to the side
      };
      const stop = e => { e.stopPropagation(); e.preventDefault(); };
      hit.addEventListener('mousedown', stop);
      hit.addEventListener('click', e => { stop(e); click(c); });
      clawds.set(id, c);
      setColor(c, msg.color || COLORS[colorIx++ % COLORS.length]);
    }
    if (msg.color) setColor(c, msg.color);
    if (msg.tag != null) c.tagEl.textContent = msg.tag;
    if (msg.live) c.live = true; // a dev page: Live Clawd gets sad when it breaks
    return c;
  }

  function visible(n) {
    if (!n || n === host || !n.getBoundingClientRect) return false;
    const r = n.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(n);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function firstVisible(sel) {
    let list;
    try { list = document.querySelectorAll(sel); } catch { return null; }
    for (const n of list) if (visible(n)) return n;
    return null;
  }

  function findByText(text) {
    if (!text || text.length < 3) return null;
    const needle = text.toLowerCase();
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(), i = 0; n && i < 20000; n = walker.nextNode(), i++) {
      if (n.data.toLowerCase().includes(needle) && visible(n.parentElement)) return n.parentElement;
    }
    return null;
  }

  /**
   * Dev builds of React keep component names on the fiber tree hanging off DOM nodes.
   * Firefox lets content scripts read page objects through `wrappedJSObject`.
   */
  function findByComponent(names) {
    if (!names || !names.length) return null;
    const want = new Set(names);
    const raw = n => n && (n.wrappedJSObject || n);
    let rootFiber = null;
    for (const n of [document.getElementById('root'), document.getElementById('app'), document.body, ...(document.body ? document.body.children : [])]) {
      const w = raw(n);
      if (!w) continue;
      let key;
      try { key = Object.keys(w).find(k => k.startsWith('__reactContainer$')); } catch { /* xray */ }
      if (key) { rootFiber = w[key]; break; }
    }
    if (!rootFiber) return null;
    const nameOf = f => {
      const t = f && f.type;
      if (!t || typeof t === 'string') return '';
      return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || '';
    };
    const hostNode = f => {
      for (let q = f, i = 0; q && i < 200; i++) {
        if (q.tag === 5 && q.stateNode && visible(q.stateNode)) return q.stateNode;
        q = q.child || (q === f ? null : nextOf(q, f));
      }
      return null;
    };
    const nextOf = (q, stop) => {
      while (q && q !== stop) {
        if (q.sibling) return q.sibling;
        q = q.return;
      }
      return null;
    };
    // One pass over the tree, then pick by the caller's priority (the most specific
    // component first; a parent like the file's own component is only a fallback).
    const found = new Map();
    const stack = [rootFiber.current || rootFiber];
    for (let seen = 0; stack.length && seen < 30000 && found.size < want.size; seen++) {
      const f = stack.pop();
      if (!f) continue;
      const nm = nameOf(f);
      if (want.has(nm) && !found.has(nm)) {
        const n = hostNode(f.child || f);
        if (n) found.set(nm, n);
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    for (const nm of names) if (found.has(nm)) return found.get(nm);
    return null;
  }

  /**
   * The element a step is about: a component, selector, test id, visible text (from
   * Claude's `clawd` call) or the guessed selectors/components/grep pattern.
   */
  function resolve(step) {
    const t = step.target || {};
    const tries = [];
    if (t.testid) tries.push(() => firstVisible(`[data-testid="${CSS.escape(t.testid)}"]`));
    if (t.selector) tries.push(() => firstVisible(t.selector));
    if (t.component) tries.push(() => findByComponent([t.component]));
    if (t.text) tries.push(() => findByText(t.text));
    for (const s of step.selectors || []) tries.push(() => firstVisible(s));
    if (step.components && step.components.length) tries.push(() => findByComponent(step.components));
    if (step.pattern) {
      tries.push(() => firstVisible(step.pattern));
      for (const tok of (step.pattern.match(/[A-Za-z][\w-]{2,}/g) || []).slice(0, 6)) {
        tries.push(() => firstVisible(`#${CSS.escape(tok)}`) || firstVisible(`.${CSS.escape(tok)}`)
          || firstVisible(`[class*="${tok}" i]`) || firstVisible(`[id*="${tok}" i]`));
      }
      tries.push(() => findByText(step.pattern.replace(/\\[sdwb]|[\\^$.*+?()[\]{}|]/g, ' ').trim().split(/\s{2,}/)[0]));
    }
    for (const f of tries) {
      try {
        const n = f();
        if (n) return n;
      } catch { /* bad selector, unreadable fibers, … */ }
    }
    return null;
  }

  const hasTarget = step => {
    const t = step.target || {};
    return !!(t.testid || t.selector || t.component || t.text || (step.selectors || []).length
      || (step.components || []).length || step.pattern);
  };

  /** The box a step works on: the live element, else (removed by hot reload) its last box. */
  function stepRect(step) {
    if (step.el && step.el.isConnected) {
      step.rect = step.el.getBoundingClientRect();
      step.gone = false;
    } else if (step.el && step.rect) {
      step.gone = true; // keep working on where it was
    }
    return step.rect || null;
  }

  /** The exact spot he works at: a point inside the target (canvas…), else null. */
  function stepPoint(step, r) {
    const t = step.target || {};
    if (!r || t.x == null || t.y == null) return null;
    return { x: r.left + clamp(t.x, 0, 1) * r.width, y: r.top + clamp(t.y, 0, 1) * r.height };
  }

  /** Where his feet go: next to the point, or on the target's top edge, else bottom-right. */
  function destination(c) {
    const { w, h } = vp();
    if (c.leaving && !c.cur && !c.queue.length) {
      const exitLeft = c.pos && c.pos.x + FOOT_X < w / 2;
      return { x: exitLeft ? -SPRITE_W - 20 : w + 20, y: c.pos ? c.pos.y : h - BELOW - FOOT_Y };
    }
    const step = c.cur;
    const r = step && stepRect(step);
    let fx;
    let fy;
    const pt = step && stepPoint(step, r);
    if (pt) {
      fx = pt.x - HAND.x; // hand on the spot
      fy = pt.y + HAND.y;
    } else if (r) {
      fx = r.left + Math.min(56, r.width / 2) + c.offset;
      fy = r.top > SPRITE_H + 24 ? r.top + 4 : Math.min(r.bottom, r.top + SPRITE_H + 12);
    } else {
      fx = w - 70 - c.offset * 2;
      fy = h - BELOW;
    }
    // Keep all of him on screen: caption above, name tag below.
    fx = clamp(fx, FOOT_X + 4, w - (SPRITE_W - FOOT_X) - 4);
    fy = clamp(fy, FOOT_Y + 26, h - BELOW);
    return { x: fx - FOOT_X, y: fy - FOOT_Y };
  }

  const lerpRect = (a, b, k) => (a ? {
    left: a.left + (b.left - a.left) * k, top: a.top + (b.top - a.top) * k,
    width: a.width + (b.width - a.width) * k, height: a.height + (b.height - a.height) * k,
  } : { ...b });
  const place = (n, r) => {
    n.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`;
    n.style.width = `${Math.round(r.width)}px`;
    n.style.height = `${Math.round(r.height)}px`;
  };

  /** Glow around the target (or a ring round the spot), effects where his hand is. */
  function placeGlow(c, working) {
    const step = c.cur;
    const r = working && step && step.rect;
    const { w, h } = vp();
    if (!r) {
      c.glow.classList.remove('on');
      c.box.classList.remove('on');
      return;
    }
    const pt = stepPoint(step, r);
    let g = pt ? { left: pt.x - 26, top: pt.y - 26, width: 52, height: 52 }
      : { left: r.left - 6, top: r.top - 6, width: r.width + 12, height: r.height + 12 };
    g = { left: clamp(g.left, 2, w - 10), top: clamp(g.top, 2, h - 10), width: Math.min(g.width, w - 4), height: Math.min(g.height, h - 4) };
    c.glowRect = lerpRect(c.glowRect, g, 0.22);
    place(c.glow, c.glowRect);
    c.glow.style.borderRadius = pt ? '50%' : '12px';
    c.glow.classList.toggle('on', !step.gone || !!step.cover);
    // Effects: a patch around his hand (or the spot), inside the target.
    const hx = pt ? pt.x : c.pos.x + FOOT_X + HAND.x;
    const hy = pt ? pt.y : c.pos.y + FOOT_Y - HAND.y;
    const bw = Math.min(r.width, 220);
    const bh = Math.min(r.height, 130);
    const b = {
      left: clamp(hx - bw / 2, r.left, r.right - bw),
      top: clamp(hy - bh / 2, r.top, r.bottom - bh),
      width: bw,
      height: bh,
    };
    c.boxRect = lerpRect(c.boxRect, b, 0.22);
    place(c.box, c.boxRect);
    c.box.classList.add('on');
  }

  function setLabel(c, text) {
    text = plainSay(text);
    if (c.label.textContent === text) return;
    c.label.textContent = text;
    c.labelW = 0; // re-measure
  }

  /** Keep the caption bubble on screen when Clawd stands near an edge. */
  function placeLabel(c) {
    if (!c.label.textContent) return;
    if (!c.labelW) c.labelW = c.label.offsetWidth;
    const half = c.labelW / 2;
    const centre = clamp(c.pos.x + SPRITE_W / 2, half + 4, vp().w - half - 4);
    c.label.style.left = `${Math.round(centre - c.pos.x)}px`;
  }

  function show(c, m, now) {
    const extra = [c.tickleUntil > now && 'cw-tickle', c.noticeUntil > now && 'cw-notice'].filter(Boolean).join(' ');
    if (m === c.mood && extra === c.extra) return;
    c.mood = m;
    c.extra = extra;
    setMood(c.svg, m, extra);
  }

  function click(c) {
    // A Clawd waving for attention is dismissed by a click (until Claude has news).
    if (c.cur && c.cur.kind === 'wave') {
      c.dismissed = true;
      sfx('pop');
      c.queue = [];
      c.cur = { kind: 'idle', say: 'OK, I’ll wait', ms: 700, id: ++stepSeq };
      c.leaving = true;
      return;
    }
    const now = performance.now();
    if (now - c.lastTickle > 3000) c.tickles = 0;
    c.lastTickle = now;
    setLabel(c, TICKLES[Math.min(c.tickles++, TICKLES.length - 1)]);
    c.tickleUntil = now + 1300;
    sfx('giggle');
  }

  /** Eyes follow a nearby cursor; he gives a little start when it first comes close. */
  function watchCursor(c, now) {
    if (!mouse) { if (c.near) { c.near = false; lookAt(c.svg, null); } return; }
    const flip = c.turn.classList.contains('flip');
    const dx = mouse.x - (c.pos.x + (flip ? SPRITE_W - EYES.x : EYES.x));
    const dy = mouse.y - (c.pos.y + EYES.y);
    const near = Math.hypot(dx, dy) < NEAR;
    if (near) {
      if (!c.near && /^(idle|done|think|read)$/.test(c.mood)) { c.noticeUntil = now + 350; sfx('boop'); }
      lookAt(c.svg, flip ? -dx : dx, dy);
    } else if (c.near) {
      lookAt(c.svg, null);
    }
    c.near = near;
  }

  /** Where his hand is, in viewport px (for the bottle toss). */
  function handPos(c) {
    const flip = c.turn.classList.contains('flip');
    const hx = (15 - VIEWBOX.x) * UNIT;
    return { x: c.pos.x + (flip ? SPRITE_W - hx : hx), y: c.pos.y + (1 - VIEWBOX.y) * UNIT, dir: flip ? -1 : 1 };
  }

  const COVER_MAX_MS = 8000; // never hide a real change for longer than this

  /** Lay the "before" picture over its element, under every Clawd. */
  function showCover(c, step, now) {
    if (step.cover || !step.coverSrc) return;
    const img = el('img', 'cover');
    layer.insertBefore(img, layer.firstChild);
    img.src = step.coverSrc;
    img.style.width = `${step.crop.width}px`;
    img.style.height = `${step.crop.height}px`;
    step.cover = img;
    step.coverAt = now;
    c.ghosts.push(img);
    placeCover(step);
  }

  /** Keep a cover on its element as the page scrolls (until the element is gone). */
  function placeCover(step) {
    let x = step.crop.left;
    let y = step.crop.top;
    if (step.el && step.el.isConnected) {
      const r = step.el.getBoundingClientRect();
      x = r.left + step.cropOff.x;
      y = r.top + step.cropOff.y;
      step.crop = { ...step.crop, left: x, top: y };
    }
    step.cover.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Clawd's action reveals what's under the cover: the new version (or nothing). */
  function reveal(c, step, how) {
    const img = step.cover;
    if (!img || step.revealing) return;
    step.revealing = true;
    const dur = Math.round(Math.min(2200, Math.max(700, (step.ms || 2000) * 0.7)));
    const st = img.style;
    const hand = handPos(c);
    const fromLeft = hand.x < step.crop.left + step.crop.width / 2;
    switch (how) {
    case 'suck': // into the vacuum nozzle
      sfx('slurp');
      st.transition = 'transform 1.1s cubic-bezier(.6, 0, .9, .5), opacity 1.1s ease-in';
      requestAnimationFrame(() => {
        st.transform = `translate(${hand.x}px, ${hand.y}px) scale(.03)`;
        st.opacity = '0';
      });
      break;
    case 'wipe': // brushed away, from the side he's painting from
      st.transition = `clip-path ${dur}ms linear`;
      requestAnimationFrame(() => { st.clipPath = fromLeft ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)'; });
      break;
    case 'rub': // rubbed out, in fits and starts
      st.transition = `opacity ${dur}ms steps(6), filter ${dur}ms linear`;
      requestAnimationFrame(() => { st.opacity = '0'; st.filter = 'blur(3px)'; });
      break;
    default: // a crossfade while he works
      st.transition = `opacity 900ms ease-in-out ${Math.round(dur * 0.35)}ms`;
      requestAnimationFrame(() => { st.opacity = '0'; });
    }
    setTimeout(() => { img.remove(); c.ghosts = c.ghosts.filter(x => x !== img); }, dur + 1300);
  }

  const revealStyle = kind => (kind === 'remove' ? 'suck' : /^(paint|spray)$/.test(kind) ? 'wipe' : kind === 'erase' ? 'rub' : 'fade');

  /** Every frame: covers follow their elements; none outstays COVER_MAX_MS. */
  function trackCovers(c, now) {
    for (const st of [c.cur, ...c.queue]) {
      if (!st || !st.cover || st.revealing) continue;
      placeCover(st);
      if (now - st.coverAt > COVER_MAX_MS) reveal(c, st, 'fade');
    }
  }

  /** Start the next step in the queue. */
  function begin(c, now) {
    const step = c.queue.shift();
    c.cur = step;
    step.startedAt = now;
    step.arrivedAt = 0;
    if (!step.el && hasTarget(step)) step.el = resolve(step);
    step.retryUntil = !step.el && hasTarget(step) ? now + 4000 : 0;
    if (step.say != null) setLabel(c, step.say);
    c.pondering = false;
    c.missUntil = 0;
    c.fx.replaceChildren();
    c.glowRect = c.glowRect && step.el ? c.glowRect : null;
    c.glow.classList.remove('ok');
  }

  function arrive(c, now) {
    const step = c.cur;
    step.arrivedAt = now;
    c.nextSfx = 0;
    if (step.kind === 'done') sfx('happy');
    else if (step.kind === 'error') sfx('sad');
    else if (step.kind === 'cheer') sfx('yes');
    else if (step.kind === 'facepalm') sfx('facepalm');
    else if (step.kind === 'timer') setTimeout(() => c.cur === step && sfx('ding'), 1700);
    // Backed up? Get through it quicker rather than skipping anything.
    const hurry = c.queue.length >= 3 ? 0.5 : 1;
    step.endAt = now + Math.max(900, step.ms * hurry);
    if (step.kind === 'done') {
      if (step.rect) c.glow.classList.add('ok');
    } else if (!/^(idle|wave|error|think|test|compile|install|mail|timer|compact|cheer|facepalm)$/.test(step.kind)) {
      effects(c, { kind: step.kind, color: step.color, measure: step.measure });
    }
    if (step.cover) reveal(c, step, revealStyle(step.kind));
  }

  function finishStep(c) {
    const step = c.cur;
    c.cur = null;
    c.fx.replaceChildren();
    if (step && step.cover) reveal(c, step, 'fade');
    if (step) c.idleMood = step.kind === 'done' || step.kind === 'error' ? step.kind : 'idle';
    if (!c.queue.length && c.endAfterQueue && c.helpers.size) {
      c.waitBabies = true; // not without the babies still out working
      setLabel(c, '');
    } else if (!c.queue.length && c.endAfterQueue) {
      c.leaving = true;
      setLabel(c, c.idleMood === 'error' ? '' : 'Bye!');
    } else if (!c.queue.length) {
      setLabel(c, '');
    }
  }

  /** The page is broken (or just got fixed): stand still, mope (or cheer), pause the queue. */
  function moping(c, now, dt) {
    const sad = broken && c.live;
    const phew = c.phewUntil > now;
    if (!sad && !phew) {
      if (c.phewUntil) { c.phewUntil = 0; setLabel(c, c.cur ? c.cur.say || '' : ''); }
      return false;
    }
    if (c.cur && c.cur.endAt) c.cur.endAt += dt * 1000;
    if (sad) setLabel(c, BROKEN_SAY[broken]); // also covers a Clawd that walks on mid-breakage
    if (sad && now > (c.nextSfx || 0)) { sfx('sniffle'); c.nextSfx = now + 2600; }
    show(c, sad ? 'sad' : 'done', now);
    c.glow.classList.remove('on');
    c.box.classList.remove('on');
    c.root.style.transform = `translate(${Math.round(c.pos.x)}px, ${Math.round(c.pos.y)}px)`;
    placeLabel(c);
    return true;
  }

  function update(c, now, dt) {
    if (c.pos && moping(c, now, dt)) return;
    const s = c.cur;
    if (!s && c.queue.length) begin(c, now);
    const cur = c.cur;
    // Targets that aren't rendered yet (hot reload still applying) get a few retries.
    if (cur && cur.retryUntil > now && now > (cur.retryAt || 0)) {
      cur.retryAt = now + 300;
      const t = resolve(cur);
      if (t) { cur.el = t; cur.retryUntil = 0; }
    }
    trackCovers(c, now);
    const dest = destination(c);
    if (!c.pos) {
      // Walk on from the nearer side of the screen.
      const fromLeft = dest.x + FOOT_X < vp().w / 2;
      c.pos = { x: fromLeft ? -SPRITE_W - 10 : vp().w + 10, y: dest.y };
    }
    const dx = dest.x - c.pos.x;
    const dy = dest.y - c.pos.y;
    const dist = Math.hypot(dx, dy);
    const moving = dist > (c.mood === 'walk' ? 2 : 30);
    watchCursor(c, now);
    if (c.tickleUntil && now > c.tickleUntil) {
      c.tickleUntil = 0;
      setLabel(c, c.cur ? c.cur.say || '' : '');
    }
    if (moving) {
      const sp = dist > 400 ? RUN : SPEED;
      const k = Math.min(dist, sp * dt);
      c.stepAcc = (c.stepAcc || 0) + dt;
      if (c.stepAcc > (sp === RUN ? 0.11 : 0.17)) { c.stepAcc = 0; sfx('step'); }
      c.pos.x += dx / dist * k;
      c.pos.y += dy / dist * k;
      if (Math.abs(dx) > 2) c.turn.classList.toggle('flip', dx < 0);
      show(c, 'walk', now);
    } else {
      if (dist > 0.5) { c.pos.x += dx * 0.3; c.pos.y += dy * 0.3; }
      if (c.leaving && !c.cur && !c.queue.length) { removeClawd(c); return; }
      if (cur && !cur.arrivedAt) {
        // Face the spot he's working on.
        if (stepPoint(cur, cur.rect)) c.turn.classList.remove('flip');
        arrive(c, now);
      }
      if (cur && now > cur.endAt) finishStep(c);
      else if (cur) {
        c.lastWork = now;
        const mood = cur.hold ? heldMood(c, cur, now) : cur.kind === 'paint' && !cur.rect ? 'canvas' : cur.kind;
        show(c, mood, now);
        const snd = ACTION_SOUNDS[mood];
        if (snd && now > (c.nextSfx || 0) && !cur.rung) {
          sfx(snd[0]);
          c.nextSfx = now + snd[1];
          if (mood === 'wave') cur.rung = true; // the reminder dings once, not on repeat
        }
      } else {
        idle(c, now);
      }
    }
    placeGlow(c, !!(c.cur && c.cur.arrivedAt && !moving));
    c.root.style.transform = `translate(${Math.round(c.pos.x)}px, ${Math.round(c.pos.y)}px)`;
    placeLabel(c);
  }

  /** Between steps: water breaks while the session is busy (and bottle tossing). */
  function idle(c, now) {
    const busy = now - c.lastWork < 60000 && !/^(done|error)$/.test(c.idleMood) && !c.leaving;
    if (!c.nextWater) c.nextWater = now + 9000 + Math.random() * 9000;
    if (busy && now > c.nextWater && !c.waterUntil && !c.throwUntil) {
      c.waterUntil = now + 3000; // matches the one-shot drinking animation
      [700, 1150, 1600, 2050].forEach(t => setTimeout(() => c.waterUntil && sfx('glug'), t));
      setTimeout(() => c.waterUntil && sfx('ahh'), 2750);
      setLabel(c, MOOD_LABEL.water);
    }
    if (c.waterUntil && now > c.waterUntil) {
      c.waterUntil = 0;
      c.throwUntil = now + 450;
      c.nextWater = now + 22000 + Math.random() * 20000;
    }
    if (c.throwUntil && now > c.throwUntil) {
      c.throwUntil = 0;
      const hand = handPos(c);
      const aim = mouse || { x: hand.x + hand.dir * 260, y: hand.y - 220 };
      tossBottle(document, layer, hand.x, hand.y, aim.x, aim.y, mouse && {
        cursor: () => mouse,
        onHit: () => sfx('dink'),
        onMiss: () => {
          if (!clawds.has(c.id) || c.cur) return; // busy again: let it go
          c.missUntil = performance.now() + 2200;
          setLabel(c, DODGED[Math.floor(Math.random() * DODGED.length)]);
          sfx('sniffle');
        },
      });
      sfx('whoosh');
      setLabel(c, '');
    }
    // You dodged the bottle: a moment of moping.
    const sulking = c.missUntil > now;
    if (c.missUntil && !sulking) { c.missUntil = 0; setLabel(c, ''); }
    // Quiet for a while mid-session: Claude's thinking, so he works at the chalkboard.
    const ponder = busy && now - c.lastWork > PONDER_AFTER && !c.waterUntil && !c.throwUntil && !sulking;
    if (ponder && !c.pondering) setLabel(c, MOOD_LABEL.ponder);
    c.pondering = ponder;
    if (ponder && now > (c.nextSfx || 0)) { sfx('scribble'); c.nextSfx = now + 1700; }
    show(c, c.waterUntil ? 'water' : c.throwUntil ? 'throw' : sulking ? 'sad' : ponder ? 'ponder' : c.idleMood, now);
  }

  /**
   * A tool that's still running: its own animation at first; a long one has him sit
   * down with a book or some knitting, and a very long one nod off. A long think goes to
   * the chalkboard instead.
   */
  function heldMood(c, step, now) {
    const t = now - step.arrivedAt;
    let mood = step.kind;
    if (step.kind === 'think') {
      if (t > PONDER_AFTER) mood = 'ponder';
    } else if (step.kind !== 'compact') {
      if (t > DOZE_AFTER) mood = 'doze';
      else if (t > SIT_AFTER) mood = step.sit || (step.sit = Math.random() < 0.5 ? 'wait' : 'knit');
    }
    if (mood === 'doze' && !step.dozing) { step.dozing = true; sfx('yawn'); c.nextSfx = now + 3000; }
    return mood;
  }

  /** Stop holding a step: it gets its normal minimum time, or ends now if it's had that. */
  function release(c, step, now) {
    if (!step || !step.hold) return;
    step.hold = false;
    if (step.arrivedAt) {
      step.endAt = Math.min(step.endAt, Math.max(now, step.arrivedAt + GUESS_MS));
      if (step.dozing) { c.noticeUntil = now + 350; sfx('boop'); } // woken with a start
    } else {
      step.ms = GUESS_MS;
    }
  }

  /** Which tools have ended (an 'end' can beat its own 'act' here). */
  const ended = new Map();

  /** A tool finished: stop holding its step, and react if it was a task like the tests. */
  function endTool(c, msg) {
    const now = performance.now();
    ended.set(msg.toolId, now);
    if (ended.size > 60) ended.delete(ended.keys().next().value);
    const all = [c.cur, ...c.queue];
    const step = all.find(x => x && x.toolId === msg.toolId && x.hold);
    if (!step) return;
    release(c, step, now);
    const said = TASK_RESULT[step.task];
    if (!said || msg.interrupted) return;
    const react = {
      kind: msg.ok ? 'cheer' : 'facepalm', say: said[msg.ok ? 0 : 1], ms: REACT_MS,
      guess: true, react: true, id: ++stepSeq,
    };
    const at = c.queue.indexOf(step);
    c.queue.splice(at + 1, 0, react); // right after it (at -1: it's the current one)
  }

  // --- Subagents: baby Clawds lined up left of where he rests, acting out their tasks --
  const BABY_GAP = 8; // px between babies
  const BABY_IDLE_MS = 15 * 60000; // a baby nobody's heard from in this long goes home

  /** A baby Clawd of the same colour, for a subagent. */
  function makeMini(c, label) {
    const node = el('div', 'mini', layer);
    node.style.setProperty('--clawd', c.color || '#d97757');
    const turn = el('div', 'turn', node);
    const derp = el('div', 'derp', turn); // toddling, wobbles and tumbles
    const svg = clawdSpriteNode(document, MINI_W);
    derp.appendChild(svg);
    el('div', 'minitag', node, label || '');
    return {
      node, turn, derp, svg, kind: 'idle', walking: false, nextPlop: 0, seen: performance.now(),
    };
  }

  const MINI_FEET = (10 - VIEWBOX.y) * MINI_W / VIEWBOX.w;

  /** Walk a baby from where it is to (x, y) — its feet — then call `done`. */
  function walkMini(h, x, y, mood, done) {
    const from = h.at || { x, y };
    const dist = Math.hypot(x - from.x, y - from.y);
    const secs = Math.max(0.3, dist / MINI_SPEED);
    h.turn.classList.toggle('flip', x < from.x);
    setMood(h.svg, mood);
    h.walking = true;
    h.node.style.transitionDuration = '0s';
    h.node.style.transform = `translate(${Math.round(from.x - MINI_W / 2)}px, ${Math.round(from.y - MINI_FEET)}px)`;
    void h.node.offsetWidth; // start from there
    h.node.style.transitionDuration = `${secs}s`;
    h.node.style.transform = `translate(${Math.round(x - MINI_W / 2)}px, ${Math.round(y - MINI_FEET)}px)`;
    h.at = { x, y };
    clearTimeout(h.timer);
    h.timer = setTimeout(() => { h.walking = false; done(); }, secs * 1000 + 30);
  }

  /** Where Clawd's feet go when he's resting (no target): bottom right. */
  function restSpot(c) {
    const { w, h } = vp();
    return { x: clamp(w - 70 - c.offset * 2, FOOT_X + 4, w - (SPRITE_W - FOOT_X) - 4), y: h - BELOW };
  }

  /** Where Clawd's feet are now (or will be). */
  function feetOf(c) {
    if (c.pos) return { x: c.pos.x + FOOT_X, y: c.pos.y + FOOT_Y };
    const d = destination(c);
    return { x: d.x + FOOT_X, y: d.y + FOOT_Y };
  }

  /** Line the babies up leftwards from Clawd's resting spot, facing him. */
  function layoutBabies(c) {
    const rest = restSpot(c);
    let i = 0;
    for (const h of [...c.helpers.values()]) {
      if (h.returning) continue;
      const x = Math.max(MINI_W / 2 + 2, rest.x - SPRITE_W / 2 - MINI_W / 2 - 4 - i++ * (MINI_W + BABY_GAP));
      if (h.slot && h.slot.x === x && h.slot.y === rest.y) continue;
      h.slot = { x, y: rest.y };
      walkMini(h, x, rest.y, 'walk', () => {
        h.turn.classList.remove('flip');
        setMood(h.svg, h.kind);
      });
    }
  }

  /**
   * A subagent: starts (a baby toddles out to its place), does something (acts out that
   * tool call; 'idle' between them) or finishes (brings Clawd the results, then goes).
   */
  function helper(c, msg) {
    const key = String(msg.agentId || '');
    let h = c.helpers.get(key);
    if (msg.on === false) {
      if (!h) return;
      h.returning = true;
      layoutBabies(c); // the others close up
      const home = feetOf(c);
      // Back with the results: parcel overhead, then a happy hop, then gone.
      walkMini(h, home.x - SPRITE_W / 2 + 4, home.y, 'fetch', () => {
        setMood(h.svg, 'done');
        sfx('chime');
        h.timer = setTimeout(() => {
          h.node.classList.add('gone');
          setTimeout(() => dropBaby(c, key), 450);
        }, 1300);
      });
      return;
    }
    if (!h) {
      h = makeMini(c, msg.on ? msg.label : '');
      c.helpers.set(key, h);
      h.at = feetOf(c); // toddles out from Clawd
      sfx('pop');
      layoutBabies(c);
    }
    h.seen = performance.now();
    if (msg.kind) {
      h.kind = msg.kind;
      if (!h.walking) setMood(h.svg, h.kind);
    }
  }

  function dropBaby(c, key) {
    const h = c.helpers.get(key);
    if (h) { clearTimeout(h.timer); h.node.remove(); }
    c.helpers.delete(key);
    // He waited for them before heading off.
    if (!c.helpers.size && c.waitBabies && c.endAfterQueue && !c.cur && !c.queue.length) {
      c.waitBabies = false;
      c.leaving = true;
      setLabel(c, c.idleMood === 'error' ? '' : 'Bye!');
    }
  }

  /** Every frame: babies now and then trip over; forgotten ones go home. */
  function tickBabies(c, now) {
    for (const [key, h] of [...c.helpers]) {
      if (h.returning) continue;
      if (now - h.seen > BABY_IDLE_MS) { dropBaby(c, key); continue; }
      if (!h.nextPlop) h.nextPlop = now + 6000 + Math.random() * 10000;
      if (now > h.nextPlop && !h.walking) {
        h.nextPlop = now + 8000 + Math.random() * 14000;
        h.derp.classList.remove('plop');
        void h.derp.offsetWidth;
        h.derp.classList.add('plop');
        setTimeout(() => sfx('squeak'), 350);
      }
    }
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if ([...clawds.values()].some(c => c.live)) checkBroken(now);
    for (const c of [...clawds.values()]) {
      update(c, now, dt);
      if (c.helpers.size) tickBabies(c, now);
    }
  }

  /** Effects drawn over the element being worked on, by kind of change. */
  function effects(c, a) {
    const { fx: fxEl, hl, svg } = c;
    fxEl.replaceChildren();
    hl.classList.remove('wobble', 'bounce', 'ok');
    const color = a.color && CSS.supports('color', a.color) ? a.color : '#d97757';
    hl.style.setProperty('--paint', color);
    svg.style.setProperty('--paint', color);
    const rnd = (min, max) => min + Math.random() * (max - min);
    const at = (n, l, t) => { n.style.left = l; n.style.top = t; return n; };
    switch (a.kind) {
    case 'paint': {
      el('div', 'wash', fxEl).style.background = color;
      for (let i = 0; i < 5; i++) {
        const d = at(el('div', 'drop', fxEl), `${10 + i * 19}%`, '0');
        d.style.background = color;
        d.style.animationDelay = `${i * 0.27}s`;
      }
      break;
    }
    case 'spray':
      for (let i = 0; i < 7; i++) {
        const p = at(el('div', 'puff', fxEl), `${rnd(5, 90)}%`, `${rnd(5, 80)}%`);
        p.style.background = color;
        p.style.animationDelay = `${i * 0.16}s`;
      }
      break;
    case 'erase':
      el('div', 'stripes', fxEl);
      for (let i = 0; i < 6; i++) at(el('div', 'dust', fxEl), `${rnd(5, 95)}%`, 'auto').style.animationDelay = `${rnd(0, 0.9)}s`;
      break;
    case 'remove':
      for (let i = 0; i < 9; i++) {
        const b = at(el('div', 'bit', fxEl), `${rnd(20, 90)}%`, `${rnd(20, 90)}%`);
        b.style.setProperty('--dx', `${-rnd(40, 160)}px`);
        b.style.setProperty('--dy', `${-rnd(20, 90)}px`);
        b.style.animationDelay = `${rnd(0, 1)}s`;
      }
      break;
    case 'write':
    case 'font': {
      el('div', 'caret', fxEl);
      const glyphs = a.kind === 'font' ? ['A', 'a', 'Ag', 'Aa'] : ['a', 'b', 'c', '✎'];
      glyphs.forEach((g, i) => {
        const n = at(el('div', 'glyph', fxEl, g), `${12 + i * 18}%`, '30%');
        if (a.kind === 'font') n.style.fontSize = `${14 + i * 5}px`;
        n.style.animationDelay = `${i * 0.35}s`;
      });
      break;
    }
    case 'build':
      hl.classList.add('wobble');
      ['✦', '✧', '✦'].forEach((s, i) => { at(el('div', 'star', fxEl, s), `${8 + i * 6}%`, `${6 + i * 9}%`).style.animationDelay = `${i * 0.2}s`; });
      break;
    case 'measure':
      el('div', 'ruler', fxEl);
      el('div', 'measure', fxEl, a.measure || '↔ resizing');
      break;
    case 'add':
      el('div', 'plus', fxEl, '+');
      for (let i = 0; i < 6; i++) at(el('div', 'star', fxEl, '✦'), `${rnd(5, 90)}%`, `${rnd(5, 80)}%`).style.animationDelay = `${rnd(0, 0.7)}s`;
      break;
    case 'wire':
      [['4%', '6%'], ['86%', '10%'], ['8%', '70%'], ['84%', '74%']].forEach(([l, t], i) => {
        at(el('div', 'spark', fxEl, '⚡'), l, t).style.animationDelay = `${i * 0.09}s`;
      });
      break;
    case 'hack': {
      el('div', 'matrix', fxEl);
      const chars = 'アイウエオカキクケコ01ﾊﾋﾌﾍﾎ<>{}#$';
      for (let i = 0; i < 14; i++) {
        let s = '';
        for (let j = 0; j < 14; j++) s += chars[Math.floor(Math.random() * chars.length)];
        const col = at(el('div', 'col', fxEl, s), `${i * 7.2}%`, '0');
        col.style.animationDelay = `${-rnd(0, 2.2)}s`;
        col.style.animationDuration = `${rnd(1.6, 3)}s`;
      }
      break;
    }
    case 'watch':
      el('div', 'radar', fxEl);
      el('div', 'radar', fxEl).style.animationDelay = '.9s';
      break;
    case 'dance':
      hl.classList.add('bounce');
      ['♪', '♫', '♪'].forEach((s, i) => { at(el('div', 'note', fxEl, s), `${15 + i * 30}%`, '40%').style.animationDelay = `${i * 0.45}s`; });
      break;
    case 'photo':
      el('div', 'flash', fxEl);
      break;
    case 'polish':
      for (let i = 0; i < 5; i++) at(el('div', 'star', fxEl, '✦'), `${rnd(3, 92)}%`, `${rnd(3, 85)}%`).style.animationDelay = `${rnd(0, 0.7)}s`;
      break;
    case 'search':
      el('div', 'scan', fxEl);
      break;
    default:
      el('div', 'gear', fxEl, '⚙');
    }
  }

  // Changes that show up visually get a "before" cover; logic-only ones and new
  // elements (nothing to picture yet) don't.
  const COVERED = /^(remove|erase|paint|spray|polish|font|write|build|measure|dance|photo|tinker)$/;
  /** How far (px, plus 30% of the element's smaller side) a change of this kind may spill out. */
  const GROWS = { font: 24, write: 24, measure: 48, build: 48, polish: 16, dance: 16, photo: 16 };

  /** A choreography from Claude: queue it; report what it's about to change. */
  function play(c, msg) {
    // Claude's own steps replace any guesses still waiting.
    c.queue = c.queue.filter(st => !st.guess);
    if (c.cur && c.cur.guess) c.cur.endAt = 0;
    c.leaving = false;
    c.endAfterQueue = null;
    c.dismissed = false;
    const ghosts = [];
    for (const st of msg.steps || []) {
      const s = { ...st, id: ++stepSeq };
      if (COVERED.test(s.kind)) {
        // Find it now, before the edit lands, so it can be snapshotted.
        s.el = resolve(s);
        if (s.el) {
          const r = s.el.getBoundingClientRect();
          s.rect = r;
          const { w, h } = vp();
          // Changes that can grow the element also get a margin of its surroundings, so
          // the bigger new version doesn't peek out from under the cover.
          const pad = GROWS[s.kind] ? Math.round(GROWS[s.kind] + Math.min(r.width, r.height) * 0.3) : 0;
          const crop = {
            left: Math.max(0, r.left - pad), top: Math.max(0, r.top - pad),
            width: Math.min(r.right + pad, w) - Math.max(0, r.left - pad),
            height: Math.min(r.bottom + pad, h) - Math.max(0, r.top - pad),
          };
          if (crop.width > 2 && crop.height > 2 && crop.width * crop.height < w * h * 0.6) {
            // (Not for huge targets: covering most of the page would hide too much.)
            s.crop = crop;
            s.cropOff = { x: crop.left - r.left, y: crop.top - r.top };
            ghosts.push({ step: s.id, rect: crop });
          }
        }
      }
      c.queue.push(s);
    }
    return { ghosts, dpr: window.devicePixelRatio || 1 };
  }

  function attachGhosts(c, msg) {
    const now = performance.now();
    for (const g of msg.ghosts || []) {
      const st = [c.cur, ...c.queue].find(x => x && x.id === g.step);
      if (st && g.src && !st.revealing) { st.coverSrc = g.src; showCover(c, st, now); }
    }
  }

  /** A guessed action (job events, hook fallbacks): only when Claude isn't choreographing. */
  function guess(c, a) {
    const busyWithClaude = (c.cur && !c.cur.guess && c.cur.kind !== 'idle') || c.queue.some(s => !s.guess);
    const s = {
      kind: a.kind, say: a.label || '', ms: GUESS_MS, color: a.color, measure: a.measure,
      selectors: a.selectors, components: a.components, pattern: a.pattern, sign: a.sign, guess: true, id: ++stepSeq,
      toolId: a.toolId, task: a.task,
    };
    // Running until its tool ends (unless that already happened).
    // (An end only ever beats its own start by moments; 'compact' comes round again.)
    if (a.hold && a.toolId && !(performance.now() - (ended.get(a.toolId) || -1e9) < 30000)) {
      s.hold = true;
      s.ms = HOLD_MS;
    }
    if (a.kind === 'wave') {
      // Needing the user beats everything: straight to the front.
      const sign = c.svg.querySelector('.cw-p-ask text');
      if (sign) sign.textContent = a.sign || '!?';
      s.ms = 600000;
      // A tool still running (usually: waiting on this very permission) resumes after.
      const resume = c.cur && c.cur.hold ? [{ ...c.cur, arrivedAt: 0, endAt: 0, dozing: false, sit: null }] : [];
      c.queue = [s, ...resume, ...c.queue.filter(x => x.kind !== 'wave')];
      if (c.cur) { c.cur.hold = false; c.cur.endAt = 0; }
      c.leaving = false;
      c.endAfterQueue = null;
      return;
    }
    if (busyWithClaude) return;
    c.leaving = false;
    c.endAfterQueue = null;
    // Something new started, so whatever was being held is over.
    const now = performance.now();
    for (const st of [c.cur, ...c.queue]) if (st && st.guess) release(c, st, now);
    // Keep the guess currently showing for its minimum time; replace any waiting (but
    // not a reaction to how a task went).
    c.queue = c.queue.filter(x => !x.guess || x.react);
    c.queue.push(s);
  }

  function finish(c, ok) {
    const now = performance.now();
    for (const st of [c.cur, ...c.queue]) release(c, st, now);
    c.queue = c.queue.filter(x => x.kind !== 'wave');
    if (c.cur && c.cur.kind === 'wave') c.cur.endAt = 0;
    c.queue.push({ kind: ok ? 'done' : 'error', say: MOOD_LABEL[ok ? 'done' : 'error'], ms: ok ? 3000 : 4000, id: ++stepSeq, target: {} });
    c.endAfterQueue = true;
  }

  let peekTimer = 0;
  let peeked = [];
  /**
   * A screenshot can only show what's on screen, so for that instant the bits of Clawd
   * (sprite, caption, glow) that overlap the spots being photographed get a hole cut in
   * them; the rest of him stays put. Usually nothing overlaps and nothing changes.
   */
  function peek(rects) {
    unpeek();
    if (!layer || !Array.isArray(rects) || !rects.length) return;
    const pad = 2;
    for (const n of layer.children) {
      if (n.classList.contains('cover')) continue;
      const own = n.getBoundingClientRect();
      // A sprite's caption and name tag hang outside its box.
      const boxes = [own, ...[...n.querySelectorAll('.label, .tag')].map(x => x.getBoundingClientRect())]
        .filter(b => b.width && b.height);
      const hits = rects.filter(r => boxes.some(b => r.left - pad < b.right && r.left + r.width + pad > b.left
        && r.top - pad < b.bottom && r.top + r.height + pad > b.top));
      if (!hits.length) continue;
      const holes = hits.map(r => {
        const w = r.width + pad * 2;
        const h = r.height + pad * 2;
        return `M${r.left - own.left - pad} ${r.top - own.top - pad}h${w}v${h}h${-w}Z`;
      }).join('');
      n.style.clipPath = `path(evenodd, "M-9999 -9999H9999V9999H-9999Z${holes}")`;
      peeked.push(n);
    }
    if (peeked.length) peekTimer = setTimeout(unpeek, 1500); // never for long
  }
  function unpeek() {
    clearTimeout(peekTimer);
    for (const n of peeked) n.style.removeProperty('clip-path');
    peeked = [];
  }

  window.__cmClawd = msg => {
    if (!msg || msg.op === 'hide') return hideAll();
    if (msg.op === 'peek') {
      if (msg.on) peek(msg.rects);
      else unpeek();
      return null;
    }
    const id = String(msg.id || 'job');
    if (msg.op === 'leave') {
      const c = clawds.get(id);
      if (c) c.endAfterQueue = true;
      if (c && !c.cur && !c.queue.length) c.leaving = true;
      return null;
    }
    if (msg.op === 'ghosts') {
      const c = clawds.get(id);
      if (c) attachGhosts(c, msg);
      return null;
    }
    if (msg.op === 'end') {
      const c = clawds.get(id);
      if (c) endTool(c, msg);
      else ended.set(msg.toolId, performance.now());
      return null;
    }
    if (msg.op === 'helper' && !msg.on && !clawds.has(id)) return null; // he's already gone home
    ensureLayer();
    const c = getClawd(id, msg);
    if (msg.op === 'play') return play(c, msg);
    if (msg.op === 'helper') { helper(c, msg); return null; }
    if (msg.op === 'act') guess(c, msg);
    else if (msg.op === 'done') finish(c, true);
    else if (msg.op === 'error') finish(c, false);
    return null;
  };
}

if (!window.__cmClawd) install();
