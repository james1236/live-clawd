/**
 * Clawd on the page: injected (tabs.executeScript) into the tab a Clawdify job is
 * editing, and — Live Clawd — into localhost tabs of a project a Claude Code session in
 * WSL is working on. The background calls `window.__cmClawd(msg)` with:
 *   {op: 'act', id, kind, selectors, components, pattern, color, measure, label,
 *    tag, live}           walk to the element the change touches and act it out
 *   {op: 'done' | 'error', id}  celebrate / droop, then walk off
 *   {op: 'leave', id}     walk off now
 *   {op: 'hide'}          remove every Clawd at once (before DOM snapshots/screenshots)
 * `id` names a Clawd (one per job / Claude session), so several can share a page, each
 * in its own colour with a name tag. Live Clawds never scroll the page.
 *
 * Everything lives in a closed shadow root on a fixed, click-through layer, built with
 * DOM APIs (no innerHTML) so it works on pages enforcing Trusted Types.
 */
import { CLAWD_CSS, VIEWBOX, clawdSpriteNode, eyeOffset, lookAt, setMood, tossBottle } from '@/common/clawd-art';
import { MOOD_LABEL } from '@/common/clawd-actions';

function install() {
  const SPRITE_W = 96; // px
  const UNIT = SPRITE_W / VIEWBOX.w; // px per Clawd pixel
  const SPRITE_H = Math.round(UNIT * VIEWBOX.h);
  const FOOT_X = (8 - VIEWBOX.x) * UNIT; // Clawd's centre, from sprite's left
  const FOOT_Y = (10 - VIEWBOX.y) * UNIT; // Clawd's feet, from sprite's top
  const SPEED = 520; // px/s walking
  const NO_TARGET = new Set(['think', 'read', 'fetch', 'hack', 'stash']);

  const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; font: 12px/1.3 system-ui, sans-serif;
  --clawd: #d97757; --clawd-eye: #1f1e1d; --accent: #d97757; }
.layer.out { opacity: 0; transition: opacity .5s; }
.hl { position: absolute; display: none; border: 2px dashed var(--accent); border-radius: 6px;
  background: rgba(217, 119, 87, .06); box-shadow: 0 0 0 4px rgba(217, 119, 87, .12); overflow: hidden;
  transition: border-color .3s, background .3s; }
.hl.on { display: block; }
.hl.ok { border-color: #4f9a45; border-style: solid; background: rgba(79, 154, 69, .12); }
.sprite { position: absolute; left: 0; top: 0; width: ${SPRITE_W}px; height: ${SPRITE_H}px; will-change: transform;
  filter: drop-shadow(0 2px 2px rgba(0,0,0,.25)); }
.clip, .face, .turn { position: absolute; inset: 0; }
.turn { transition: transform .15s; }
.turn.flip { transform: scaleX(-1); }
.turn.flip .cw-sign-text { transform: scaleX(-1); transform-origin: 16.7px 0; } /* keep signs readable */
/* the clickable bit: just Clawd's body, so he doesn't swallow clicks around him */
.hit { position: absolute; left: ${(3 - VIEWBOX.x) * UNIT}px; top: ${(0 - VIEWBOX.y) * UNIT}px;
  width: ${10 * UNIT}px; height: ${10 * UNIT}px; pointer-events: auto; cursor: pointer; }
/* portal-gun entrances and exits: he rises out of / sinks into a swirling green portal */
.portal { position: absolute; left: ${FOOT_X - 44}px; top: ${FOOT_Y - 9}px; width: 88px; height: 20px; border-radius: 50%;
  background: radial-gradient(ellipse at center, #fff3dc 0 16%, #ffb347 38%, #ff7a00 62%, rgba(255,122,0,0) 72%);
  box-shadow: 0 0 16px 5px rgba(255,140,0,.6); transform: scale(0, .3); opacity: 0; overflow: hidden;
  transition: transform .28s cubic-bezier(.3, 1.6, .6, 1), opacity .2s; }
.portal::after { content: ""; position: absolute; inset: 2px 6px; border-radius: 50%;
  background: conic-gradient(rgba(255,255,255,.7), transparent 30%, rgba(255,255,255,.45) 55%, transparent 80%); animation: spin .5s linear infinite; }
.portal.open { transform: scale(1, 1); opacity: 1; }
/* Blue to leave, orange to arrive. */
.portal.blue { background: radial-gradient(ellipse at center, #e3f1ff 0 16%, #63b3ff 38%, #1f6fff 62%, rgba(31,111,255,0) 72%);
  box-shadow: 0 0 16px 5px rgba(50,140,255,.6); }
.shot { position: absolute; left: 0; top: 0; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%;
  background: #e3f1ff; box-shadow: 0 0 6px 3px #3d8bff, 0 0 14px 6px rgba(61,139,255,.5); transition: transform .18s linear; }
.sprite.emerging .clip, .sprite.sinking .clip { clip-path: inset(-300px -300px ${SPRITE_H - FOOT_Y}px -300px); }
@keyframes emerge { from { transform: translateY(${Math.round(FOOT_Y)}px); } to { transform: none; } }
@keyframes sink { from { transform: none; } to { transform: translateY(${Math.round(FOOT_Y + 8)}px); } }
.sprite.emerging .face { animation: emerge .5s cubic-bezier(.2, .9, .3, 1.2) .22s both; }
.sprite.sinking .face { animation: sink .45s ease-in forwards; }
.sprite.emerging .label, .sprite.emerging .tag, .sprite.emerging .water,
.sprite.sinking .label, .sprite.sinking .tag, .sprite.sinking .water { opacity: 0; transition: opacity .15s; }
.label { position: absolute; left: 50%; bottom: calc(100% + 2px); transform: translateX(-50%); white-space: nowrap;
  max-width: 260px; overflow: hidden; text-overflow: ellipsis; padding: 3px 9px; border-radius: 10px;
  background: #1f1e1d; color: #faf9f5; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
.label:empty { display: none; }
.water { position: absolute; left: 50%; top: calc(100% + 2px); transform: translateX(-50%); white-space: nowrap;
  font-size: 10px; color: #3a7bd5; background: rgba(255,255,255,.9); border-radius: 8px; padding: 1px 6px; display: none; }
.water.on { display: block; }
.tag { position: absolute; left: 50%; top: calc(100% + 1px); transform: translateX(-50%); white-space: nowrap;
  font-size: 10px; font-weight: 600; color: #faf9f5; background: var(--clawd); border-radius: 7px; padding: 0 6px; opacity: .9; }
.tag:empty { display: none; }
.tag + .water { top: calc(100% + 17px); }

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
.hl.wobble { animation: wobble .7s infinite; }
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
.hl.bounce { animation: bounce .5s ease-in-out infinite; }
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
  const BELOW = 38; // room under his feet for the name tag and water counter
  const EYES = eyeOffset(SPRITE_W);
  const NEAR = 190; // px: eyes follow the cursor within this
  const TICKLES = ['Hehe! 😆', 'Hahaha, stop it!', 'I’m trying to work here! 😂', 'OK OK, you win! 🏳️'];
  let mouse = null;
  window.addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; }, { passive: true, capture: true });
  document.addEventListener('mouseleave', () => { mouse = null; }, { passive: true });
  let host, layer;
  let raf = 0;
  let lastT = 0;
  /** @type {Map<string, object>} */
  const clawds = new Map();
  let colorIx = 0;

  const el = (tag, cls, parent, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  };

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
    for (const c of clawds.values()) { clearTimeout(c.leaveTimer); c.root.remove(); c.hl.remove(); }
    clawds.clear();
    if (host) host.remove();
  }

  function getClawd(id, tag) {
    let c = clawds.get(id);
    if (c) return c;
    const hl = el('div', 'hl', layer);
    const root = el('div', 'sprite', layer);
    const color = COLORS[colorIx++ % COLORS.length];
    root.style.setProperty('--clawd', color);
    hl.style.setProperty('--accent', color);
    const portal = el('div', 'portal', root);
    const clip = el('div', 'clip', root);
    const face = el('div', 'face', clip);
    const turn = el('div', 'turn', face);
    const svg = clawdSpriteNode(document, SPRITE_W);
    turn.appendChild(svg);
    const hit = el('div', 'hit', root);
    c = {
      id, hl, root, face, turn, svg, portal,
      fx: el('div', 'fx', hl),
      label: el('div', 'label', root),
      tagEl: el('div', 'tag', root, tag || ''),
      waterEl: el('div', 'water', root),
      target: null, action: null, pos: null, mood: 'idle', actMood: 'idle',
      leaveTimer: 0, leaving: false, live: false,
      waterUntil: 0, nextWater: 0, litres: 0, throwUntil: 0,
      phase: null, phaseAt: 0, then: null,
      lastRect: null, lostAt: 0, retryUntil: 0, retryAt: 0,
      tickleUntil: 0, tickles: 0, lastTickle: 0, noticeUntil: 0, near: false, extra: '',
    };
    const stop = e => { e.stopPropagation(); e.preventDefault(); };
    hit.addEventListener('mousedown', stop);
    hit.addEventListener('click', e => {
      stop(e);
      // A Clawd waving for attention is dismissed by a click (until Claude has news).
      if (c.actMood === 'wave' && !c.leaving) {
        c.dismissed = true;
        c.action = null;
        c.actMood = 'idle';
        setLabel(c, 'OK, I’ll wait 👍');
        clearTimeout(c.leaveTimer);
        c.leaveTimer = setTimeout(() => leave(c), 700);
      } else {
        tickle(c);
      }
    });
    // Later Clawds stand a little to the side so they don't stack exactly.
    c.offset = (clawds.size % 3) * 40;
    clawds.set(id, c);
    return c;
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
    clearTimeout(c.leaveTimer);
    c.root.remove();
    c.hl.remove();
    clawds.delete(c.id);
    reportGone(c);
    if (!clawds.size) hideAll();
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

  function findTarget(a) {
    for (const s of a.selectors || []) {
      const n = firstVisible(s);
      if (n) return n;
    }
    try {
      const n = findByComponent(a.components);
      if (n) return n;
    } catch { /* not React, or not readable */ }
    if (a.pattern) {
      const p = a.pattern;
      const n = firstVisible(p);
      if (n) return n;
      const tokens = (p.match(/[A-Za-z][\w-]{2,}/g) || []).slice(0, 6);
      for (const t of tokens) {
        const m = firstVisible(`#${CSS.escape(t)}`) || firstVisible(`.${CSS.escape(t)}`)
          || firstVisible(`[class*="${t}" i]`) || firstVisible(`[id*="${t}" i]`);
        if (m) return m;
      }
      return findByText(p.replace(/\\[sdwb]|[\\^$.*+?()[\]{}|]/g, ' ').trim().split(/\s{2,}/)[0]);
    }
    return null;
  }

  const vp = () => ({ w: window.innerWidth, h: window.innerHeight });

  /** Where a Clawd should stand: on its target's top edge, else along the bottom. */
  /**
   * The target's box. When it leaves the DOM (removed, or re-rendered by hot reload) the
   * last box is kept for a few seconds — he's vacuuming up exactly that spot — and then
   * the action's targets are looked up again (e.g. the component around it).
   */
  function rectOf(c, now) {
    if (c.target && c.target.isConnected) {
      c.lastRect = c.target.getBoundingClientRect();
      c.lostAt = 0;
      return c.lastRect;
    }
    if (!c.lastRect) return null;
    if (!c.lostAt) c.lostAt = now;
    if (now - c.lostAt < 5000) return c.lastRect;
    c.lastRect = null;
    c.target = c.action ? findTarget(c.action) : null;
    return c.target ? rectOf(c, now) : null;
  }

  function destination(c, now) {
    const { w, h } = vp();
    let fx;
    let fy;
    const r = rectOf(c, now);
    if (r) {
      fx = r.left + Math.min(56, r.width / 2) + c.offset;
      fy = r.top > SPRITE_H + 24 ? r.top + 4 : Math.min(r.bottom, r.top + SPRITE_H + 12);
    } else {
      fx = w - 70 - c.offset * 2;
      fy = h - BELOW;
    }
    // Keep all of him on screen: caption above, name tag and water counter below.
    fx = Math.max(FOOT_X + 4, Math.min(w - (SPRITE_W - FOOT_X) - 4, fx));
    fy = Math.max(FOOT_Y + 26, Math.min(h - BELOW, fy));
    return { x: fx - FOOT_X, y: fy - FOOT_Y };
  }

  function placeHighlight(c, now) {
    const { hl } = c;
    const r = !c.phase && (c.action || c.actMood === 'done') ? rectOf(c, now) : null;
    if (!r) {
      hl.classList.remove('on');
      return;
    }
    const { w, h } = vp();
    const l = Math.max(2, r.left - 4);
    const t = Math.max(2, r.top - 4);
    const rr = Math.min(w - 2, r.right + 4);
    const b = Math.min(h - 2, r.bottom + 4);
    if (rr - l < 8 || b - t < 8) { hl.classList.remove('on'); return; }
    hl.style.left = `${l}px`;
    hl.style.top = `${t}px`;
    hl.style.width = `${rr - l}px`;
    hl.style.height = `${b - t}px`;
    hl.classList.add('on');
  }

  function setLabel(c, text) {
    if (c.label.textContent === text) return;
    c.label.textContent = text;
    c.labelW = 0; // re-measure
  }

  /** Keep the caption bubble on screen when Clawd stands near an edge. */
  function placeLabel(c) {
    if (!c.label.textContent) return;
    if (!c.labelW) c.labelW = c.label.offsetWidth;
    const half = c.labelW / 2;
    const centre = Math.max(half + 4, Math.min(vp().w - half - 4, c.pos.x + SPRITE_W / 2));
    c.label.style.left = `${Math.round(centre - c.pos.x)}px`;
  }

  function show(c, m, now) {
    const extra = [c.tickleUntil > now && 'cw-tickle', c.noticeUntil > now && 'cw-notice'].filter(Boolean).join(' ');
    if (m === c.mood && extra === c.extra) return;
    c.mood = m;
    c.extra = extra;
    setMood(c.svg, m, extra);
  }

  function currentLabel(c) {
    return c.action ? c.action.label : MOOD_LABEL[c.actMood] || '';
  }

  function tickle(c) {
    const now = performance.now();
    if (now - c.lastTickle > 3000) c.tickles = 0;
    c.lastTickle = now;
    setLabel(c, TICKLES[Math.min(c.tickles++, TICKLES.length - 1)]);
    c.tickleUntil = now + 1300;
  }

  /** Portal in (he rises out of it) — on arrival and at the end of a teleport. */
  function startIn(c, now) {
    c.phase = 'in';
    c.phaseAt = now;
    c.root.classList.add('emerging');
    c.portal.classList.remove('blue');
    c.portal.classList.add('open');
    c.svg.style.setProperty('--portal', '#ff8a1f');
  }

  /** Portal out (he sinks into it), then vanish or reappear at his destination. */
  function startOut(c, now, then) {
    c.phase = 'out';
    c.phaseAt = now;
    c.then = then;
    c.fired = false;
    c.svg.style.setProperty('--portal', '#2f8cff');
  }

  /** The portal gun's muzzle after he aims it down, in viewport px. */
  function muzzle(c) {
    const flip = c.turn.classList.contains('flip');
    const mx = (19.4 - VIEWBOX.x) * UNIT;
    return { x: c.pos.x + (flip ? SPRITE_W - mx : mx), y: c.pos.y + (7 - VIEWBOX.y) * UNIT };
  }

  /** A blue blob flying from the gun to where the portal will open (under his feet). */
  function fire(c) {
    const from = muzzle(c);
    const shot = el('div', 'shot', layer);
    shot.style.transform = `translate(${from.x}px, ${from.y}px)`;
    const to = { x: c.pos.x + FOOT_X, y: c.pos.y + FOOT_Y };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      shot.style.transform = `translate(${to.x}px, ${to.y}px) scale(.6)`;
    }));
    setTimeout(() => shot.remove(), 230);
  }

  /** Advance a portal animation; returns false if the Clawd is gone. */
  function stepPhase(c, now, dest) {
    const t = now - c.phaseAt;
    if (c.phase === 'in') {
      if (t > 650) c.portal.classList.remove('open');
      if (t > 1000) { c.phase = null; c.root.classList.remove('emerging'); }
    } else {
      // Aim the portal gun down, fire, blue portal opens, drop in.
      if (t > 260 && !c.fired) { c.fired = true; fire(c); }
      if (t > 440) c.portal.classList.add('blue', 'open');
      if (t > 580) c.root.classList.add('sinking');
      if (t > 1060) c.portal.classList.remove('open');
      if (t > 1280) {
        c.root.classList.remove('sinking');
        if (c.then === 'remove') { removeClawd(c); return false; }
        c.pos = { ...dest };
        startIn(c, now);
      }
    }
    return true;
  }

  /** Eyes follow a nearby cursor; he gives a little start when it first comes close. */
  function watchCursor(c, now) {
    if (!mouse) { if (c.near) { c.near = false; lookAt(c.svg, null); } return; }
    const flip = c.turn.classList.contains('flip');
    const ex = c.pos.x + (flip ? SPRITE_W - EYES.x : EYES.x);
    const ey = c.pos.y + EYES.y;
    const dx = mouse.x - ex;
    const dy = mouse.y - ey;
    const near = Math.hypot(dx, dy) < NEAR;
    if (near) {
      if (!c.near && ['idle', 'done', 'think', 'read'].includes(c.actMood)) c.noticeUntil = now + 350;
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

  function step(c, now, dt) {
    // Targets that aren't rendered yet (hot reload still applying) get a few retries.
    if (c.retryUntil > now && now > c.retryAt) {
      c.retryAt = now + 400;
      const t = findTarget(c.action || {});
      if (t) { c.target = t; c.retryUntil = 0; }
    }
    const dest = destination(c, now);
    if (!c.pos) { c.pos = { ...dest }; startIn(c, now); }
    if (c.leaving && !c.phase) startOut(c, now, 'remove');
    if (c.phase) {
      if (!stepPhase(c, now, dest)) return;
      // Arrives holding the portal gun; aims it to leave until he's dropping through.
      show(c, 'portal', now);
      c.root.style.transform = `translate(${Math.round(c.pos.x)}px, ${Math.round(c.pos.y)}px)`;
      placeLabel(c);
      placeHighlight(c, now);
      return;
    }
    const dx = dest.x - c.pos.x;
    const dy = dest.y - c.pos.y;
    const dist = Math.hypot(dx, dy);
    // Far away? Portal there instead of a long walk.
    if (dist > 520) { startOut(c, now, 'teleport'); return; }
    const walking = dist > (c.mood === 'walk' ? 2 : 36);
    watchCursor(c, now);
    if (c.tickleUntil && now > c.tickleUntil) { c.tickleUntil = 0; setLabel(c, c.waterUntil ? MOOD_LABEL.water : currentLabel(c)); }
    if (walking) {
      const s = Math.min(dist, SPEED * dt);
      c.pos.x += dx / dist * s;
      c.pos.y += dy / dist * s;
      if (Math.abs(dx) > 2) c.turn.classList.toggle('flip', dx < 0);
      show(c, 'walk', now);
    } else {
      // Small drifts (scrolling a little) are followed without breaking into a walk.
      if (dist > 0.5) { c.pos.x += dx * 0.3; c.pos.y += dy * 0.3; }
      const busy = !['done', 'error', 'idle', 'wave'].includes(c.actMood);
      if (busy && now > c.nextWater && !c.waterUntil && !c.throwUntil) {
        c.waterUntil = now + 3000; // matches the one-shot drinking animation
        c.litres += 0.5;
        c.waterEl.textContent = `💧 ${c.litres.toFixed(1)} L`;
        c.waterEl.classList.add('on');
      }
      if (c.waterUntil && now > c.waterUntil) {
        // Empty: wind up and chuck the bottle at the cursor.
        c.waterUntil = 0;
        c.throwUntil = now + 450;
        c.nextWater = now + 22000 + Math.random() * 20000;
      }
      if (c.throwUntil && now > c.throwUntil) {
        c.throwUntil = 0;
        const hand = handPos(c);
        const aim = mouse || { x: hand.x + hand.dir * 260, y: hand.y - 220 };
        tossBottle(document, layer, hand.x, hand.y, aim.x, aim.y);
        c.waterEl.classList.remove('on');
        setLabel(c, currentLabel(c));
      }
      if (c.waterUntil) {
        if (!c.tickleUntil) setLabel(c, MOOD_LABEL.water);
        show(c, 'water', now);
      } else if (c.throwUntil) {
        show(c, 'throw', now);
      } else {
        show(c, c.actMood, now);
      }
    }
    c.root.style.transform = `translate(${Math.round(c.pos.x)}px, ${Math.round(c.pos.y)}px)`;
    placeLabel(c);
    placeHighlight(c, now);
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    for (const c of [...clawds.values()]) step(c, now, dt);
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

  function act(c, a) {
    clearTimeout(c.leaveTimer);
    c.leaving = false;
    c.action = a;
    c.live = !!a.live;
    if (a.tag != null) c.tagEl.textContent = a.tag;
    // The attention sign can say which tmux window wants you.
    const sign = c.svg.querySelector('.cw-p-ask text');
    if (sign) sign.textContent = a.sign || '!?';
    const t = findTarget(a);
    c.retryUntil = !t && ((a.components && a.components.length) || (a.selectors && a.selectors.length)) ? performance.now() + 4000 : 0;
    if (t) {
      c.target = t;
      c.lastRect = null;
      const r = t.getBoundingClientRect();
      // A Clawdify job may bring its target into view; Live Clawd never moves your page.
      if (!c.live && (r.bottom < 0 || r.top > vp().h)) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (NO_TARGET.has(a.kind) || a.kind === 'wave') {
      c.target = null;
    } // else: keep standing at the previous target
    // Paint jobs with no element to stand on get an easel instead of a palette.
    c.actMood = a.kind === 'paint' && !c.target ? 'canvas' : a.kind;
    if (!c.nextWater) c.nextWater = performance.now() + 9000 + Math.random() * 9000;
    setLabel(c, a.label || '');
    effects(c, a);
  }

  function finish(c, ok) {
    c.action = null;
    c.actMood = ok ? 'done' : 'error';
    c.waterUntil = 0;
    c.waterEl.classList.remove('on');
    setLabel(c, MOOD_LABEL[c.actMood]);
    c.fx.replaceChildren();
    c.hl.classList.remove('wobble', 'bounce');
    if (ok && c.target) {
      c.hl.classList.add('ok');
      el('div', 'ok-tick', c.fx, '✓');
    }
    clearTimeout(c.leaveTimer);
    c.leaveTimer = setTimeout(() => leave(c), ok ? 3200 : 4200);
  }

  function leave(c) {
    c.action = null;
    c.target = null;
    c.lastRect = null;
    setLabel(c, c.actMood === 'error' ? '' : 'Bye! 👋');
    c.leaving = true;
  }

  window.__cmClawd = msg => {
    if (!msg || msg.op === 'hide') return hideAll();
    const id = String(msg.id || 'job');
    if (msg.op === 'leave') {
      const c = clawds.get(id);
      if (c) leave(c);
      return;
    }
    ensureLayer();
    const c = getClawd(id, msg.tag);
    if (msg.tag != null) c.tagEl.textContent = msg.tag;
    if (msg.op === 'act') act(c, msg);
    else if (msg.op === 'done') finish(c, true);
    else if (msg.op === 'error') finish(c, false);
  };
}

if (!window.__cmClawd) install();
